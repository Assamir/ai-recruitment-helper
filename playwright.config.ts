import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

/**
 * Playwright runs in plain Node and does not auto-load env files. Load the project's
 * dotenv-style files so E2E_EMAIL / E2E_PASSWORD (and anything else the harness needs)
 * are available without a separate shell export. `.dev.vars` is where the app's local
 * secrets already live; `.env` is read second. Existing process.env always wins.
 */
function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".dev.vars");
loadEnvFile(".env");

/**
 * E2E config for the main recruitment flow (Risk #8, test-plan §3 Phase 5).
 *
 * Real boundaries (auth, routing, Supabase) stay live; only the LLM — the
 * expensive, non-deterministic external API — is stubbed at the network edge.
 * The stub binds the lmstudio base URL the server calls (see src/lib/llm/types.ts
 * `LMSTUDIO_BASE_URL`), so the app's server-side analysis pipeline is deterministic.
 *
 * Prerequisites the run needs (see tests/e2e/README.md):
 *   - A `.env` with valid SUPABASE_URL / SUPABASE_KEY (real Supabase: auth + DB).
 *   - E2E_EMAIL / E2E_PASSWORD for an existing test user.
 *   - At least one seeded `job_profiles` row.
 *   - Port 1234 free (real LM Studio must be off; the stub binds it during the run).
 */

const PORT = Number(process.env.E2E_PORT ?? 4321);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// Must match LMSTUDIO_BASE_URL in src/lib/llm/types.ts (host:port the server calls).
const LLM_STUB_PORT = 1234;

// Default to `astro dev`; override (e.g. `npm run preview`) via E2E_WEB_COMMAND if
// the Cloudflare `cfContext.waitUntil` background pipeline needs the built worker.
const WEB_COMMAND = process.env.E2E_WEB_COMMAND ?? "npm run dev";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "node tests/e2e/support/llm-stub.mjs",
      url: `http://localhost:${LLM_STUB_PORT}/health`,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    },
    {
      command: WEB_COMMAND,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Force the stubbed LLM edge for deterministic runs.
        LLM_PROVIDER: "lmstudio",
        LLM_MODEL: "e2e-stub",
      },
    },
  ],
});
