/* eslint-disable @typescript-eslint/no-unnecessary-condition -- untyped Supabase client in gated integration test */
/**
 * Risk #4 — real RLS source of truth (gated).
 *
 * Proves Postgres policies deny cross-user reads. Skipped when SUPABASE_TEST_URL is unset
 * so CI stays green without a local Supabase instance.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const testUrl = process.env.SUPABASE_TEST_URL ?? "";
const testAnonKey = process.env.SUPABASE_TEST_ANON_KEY ?? "";

describe.skipIf(!testUrl || !testAnonKey)("analysis RLS isolation (live Supabase)", () => {
  const password = "TestPassword123!";
  const emailA = `rls-a-${Date.now()}@example.com`;
  const emailB = `rls-b-${Date.now()}@example.com`;
  let clientA: ReturnType<typeof createClient>;
  let clientB: ReturnType<typeof createClient>;
  let analysisId = "";
  let candidateId = "";

  beforeAll(async () => {
    clientA = createClient(testUrl, testAnonKey);
    clientB = createClient(testUrl, testAnonKey);

    const { error: signUpA } = await clientA.auth.signUp({ email: emailA, password });
    const { error: signUpB } = await clientB.auth.signUp({ email: emailB, password });
    if (signUpA) throw signUpA;
    if (signUpB) throw signUpB;

    const { error: signInA } = await clientA.auth.signInWithPassword({ email: emailA, password });
    const { error: signInB } = await clientB.auth.signInWithPassword({ email: emailB, password });
    if (signInA) throw signInA;
    if (signInB) throw signInB;

    const {
      data: { user: userA },
    } = await clientA.auth.getUser();
    if (!userA) throw new Error("user A not signed in");

    const { data: candidate, error: candErr } = await clientA
      .from("candidates")
      .insert({
        user_id: userA.id,
        cv_text: "RLS test CV with enough readable content for storage.",
        file_name: "rls.txt",
      })
      .select("id")
      .single();
    if (candErr) throw candErr;
    if (!candidate) throw new Error("candidate insert failed");
    candidateId = candidate.id as string;

    const { data: analysis, error: analysisErr } = await clientA
      .from("analyses")
      .insert({ user_id: userA.id, candidate_id: candidateId, status: "parsing" })
      .select("id")
      .single();
    if (analysisErr) throw analysisErr;
    if (!analysis) throw new Error("analysis insert failed");
    analysisId = analysis.id as string;
  });

  it("user B cannot read user A's analysis (RLS → zero rows)", async () => {
    const { data, error } = await clientB.from("analyses").select("id").eq("id", analysisId).single();
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});
