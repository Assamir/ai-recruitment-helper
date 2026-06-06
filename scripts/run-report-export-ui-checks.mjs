/* global process, console */
/* eslint-disable no-console -- manual UI verification */
/**
 * Manual UI verification for report-export phase 3.
 * Uses E2E_EMAIL/E2E_PASSWORD or TEST_EMAIL/TEST_PASS from .env / .dev.vars.
 */
import { readFileSync, existsSync } from "node:fs";
import { chromium } from "@playwright/test";
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

if (!email || !password) {
  console.error("Missing credentials.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const { data: signIn } = await supabase.auth.signInWithPassword({ email, password });
if (!signIn.session) process.exit(1);

const cookieJar = [];
const serverClient = createServerClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
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
  access_token: signIn.session.access_token,
  refresh_token: signIn.session.refresh_token,
});

const { data: completed } = await supabase
  .from("analyses")
  .select("id")
  .eq("user_id", signIn.session.user.id)
  .eq("status", "completed")
  .limit(1)
  .single();

if (!completed) {
  console.error("No completed analysis for UI checks.");
  process.exit(1);
}

// Ephemeral processing analysis for 3.5 negative case
const { data: profiles } = await supabase.from("job_profiles").select("id").limit(1);
const { data: cand } = await supabase
  .from("candidates")
  .insert({ user_id: signIn.session.user.id, cv_text: "UI gate CV", file_name: "ui-gate.txt" })
  .select("id")
  .single();
const { data: processing } = await supabase
  .from("analyses")
  .insert({
    user_id: signIn.session.user.id,
    candidate_id: cand.id,
    job_profile_id: profiles[0].id,
    status: "processing",
  })
  .select("id")
  .single();

let failed = 0;
function pass(label, ok) {
  console.log(ok ? `PASS  ${label}` : `FAIL  ${label}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  baseURL: baseUrl,
});
await context.addCookies(
  cookieJar.map((c) => ({
    name: c.name,
    value: c.value,
    domain: "localhost",
    path: "/",
  })),
);
const page = await context.newPage();

// 3.5 completed — export buttons visible
await page.goto(`/dashboard/${completed.id}`);
await page.waitForTimeout(2000);
const mdBtn = page.getByRole("button", { name: "Export Markdown" });
const pdfBtn = page.getByRole("button", { name: "Export PDF" });
pass("3.5 export buttons on completed analysis", (await mdBtn.isVisible()) && (await pdfBtn.isVisible()));

// 3.5 processing — no export buttons
await page.goto(`/dashboard/${processing.id}`);
await page.waitForTimeout(1500);
pass(
  "3.5 no export buttons on in-progress analysis",
  (await page.getByRole("button", { name: "Export Markdown" }).count()) === 0,
);

// 3.6 markdown download
await page.goto(`/dashboard/${completed.id}`);
await page.waitForTimeout(2000);
const mdBtnDone = page.getByRole("button", { name: "Export Markdown" });
const [download] = await Promise.all([page.waitForEvent("download"), mdBtnDone.click()]);
const filename = download.suggestedFilename();
pass("3.6 markdown download triggered", filename.endsWith(".md"));

// 3.7 error message + re-enable
await page.route(`**/api/analysis/${completed.id}/export?format=md`, (route) =>
  route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Server blew up" }) }),
);
await page.getByRole("button", { name: "Export Markdown" }).click();
await page.waitForTimeout(500);
const errText = await page.getByText("Server blew up").isVisible();
const reenabled = await page.getByRole("button", { name: "Export Markdown" }).isEnabled();
pass("3.7 error message visible", errText);
pass("3.7 buttons re-enabled after error", reenabled);

// 3.6 PDF opens new tab (check popup)
await page.unrouteAll();
const popupPromise = page.waitForEvent("popup");
await page.getByRole("button", { name: "Export PDF" }).click();
const popup = await popupPromise;
await popup.waitForLoadState("domcontentloaded");
const popupHtml = await popup.content();
pass(
  "3.6 PDF opens printable HTML tab",
  popupHtml.includes("CONFIDENTIAL") && popupHtml.includes("window.print()"),
);
await popup.close();

await browser.close();
await supabase.from("analyses").delete().eq("id", processing.id);
await supabase.from("candidates").delete().eq("id", cand.id);

console.log(failed === 0 ? "\nAll report-export manual UI checks PASS" : `\n${failed} UI check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
