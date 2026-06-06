/* eslint-disable @typescript-eslint/no-unnecessary-condition -- gated live Supabase integration test */
/**
 * Pipeline-integrity characterization — the background `pii_map` UPDATE must
 * affect rows under live RLS. Skipped without Supabase env vars (see tests/rls/setup.ts).
 *
 * Updated after the "Users update own candidates" UPDATE policy was added
 * (migration 20260606130000): the owning user's UPDATE is now authorized and
 * persists, instead of silently no-opping. See context/foundation/lessons.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { ensureSignedIn } from "./auth-helper";

const testUrl = process.env.SUPABASE_TEST_URL ?? "";
const testAnonKey = process.env.SUPABASE_TEST_ANON_KEY ?? "";

describe.skipIf(!testUrl || !testAnonKey)("candidates UPDATE RLS (live Supabase)", () => {
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
        cv_text: "RLS UPDATE characterization CV with enough readable content.",
        file_name: "rls-update.txt",
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    if (!candidate) throw new Error("candidate insert failed");
    candidateId = candidate.id;
  });

  it("permits and persists the owning user's pii_map UPDATE under RLS", async () => {
    const testMap = { "[CANDIDATE_NAME]": "Jane Doe" };

    const { error: updateErr } = await client.from("candidates").update({ pii_map: testMap }).eq("id", candidateId);
    expect(updateErr).toBeNull();

    const { data: reread, error: readErr } = await client
      .from("candidates")
      .select("pii_map")
      .eq("id", candidateId)
      .single();

    expect(readErr).toBeNull();

    // With the matching UPDATE policy in place, the write takes effect and the
    // value is re-readable (was a silent 0-row no-op before the policy existed).
    expect(reread?.pii_map).toEqual(testMap);
  });
});
