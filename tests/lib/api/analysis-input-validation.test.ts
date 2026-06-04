import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm", () => ({
  getLLMConfig: vi.fn(),
  createLLMModel: vi.fn(),
  completeLLM: vi.fn(),
}));

import { POST } from "@/pages/api/analysis/index";
import { MAX_CV_FILE_BYTES } from "@/lib/cv-parser/index";
import { makeApiContext } from "../../helpers/api-context";
import { JOB_PROFILE_ID } from "../../helpers/ids";

const analysesInsert = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "analyses") {
        return {
          insert: analysesInsert.mockImplementation(() => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "new-analysis-id" }, error: null }),
            }),
          })),
          update: vi.fn(),
        };
      }
      if (table === "candidates") {
        return {
          insert: vi.fn().mockReturnValue({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "new-candidate-id" }, error: null }),
            }),
          }),
          select: vi.fn(),
        };
      }
      return { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
    },
  }),
}));

function postContext(form: FormData) {
  return makeApiContext({
    request: new Request("http://localhost/api/analysis", { method: "POST", body: form }),
  });
}

describe("POST /api/analysis — input validation (Risk #7)", () => {
  beforeEach(() => {
    analysesInsert.mockReset();
  });

  it("rejects oversized file with FILE_TOO_LARGE before insert", async () => {
    const form = new FormData();
    form.append("job_profile_id", JOB_PROFILE_ID);
    const big = new Uint8Array(MAX_CV_FILE_BYTES + 1);
    form.append("file", new File([big], "cv.pdf", { type: "application/pdf" }));

    const res = await POST(postContext(form));
    const body = (await res.json()) as { code?: string };

    expect(res.status).toBe(400);
    expect(body.code).toBe("FILE_TOO_LARGE");
    expect(analysesInsert).not.toHaveBeenCalled();
  });

  it("rejects wrong MIME with UNSUPPORTED_FORMAT", async () => {
    const form = new FormData();
    form.append("job_profile_id", JOB_PROFILE_ID);
    form.append("file", new File(["pixels"], "img.png", { type: "image/png" }));

    const res = await POST(postContext(form));
    const body = (await res.json()) as { code?: string };

    expect(res.status).toBe(400);
    expect(body.code).toBe("UNSUPPORTED_FORMAT");
    expect(analysesInsert).not.toHaveBeenCalled();
  });

  it("returns 400 BAD_REQUEST when formData() throws", async () => {
    const badRequest = new Request("http://localhost/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=----bad" },
      body: "not valid multipart",
    });
    const res = await POST(makeApiContext({ request: badRequest }));
    const body = (await res.json()) as { code?: string };
    expect(res.status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
    expect(analysesInsert).not.toHaveBeenCalled();
  });

  it("rejects non-UUID job_profile_id with 400 not 500", async () => {
    const form = new FormData();
    form.append("job_profile_id", "not-a-uuid");
    form.append("cv_text", "Enough readable CV content for the quality gate to accept this paste.");
    const res = await POST(postContext(form));
    const body = (await res.json()) as { code?: string };
    expect(res.status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
    expect(res.status).not.toBe(500);
    expect(analysesInsert).not.toHaveBeenCalled();
  });
});
