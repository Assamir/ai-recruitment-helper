/**
 * Risk #4 handler-contract tests using an ownership-enforcing fake Supabase client.
 * Real RLS is proven in tests/rls/analysis-isolation.rls.test.ts (gated).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm", () => ({
  getLLMConfig: vi.fn(),
  createLLMModel: vi.fn(),
  completeLLM: vi.fn(),
}));

import { getLLMConfig, createLLMModel } from "@/lib/llm";
import { GET as getAnalysis } from "@/pages/api/analysis/[id]/index";
import { GET as getStatus } from "@/pages/api/analysis/[id]/status";
import { GET as getExport } from "@/pages/api/analysis/[id]/export";
import { DELETE as deleteAnalysis } from "@/pages/api/analysis/[id]/index";
import { POST as postAnalysis } from "@/pages/api/analysis/index";
import { makeApiContext } from "../../helpers/api-context";
import { makeFakeSupabase } from "../../helpers/fake-supabase";
import { ANALYSIS_ID, CANDIDATE_ID, JOB_PROFILE_ID, USER_A, USER_B } from "../../helpers/ids";

const USABLE_CV = `
Jane Doe
Senior Engineer with 8 years building distributed systems in TypeScript and Python.
Led migration of monolith to microservices; improved deployment frequency and reliability.
`.trim();

let createClientImpl: () => ReturnType<typeof makeFakeSupabase> | null;

vi.mock("@/lib/supabase", () => ({
  createClient: () => createClientImpl(),
}));

function seedOwnedByB() {
  return makeFakeSupabase({
    actingUserId: USER_A,
    tables: {
      analyses: [
        {
          id: ANALYSIS_ID,
          user_id: USER_B,
          status: "completed",
          candidate_id: CANDIDATE_ID,
          job_profile_id: JOB_PROFILE_ID,
          match_summary: "secret",
          error_message: null,
          created_at: "2026-01-01T00:00:00Z",
          completed_at: "2026-01-02T00:00:00Z",
        },
      ],
      candidates: [{ id: CANDIDATE_ID, user_id: USER_B, cv_text: USABLE_CV, file_name: "cv.txt" }],
      analysis_questions: [],
      job_profiles: [{ id: JOB_PROFILE_ID, name: "Role", description: "Desc", expected_skills: ["TypeScript"] }],
    },
  });
}

function seedExportOwnedByA() {
  return makeFakeSupabase({
    actingUserId: USER_A,
    tables: {
      analyses: [
        {
          id: ANALYSIS_ID,
          user_id: USER_A,
          status: "completed",
          candidate_id: CANDIDATE_ID,
          job_profile_id: JOB_PROFILE_ID,
          match_summary: "Jane Doe is a strong fit. Email jane.doe@example.com for details.",
          error_message: null,
          linkedin_scrape_note: null,
          custom_requirements: null,
          project_context: null,
          created_at: "2026-01-01T00:00:00Z",
          completed_at: "2026-01-02T00:00:00Z",
        },
      ],
      candidates: [
        {
          id: CANDIDATE_ID,
          user_id: USER_A,
          cv_text: USABLE_CV,
          file_name: "cv.txt",
          first_name: "Jane",
          last_name: "Doe",
          pii_map: null,
          linkedin_text: null,
        },
      ],
      analysis_questions: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          analysis_id: ANALYSIS_ID,
          category: "missing_elements",
          question: "Did Jane Doe list testing tools?",
          rationale: "Tools section is sparse.",
          suggested_answer: null,
          sort_order: 0,
        },
      ],
      job_profiles: [
        {
          id: JOB_PROFILE_ID,
          name: "Role",
          seniority_level: "Senior",
          description: "Desc",
          expected_skills: ["TypeScript"],
        },
      ],
    },
  });
}

function exportCtx(format = "md") {
  return makeApiContext({
    params: { id: ANALYSIS_ID },
    url: `http://localhost/api/analysis/${ANALYSIS_ID}/export?format=${format}`,
  });
}

function seedOwnedByA() {
  return makeFakeSupabase({
    actingUserId: USER_A,
    tables: {
      analyses: [
        {
          id: ANALYSIS_ID,
          user_id: USER_A,
          status: "completed",
          candidate_id: CANDIDATE_ID,
          job_profile_id: JOB_PROFILE_ID,
          match_summary: "ok",
          error_message: null,
          created_at: "2026-01-01T00:00:00Z",
          completed_at: "2026-01-02T00:00:00Z",
        },
      ],
      candidates: [{ id: CANDIDATE_ID, user_id: USER_A, cv_text: USABLE_CV, file_name: "cv.txt" }],
      analysis_questions: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          analysis_id: ANALYSIS_ID,
          category: "skills",
          question: "Q?",
          rationale: "R",
          suggested_answer: null,
          sort_order: 0,
        },
      ],
      job_profiles: [{ id: JOB_PROFILE_ID, name: "Role", description: "Desc", expected_skills: ["TypeScript"] }],
    },
  });
}

describe("API analysis isolation (fake ownership-enforcing client)", () => {
  beforeEach(() => {
    createClientImpl = () => seedOwnedByB();
    vi.mocked(getLLMConfig).mockReturnValue({ provider: "lmstudio", model: "test" });
    vi.mocked(createLLMModel).mockReturnValue({} as never);
  });

  describe("cross-user → 404 NOT_FOUND (never 403)", () => {
    it("GET /api/analysis/:id denies foreign analysis", async () => {
      const res = await getAnalysis(
        makeApiContext({ params: { id: ANALYSIS_ID }, url: `http://localhost/api/analysis/${ANALYSIS_ID}` }),
      );
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
      expect(res.status).not.toBe(403);
    });

    it("GET /api/analysis/:id/status denies foreign analysis", async () => {
      const res = await getStatus(
        makeApiContext({
          params: { id: ANALYSIS_ID },
          url: `http://localhost/api/analysis/${ANALYSIS_ID}/status`,
        }),
      );
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });

    it("GET /api/analysis/:id/export denies foreign analysis", async () => {
      const res = await getExport(exportCtx());
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });

    it("DELETE /api/analysis/:id denies foreign analysis", async () => {
      const res = await deleteAnalysis(
        makeApiContext({
          params: { id: ANALYSIS_ID },
          url: `http://localhost/api/analysis/${ANALYSIS_ID}`,
          request: new Request(`http://localhost/api/analysis/${ANALYSIS_ID}`, { method: "DELETE" }),
        }),
      );
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });

    it("POST /api/analysis retry denies foreign candidate_id", async () => {
      const form = new FormData();
      form.append("job_profile_id", JOB_PROFILE_ID);
      form.append("candidate_id", CANDIDATE_ID);
      const res = await postAnalysis(
        makeApiContext({
          request: new Request("http://localhost/api/analysis", { method: "POST", body: form }),
        }),
      );
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });
  });

  describe("own id → success", () => {
    beforeEach(() => {
      createClientImpl = () => seedOwnedByA();
    });

    it("GET /api/analysis/:id returns 200 for owned analysis", async () => {
      const res = await getAnalysis(
        makeApiContext({ params: { id: ANALYSIS_ID }, url: `http://localhost/api/analysis/${ANALYSIS_ID}` }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { analysis?: { id: string } };
      expect(body.analysis?.id).toBe(ANALYSIS_ID);
    });

    it("GET status returns 200 for owned analysis", async () => {
      const res = await getStatus(
        makeApiContext({
          params: { id: ANALYSIS_ID },
          url: `http://localhost/api/analysis/${ANALYSIS_ID}/status`,
        }),
      );
      expect(res.status).toBe(200);
    });

    it("DELETE returns 200 for owned analysis", async () => {
      const res = await deleteAnalysis(
        makeApiContext({
          params: { id: ANALYSIS_ID },
          request: new Request(`http://localhost/api/analysis/${ANALYSIS_ID}`, { method: "DELETE" }),
        }),
      );
      expect(res.status).toBe(200);
    });

    it("POST retry returns 201 for owned candidate", async () => {
      const form = new FormData();
      form.append("job_profile_id", JOB_PROFILE_ID);
      form.append("candidate_id", CANDIDATE_ID);
      const res = await postAnalysis(
        makeApiContext({
          request: new Request("http://localhost/api/analysis", { method: "POST", body: form }),
        }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { analysis_id?: string };
      expect(body.analysis_id).toBeTruthy();
    });
  });

  describe("status matrix", () => {
    const missingIdCtx = () => makeApiContext({ params: {}, url: "http://localhost/api/analysis/" });

    it.each([
      ["GET detail", getAnalysis],
      ["GET status", getStatus],
      ["GET export", getExport],
      ["DELETE", deleteAnalysis],
    ])("%s → 401 without session", async (_label, handler) => {
      const res = await handler(
        handler === getExport
          ? makeApiContext({
              user: null,
              params: { id: ANALYSIS_ID },
              url: `http://localhost/api/analysis/${ANALYSIS_ID}/export?format=md`,
            })
          : makeApiContext({ user: null, params: { id: ANALYSIS_ID } }),
      );
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(401);
      expect(body.code).toBe("UNAUTHORIZED");
    });

    it.each([
      ["GET detail", getAnalysis],
      ["GET status", getStatus],
      ["GET export", getExport],
      ["DELETE", deleteAnalysis],
    ])("%s → 400 when id param missing", async (_label, handler) => {
      const res = await handler(
        handler === getExport
          ? makeApiContext({ params: {}, url: "http://localhost/api/analysis//export?format=md" })
          : missingIdCtx(),
      );
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(400);
      expect(body.code).toBe("BAD_REQUEST");
    });

    it.each([
      ["GET detail", getAnalysis],
      ["GET status", getStatus],
      ["GET export", getExport],
      ["DELETE", deleteAnalysis],
    ])("%s → 503 when DB unconfigured", async (_label, handler) => {
      createClientImpl = () => null;
      const res = await handler(handler === getExport ? exportCtx() : makeApiContext({ params: { id: ANALYSIS_ID } }));
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(503);
      expect(body.code).toBe("SERVICE_UNAVAILABLE");
    });

    it.each([
      ["GET detail", getAnalysis],
      ["GET status", getStatus],
      ["GET export", getExport],
      ["DELETE", deleteAnalysis],
    ])("%s → 404 for non-existent id", async (_label, handler) => {
      createClientImpl = () => makeFakeSupabase({ actingUserId: USER_A, tables: { analyses: [], candidates: [] } });
      const res = await handler(
        handler === getExport
          ? makeApiContext({
              params: { id: "99999999-9999-4999-8999-999999999999" },
              url: "http://localhost/api/analysis/99999999-9999-4999-8999-999999999999/export?format=md",
            })
          : makeApiContext({ params: { id: "99999999-9999-4999-8999-999999999999" } }),
      );
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });

    it("POST → 401 without session", async () => {
      const res = await postAnalysis(makeApiContext({ user: null }));
      expect(res.status).toBe(401);
    });

    it("POST → 503 when DB unconfigured", async () => {
      createClientImpl = () => null;
      const res = await postAnalysis(makeApiContext());
      expect(res.status).toBe(503);
    });
  });

  describe("export route", () => {
    it("returns 400 for missing format", async () => {
      createClientImpl = () => seedExportOwnedByA();
      const res = await getExport(
        makeApiContext({
          params: { id: ANALYSIS_ID },
          url: `http://localhost/api/analysis/${ANALYSIS_ID}/export`,
        }),
      );
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(400);
      expect(body.code).toBe("BAD_REQUEST");
    });

    it("returns 400 for invalid format", async () => {
      createClientImpl = () => seedExportOwnedByA();
      const res = await getExport(exportCtx("docx"));
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(400);
      expect(body.code).toBe("BAD_REQUEST");
    });

    it("returns 409 for non-completed analysis", async () => {
      createClientImpl = () =>
        makeFakeSupabase({
          actingUserId: USER_A,
          tables: {
            analyses: [
              {
                id: ANALYSIS_ID,
                user_id: USER_A,
                status: "processing",
                candidate_id: CANDIDATE_ID,
                job_profile_id: JOB_PROFILE_ID,
                match_summary: null,
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
            candidates: [{ id: CANDIDATE_ID, user_id: USER_A, cv_text: USABLE_CV, file_name: "cv.txt" }],
          },
        });
      const res = await getExport(exportCtx());
      const body = (await res.json()) as { code?: string };
      expect(res.status).toBe(409);
      expect(body.code).toBe("ANALYSIS_NOT_COMPLETED");
    });

    it("returns markdown attachment with redacted body for completed analysis", async () => {
      createClientImpl = () => seedExportOwnedByA();
      const res = await getExport(exportCtx());
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toMatch(/^text\/markdown/);
      expect(res.headers.get("Content-Disposition")).toContain("attachment");
      expect(res.headers.get("Content-Disposition")).toContain(".md");
      const body = await res.text();
      expect(body).toContain("# CONFIDENTIAL");
      expect(body).not.toContain("Jane Doe");
      expect(body).not.toContain("jane.doe@example.com");
    });
  });
});
