/* eslint-disable @typescript-eslint/no-unnecessary-condition -- gated live Supabase integration test */
/**
 * BUG REPRODUCTION (RED) — "Supabase writes need a matching RLS policy AND an error check"
 * See context/foundation/lessons.md.
 *
 * The background pipeline (src/pages/api/analysis/index.ts) persists `pii_map` via an
 * UPDATE on `candidates`. The `candidates` table ships SELECT/INSERT/DELETE RLS policies
 * but NO UPDATE policy, so the owning user's UPDATE silently affects 0 rows: `pii_map`
 * stays NULL and — because RLS denials surface as empty result sets, not thrown errors —
 * no error is raised. The audit trail the pipeline claims to write is never persisted.
 *
 * This test asserts the CORRECT, fix-target behavior: an owning user's `pii_map` UPDATE
 * is persisted and re-readable. It is EXPECTED TO FAIL until a matching UPDATE policy is
 * added to `candidates` (and is the inverse of the characterization test in
 * candidates-update.rls.test.ts, which documents the current buggy no-op).
 *
 * Skipped without Supabase env vars (see tests/rls/setup.ts).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { ensureSignedIn } from "./auth-helper";

const testUrl = process.env.SUPABASE_TEST_URL ?? "";
const testAnonKey = process.env.SUPABASE_TEST_ANON_KEY ?? "";

describe.skipIf(!testUrl || !testAnonKey)("candidates pii_map UPDATE persists under RLS (live Supabase)", () => {
  const password = "TestPassword123!";
  const email = "rls-cand-update-test@gmail.com";

  let client: SupabaseClient<Database>;
  let candidateId = "";

  beforeAll(async () => {
    client = createClient<Database>(testUrl, testAnonKey);
    await ensureSignedIn(client, email, password);

    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) throw new Error("user not signed in");

    const { data: candidate, error: insertErr } = await client
      .from("candidates")
      .insert({
        user_id: user.id,
        cv_text: "PII map UPDATE reproduction CV with enough readable content.",
        file_name: "rls-pii-map.txt",
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    if (!candidate) throw new Error("candidate insert failed");
    candidateId = candidate.id;
  });

  it("persists pii_map for the owning user (currently no-ops — reproduces the bug)", async () => {
    const testMap = { "[CANDIDATE_NAME]": "Jane Doe", "[EMAIL]": "jane@example.com" };

    // Mirrors the pipeline write: UPDATE candidates SET pii_map = ... WHERE id = candidateId.
    const { error: updateErr } = await client.from("candidates").update({ pii_map: testMap }).eq("id", candidateId);

    // The write must not error — and, crucially, it must actually take effect.
    expect(updateErr).toBeNull();

    const { data: reread, error: readErr } = await client
      .from("candidates")
      .select("pii_map")
      .eq("id", candidateId)
      .single();

    expect(readErr).toBeNull();

    // FIX TARGET: with a matching UPDATE policy, the value is persisted.
    // Today there is no UPDATE policy, so the write is a silent 0-row no-op and
    // pii_map stays null — this assertion FAILS, reproducing the documented bug.
    expect(reread?.pii_map).toEqual(testMap);
  });
});
