---
change_id: testing-main-flow-e2e
title: E2E test the main recruitment flow
status: complete
created: 2026-06-05
updated: 2026-06-05
archived_at: null
---

## Notes

context/foundation/test-plan.md

Protects **Risk #8** (test-plan §3 Phase 5): logged-in recruiter pastes CV text,
submits, and reaches a rendered results view — LLM stubbed at the network edge.

### E2E infrastructure built (via /10x-e2e)

- `@playwright/test` installed; Chromium installed.
- `playwright.config.ts` — `setup` (auth) + `chromium` (storageState) projects;
  `webServer` starts the LLM stub + the app.
- `tests/e2e/support/llm-stub.mjs` — OpenAI-compatible stub bound to the lmstudio
  base URL (`localhost:1234`) the server calls; returns
  `tests/e2e/fixtures/analysis-response.json` (the oracle). Smoke-tested OK.
- `tests/e2e/auth.setup.ts` — signs in once via UI → `tests/e2e/.auth/user.json`.
- `tests/e2e/main-flow.spec.ts` — the Risk #8 happy-path test (role-based locators,
  wait-for-state, asserts the stubbed result renders, cleans up its row in afterEach).
- `tests/e2e/E2E_RULES.md` (rules lever) + `tests/e2e/README.md` (run + deliberate-break).
- Real boundaries (auth, routing, Supabase) stay live; only the LLM is stubbed.

### Verified (VERIFY) — GREEN

- `npx playwright test` → **2 passed** (setup + main-flow) against the real app +
  Supabase with the LLM stubbed. Credentials read from `.dev.vars`
  (`E2E_EMAIL`/`E2E_PASSWORD`).
- Falsifiability confirmed: a deliberate break (stub returns malformed JSON →
  pipeline fails, result never renders) turns the test **RED** at the
  "Match Summary" assertion; the break was reverted.
- Fixes made while verifying: exact-match auth locators (avoid the "Show password"
  toggle); retry fill to beat the React island hydration race; exact "Completed"
  match (avoid a raw JSON dump on the page).

No `plan.md` exists for this change — built as a standalone E2E setup + single
risk-driven test rather than the plan-driven path. Changes are uncommitted.
