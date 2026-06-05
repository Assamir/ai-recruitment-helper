import { describe, it, expect } from "vitest";
import { makeApiContext } from "../helpers/api-context";
import { makeFakeSupabase } from "../helpers/fake-supabase";
import { ANALYSIS_ID, USER_A, USER_B } from "../helpers/ids";

describe("tests/helpers smoke", () => {
  it("makeApiContext provides user and waitUntil stubs", () => {
    const ctx = makeApiContext({ params: { id: ANALYSIS_ID } });
    expect(ctx.locals.user?.id).toBe(USER_A);
    expect(ctx.locals.cfContext.waitUntil).toBeDefined();
  });

  it("makeFakeSupabase persists bulk insert(array) and single insert", async () => {
    const tables = { analysis_questions: [] as Record<string, unknown>[] };
    const fake = makeFakeSupabase({ actingUserId: USER_A, tables });

    const bulk = await fake.from("analysis_questions").insert([
      { analysis_id: ANALYSIS_ID, category: "skills", question: "Q1?", rationale: "R1", sort_order: 0 },
      { analysis_id: ANALYSIS_ID, category: "skills", question: "Q2?", rationale: "R2", sort_order: 1 },
    ]);
    const bulkRows = bulk.data as { id: string }[];
    expect(bulkRows).toHaveLength(2);
    expect(bulkRows.every((row) => typeof row.id === "string")).toBe(true);
    expect(tables.analysis_questions).toHaveLength(2);

    const single = await fake
      .from("analysis_questions")
      .insert({ analysis_id: ANALYSIS_ID, category: "skills", question: "Q3?", rationale: "R3", sort_order: 2 })
      .single();
    expect(single.data?.id).toBeTruthy();
    expect(tables.analysis_questions).toHaveLength(3);
  });

  it("makeFakeSupabase filters cross-user analyses", async () => {
    const fake = makeFakeSupabase({
      actingUserId: USER_A,
      tables: {
        analyses: [{ id: ANALYSIS_ID, user_id: USER_B, status: "completed", candidate_id: USER_B }],
      },
    });
    const { data, error } = await fake.from("analyses").select("status").eq("id", ANALYSIS_ID).single();
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});
