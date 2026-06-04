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
