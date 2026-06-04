/**
 * Manual check 1.7 (automated): retry path reads stored cv_text and rejects garbage
 * before any analysis row is created.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
const NON_EMPTY_GARBAGE_TEXT = `
%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
stream xC5x9E2A1B@@@@####....%%%%.... 0xFF 0x00 /Filter /FlateDecode /Length 4096
endstream
trailer << /Root 1 0 R >>
`.trim();

vi.mock("@/lib/llm", () => ({
  getLLMConfig: vi.fn(),
  createLLMModel: vi.fn(),
  completeLLM: vi.fn(),
}));

import { POST } from "@/pages/api/analysis/index";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const CANDIDATE_ID = "22222222-2222-2222-2222-222222222222";
const JOB_PROFILE_ID = "33333333-3333-3333-3333-333333333333";

const analysesInsert = vi.fn();

function chainableSingle<T>(data: T, error = null) {
  return {
    eq: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data, error }),
      }),
      single: () => Promise.resolve({ data, error }),
    }),
    single: () => Promise.resolve({ data, error }),
  };
}

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "candidates") {
        return {
          select: () =>
            chainableSingle({
              cv_text: NON_EMPTY_GARBAGE_TEXT,
              file_name: "garbage-stored.txt",
            }),
          insert: vi.fn(),
        };
      }
      if (table === "analyses") {
        return {
          insert: analysesInsert,
          update: vi.fn(),
        };
      }
      return { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
    },
  }),
}));

function makeContext(formData: FormData) {
  return {
    request: new Request("http://localhost/api/analysis", { method: "POST", body: formData }),
    params: {},
    url: new URL("http://localhost/api/analysis"),
    locals: {
      user: { id: USER_ID },
      cfContext: { waitUntil: vi.fn() },
    },
    cookies: {
      set: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      delete: vi.fn(),
      headers: vi.fn(),
    },
    redirect: vi.fn(),
    clientAddress: "127.0.0.1",
    site: new URL("http://localhost"),
    generator: "test",
    props: {},
  } as Parameters<typeof POST>[0];
}

describe("POST /api/analysis — retry with garbage cv_text (manual 1.7)", () => {
  beforeEach(() => {
    analysesInsert.mockReset();
  });

  it("returns 400 INSUFFICIENT_CONTENT and does not insert an analysis", async () => {
    const formData = new FormData();
    formData.append("job_profile_id", JOB_PROFILE_ID);
    formData.append("candidate_id", CANDIDATE_ID);

    const response = await POST(makeContext(formData));
    const body = (await response.json()) as { error?: string; code?: string; analysis_id?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("INSUFFICIENT_CONTENT");
    expect(body.error).toMatch(/readable content/i);
    expect(body.analysis_id).toBeUndefined();
    expect(analysesInsert).not.toHaveBeenCalled();
  });
});
