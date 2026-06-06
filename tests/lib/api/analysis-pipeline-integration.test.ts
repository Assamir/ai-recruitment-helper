/**
 * Risk #6 — full background pipeline integration with LLM mocked at the network edge.
 */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from "vitest";
import grounded from "../../fixtures/analysis/grounded.json";
import { makeApiContext } from "../../helpers/api-context";
import { makeFakeSupabase, type FakeSupabaseTables } from "../../helpers/fake-supabase";
import { JOB_PROFILE_ID, USER_A } from "../../helpers/ids";

const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  Output: { object: vi.fn(({ schema }: { schema: unknown }) => ({ schema })) },
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(({ apiKey }: { apiKey: string }) => {
    return (model: string) => ({
      provider: "openrouter",
      modelId: model,
      specificationVersion: "v1",
      _apiKey: apiKey,
    });
  }),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(({ name, baseURL }: { name: string; baseURL: string }) => {
    return (model: string) => ({
      provider: name,
      modelId: model,
      specificationVersion: "v1",
      _baseURL: baseURL,
    });
  }),
}));

vi.mock("astro:env/server", () => ({
  LLM_PROVIDER: "lmstudio",
  LLM_MODEL: "test-model",
  OPENROUTER_API_KEY: undefined,
  LINKEDIN_SESSION_COOKIE: undefined,
}));

const USABLE_CV = `
Jane Doe
Senior QA Engineer with 6 years experience building test automation in Playwright and TypeScript.
Led CI pipeline integration for a payments API; improved deployment reliability and coverage.
`.trim();

let tables: FakeSupabaseTables;
let createClientImpl: () => ReturnType<typeof makeFakeSupabase> | null;

vi.mock("@/lib/supabase", () => ({
  createClient: () => createClientImpl(),
}));

import { POST as postAnalysis } from "@/pages/api/analysis/index";

function seedTables(): FakeSupabaseTables {
  return {
    analyses: [],
    candidates: [],
    analysis_questions: [],
    job_profiles: [
      {
        id: JOB_PROFILE_ID,
        name: grounded.profile.name,
        description: grounded.profile.description,
        expected_skills: grounded.profile.expected_skills,
      },
    ],
  };
}

function buildPostContext(waitUntil: (p: Promise<unknown>) => void) {
  const form = new FormData();
  form.append("job_profile_id", JOB_PROFILE_ID);
  form.append("cv_text", USABLE_CV);
  return makeApiContext({
    request: new Request("http://localhost/api/analysis", { method: "POST", body: form }),
    waitUntil,
  });
}

describe("POST /api/analysis pipeline integration (Risk #6)", () => {
  beforeEach(() => {
    tables = seedTables();
    createClientImpl = () => makeFakeSupabase({ actingUserId: USER_A, tables });
    mockGenerateText.mockReset();
  });

  it("completes the background chain with match_summary and persisted questions", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify(grounded.response),
    });

    let captured: Promise<unknown> | undefined;
    const res = await postAnalysis(
      buildPostContext((p) => {
        captured = p;
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { analysis_id?: string };
    expect(body.analysis_id).toBeTruthy();

    await captured;

    const analysis = tables.analyses?.find((row) => row.id === body.analysis_id);
    expect(analysis?.status).toBe("completed");
    expect(analysis?.match_summary).toBe(grounded.response.match_summary);
    expect(tables.analysis_questions).toHaveLength(grounded.response.questions.length);
  });

  it("surfaces LLM-edge failures as failed status with error_message", async () => {
    mockGenerateText.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    let captured: Promise<unknown> | undefined;
    const res = await postAnalysis(
      buildPostContext((p) => {
        captured = p;
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { analysis_id?: string };
    await captured;

    const analysis = tables.analyses?.find((row) => row.id === body.analysis_id);
    expect(analysis?.status).toBe("failed");
    expect(typeof analysis?.error_message).toBe("string");
    expect((analysis?.error_message as string).length).toBeGreaterThan(0);
    expect(analysis?.status).not.toBe("completed");
  });
});
