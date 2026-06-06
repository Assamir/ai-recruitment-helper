/* global process, console, fetch */
/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-condition, no-console -- manual verification script */
/**
 * Manual verification for report-export (plan phases 1–2 API + render checks).
 *
 *   $env:TEST_EMAIL / $env:TEST_PASS  (or E2E_EMAIL / E2E_PASSWORD)
 *   $env:DEV_URL="http://localhost:4321"
 *   node scripts/run-report-export-manual-checks.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i)] = t.slice(i + 1);
  }
  return env;
}

const fileEnv = { ...loadEnvFile(".dev.vars"), ...loadEnvFile(".env") };
for (const [k, v] of Object.entries(fileEnv)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const email = process.env.TEST_EMAIL ?? process.env.E2E_EMAIL;
const password = process.env.TEST_PASS ?? process.env.E2E_PASSWORD;
const baseUrl = process.env.DEV_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:4321";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!email || !password) {
  console.error("Set TEST_EMAIL/TEST_PASS or E2E_EMAIL/E2E_PASSWORD.");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_KEY required (.env or .dev.vars).");
  process.exit(1);
}

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

async function exportFetch(analysisId, format) {
  const url = `${baseUrl}/api/analysis/${analysisId}/export?format=${format}`;
  return fetch(url, { headers: { Cookie: cookieHeader } });
}

const { data: analyses, error: listErr } = await supabase
  .from("analyses")
  .select("id, status, match_summary, created_at, candidate_id, candidates(linkedin_text, first_name, last_name, pii_map)")
  .eq("user_id", userId)
  .order("created_at", { ascending: false })
  .limit(50);

if (listErr || !analyses?.length) {
  console.error("No analyses found:", listErr?.message ?? "empty");
  process.exit(1);
}

const completed = analyses.filter((a) => a.status === "completed");
const inProgress = analyses.find((a) => a.status === "processing" || a.status === "pending");
const cvOnly = completed.find((a) => !a.candidates?.linkedin_text?.trim());
const linkedIn = completed.find((a) => Boolean(a.candidates?.linkedin_text?.trim()));

console.log(`User ${userId.slice(0, 8)}… — ${completed.length} completed, base ${baseUrl}`);

let failed = 0;
const outDir = join("context", "changes", "report-export", "manual-verify");
mkdirSync(outDir, { recursive: true });

function pass(label, ok, detail = "") {
  console.log(ok ? `PASS  ${label}` : `FAIL  ${label}`, detail);
  if (!ok) failed++;
}

// 2.6 / 1.6 — markdown export
if (cvOnly) {
  const res = await exportFetch(cvOnly.id, "md");
  const body = await res.text();
  writeFileSync(join(outDir, "sample-cv-only.md"), body, "utf8");
  const disp = res.headers.get("Content-Disposition") ?? "";
  pass(
    "2.6 CV-only markdown download",
    res.status === 200 &&
      res.headers.get("Content-Type")?.includes("text/markdown") &&
      disp.includes("attachment") &&
      disp.includes(".md") &&
      body.includes("# CONFIDENTIAL") &&
      body.includes("anonymized candidate analysis"),
    `status=${res.status}`,
  );
  pass("1.6 Markdown header prominent", body.startsWith("# CONFIDENTIAL"), "starts with header");
} else {
  console.warn("SKIP 2.6/1.6 — no completed CV-only analysis");
  failed++;
}

// 2.7 / 1.7 — printable HTML
const htmlTarget = linkedIn ?? cvOnly;
if (htmlTarget) {
  const res = await exportFetch(htmlTarget.id, "pdf");
  const body = await res.text();
  writeFileSync(join(outDir, "sample-printable.html"), body, "utf8");
  pass(
    "2.7 printable HTML (format=pdf)",
    res.status === 200 &&
      res.headers.get("Content-Type")?.includes("text/html") &&
      body.includes("<!doctype html>") &&
      body.includes("window.print()") &&
      body.includes("CONFIDENTIAL"),
    `status=${res.status}`,
  );
  pass(
    "1.7 HTML legible structure",
    body.includes("<h1>") && body.includes("Match Summary") && body.includes("@page"),
    "print CSS + sections",
  );
} else {
  console.warn("SKIP 2.7/1.7 — no completed analysis");
  failed++;
}

// 2.8 — LinkedIn path redaction
if (linkedIn) {
  const cand = linkedIn.candidates;
  const rawNames = [cand?.first_name, cand?.last_name].filter(Boolean);
  const res = await exportFetch(linkedIn.id, "md");
  const body = await res.text();
  writeFileSync(join(outDir, "sample-linkedin.md"), body, "utf8");
  const leaksName = rawNames.some((n) => n && body.includes(n));
  const leaksEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(body);
  pass(
    "2.8 LinkedIn export redacts seeded name/email",
    res.status === 200 && !leaksName && !leaksEmail,
    leaksName ? `leaked name: ${rawNames.join(" ")}` : leaksEmail ? "leaked email" : "clean",
  );
} else {
  console.warn("SKIP 2.8 — no completed LinkedIn analysis; seeding synthetic check via Supabase insert skipped");
}

// 409 non-completed
if (inProgress) {
  const res = await exportFetch(inProgress.id, "md");
  const json = await res.json().catch(() => ({}));
  pass("409 in-progress export blocked", res.status === 409 && json.code === "ANALYSIS_NOT_COMPLETED", `status=${res.status}`);
} else {
  console.log("INFO  no in-progress analysis — creating ephemeral processing row");
  const { data: profiles } = await supabase.from("job_profiles").select("id").limit(1);
  const { data: cand } = await supabase
    .from("candidates")
    .insert({ user_id: userId, cv_text: "Test CV for export gate.", file_name: "export-gate.txt" })
    .select("id")
    .single();
  if (profiles?.[0] && cand) {
    const { data: proc } = await supabase
      .from("analyses")
      .insert({
        user_id: userId,
        candidate_id: cand.id,
        job_profile_id: profiles[0].id,
        status: "processing",
      })
      .select("id")
      .single();
    if (proc) {
      const res = await exportFetch(proc.id, "md");
      const json = await res.json().catch(() => ({}));
      pass("409 processing export blocked", res.status === 409 && json.code === "ANALYSIS_NOT_COMPLETED");
      await supabase.from("analyses").delete().eq("id", proc.id);
    }
    await supabase.from("candidates").delete().eq("id", cand.id);
  }
}

// 400 invalid format
if (completed[0]) {
  const res = await fetch(`${baseUrl}/api/analysis/${completed[0].id}/export?format=docx`, {
    headers: { Cookie: cookieHeader },
  });
  const json = await res.json().catch(() => ({}));
  pass("400 invalid format", res.status === 400 && json.code === "BAD_REQUEST");
}

console.log(failed === 0 ? "\nAll report-export manual API checks PASS" : `\n${failed} check(s) FAILED`);
console.log(`Artifacts: ${outDir}/`);
process.exit(failed === 0 ? 0 : 1);
