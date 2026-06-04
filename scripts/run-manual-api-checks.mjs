/* global process, console, fetch */
/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition, no-console -- manual verification script */
/**
 * Manual API checks 1.5 / 1.6 / 1.7 — credentials via env only (never commit secrets).
 *
 *   $env:TEST_EMAIL="..."; $env:TEST_PASS="..."; $env:DEV_URL="http://localhost:4323"
 *   node scripts/run-manual-api-checks.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

function loadDevVars() {
  const text = readFileSync(".dev.vars", "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i)] = t.slice(i + 1);
  }
  return env;
}

const GARBAGE_CV = `
%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
stream xC5x9E2A1B@@@@####....%%%%.... 0xFF 0x00 /Filter /FlateDecode /Length 4096
endstream
trailer << /Root 1 0 R >>
`.trim();

const TERSE_CV = `
Alex Rivera
QA Engineer
Skills: Playwright, Cypress, API testing, test design, CI pipelines.
`.trim();

const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASS;
const baseUrl = process.env.DEV_URL ?? "http://localhost:4323";

if (!email || !password) {
  console.error("Set TEST_EMAIL and TEST_PASS environment variables.");
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_KEY } = loadDevVars();
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
if (signInErr || !signIn.session) {
  console.error("Sign in failed:", signInErr?.message ?? "no session");
  process.exit(1);
}

const session = signIn.session;
const userId = session.user.id;

const cookieJar = [];
const serverClient = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
  cookies: {
    getAll: () => cookieJar,
    setAll: (cookiesToSet) => {
      for (const { name, value } of cookiesToSet) {
        const i = cookieJar.findIndex((c) => c.name === name);
        if (i >= 0) cookieJar[i] = { name, value };
        else cookieJar.push({ name, value });
      }
    },
  },
});
await serverClient.auth.setSession({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
});
const cookieHeader = cookieJar.map((c) => `${c.name}=${c.value}`).join("; ");

const { data: profiles } = await supabase.from("job_profiles").select("id").limit(1);
if (!profiles?.length) {
  console.error("No job_profiles in database");
  process.exit(1);
}
const jobProfileId = profiles[0].id;

async function postAnalysis(fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const res = await fetch(`${baseUrl}/api/analysis`, {
    method: "POST",
    headers: { Cookie: cookieHeader },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

let failed = 0;

// 1.5 — garbage paste
console.log("\n=== 1.5 garbage cv_text ===");
const r15 = await postAnalysis({ job_profile_id: jobProfileId, cv_text: GARBAGE_CV });
console.log("status:", r15.status, "body:", r15.json);
const ok15 = r15.status === 400 && r15.json.code === "INSUFFICIENT_CONTENT";
console.log(ok15 ? "PASS" : "FAIL");
if (!ok15) failed++;

// 1.6 — terse real CV
console.log("\n=== 1.6 terse real cv_text ===");
const r16 = await postAnalysis({ job_profile_id: jobProfileId, cv_text: TERSE_CV });
console.log("status:", r16.status, "body:", r16.json);
const ok16 = r16.status === 201 || r16.status === 503;
const bad16 = r16.json.code === "INSUFFICIENT_CONTENT";
console.log(ok16 && !bad16 ? "PASS" : "FAIL", "(201=started, 503=LLM missing but gate passed)");
if (!ok16 || bad16) failed++;

// 1.7 — retry with garbage in DB
console.log("\n=== 1.7 retry candidate_id + garbage cv_text ===");
const { data: cand, error: insErr } = await supabase
  .from("candidates")
  .insert({ user_id: userId, cv_text: GARBAGE_CV, file_name: "garbage-1-7.txt" })
  .select("id")
  .single();
if (insErr) {
  console.error("Insert candidate failed:", insErr.message);
  failed++;
} else {
  const r17 = await postAnalysis({ job_profile_id: jobProfileId, candidate_id: cand.id });
  console.log("status:", r17.status, "body:", r17.json);
  const { count } = await supabase
    .from("analyses")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", cand.id);
  console.log("analyses count for candidate:", count);
  const ok17 = r17.status === 400 && r17.json.code === "INSUFFICIENT_CONTENT" && (count ?? 0) === 0;
  console.log(ok17 ? "PASS" : "FAIL");
  if (!ok17) failed++;
  await supabase.from("candidates").delete().eq("id", cand.id);
}

// Cleanup analysis from 1.6 if created
if (r16.status === 201 && r16.json.analysis_id) {
  await supabase.from("analyses").delete().eq("id", r16.json.analysis_id);
  console.log("\n(cleaned up analysis from 1.6:", r16.json.analysis_id, ")");
}

console.log(failed === 0 ? "\nAll manual API checks PASS" : `\n${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
