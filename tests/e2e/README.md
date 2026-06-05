# E2E tests (Playwright)

Browser-level coverage for the main recruitment flow. Currently one risk:

- **Risk #8** (`context/foundation/test-plan.md` §3 Phase 5) — a logged-in recruiter
  pastes CV text, submits, and reaches a *rendered* results view. See
  `main-flow.spec.ts`.

Rules every spec follows: `E2E_RULES.md`. Seed exemplar: `../fixtures/seed.spec.ts`.

## What is real vs stubbed

| Boundary | In the test |
|---|---|
| Auth, routing, Supabase (DB) | **real** — integration risk lives here |
| LLM | **stubbed** at the network edge (`support/llm-stub.mjs`) — deterministic |

The analysis runs server-side (`waitUntil` background pipeline), so the LLM cannot be
intercepted from the browser. The stub binds `http://localhost:1234/v1` — the lmstudio
base URL the server calls (`src/lib/llm/types.ts` `LMSTUDIO_BASE_URL`). Playwright starts
it via `webServer`, with the app forced to `LLM_PROVIDER=lmstudio`.

## Prerequisites (the run needs your environment)

1. **`.env`** at repo root with a real Supabase project:
   ```
   SUPABASE_URL=...
   SUPABASE_KEY=...
   ```
2. **A test user** that already exists in that Supabase project. Add these to
   `.dev.vars` (preferred — where `SUPABASE_*` already live) or `.env`; the Playwright
   config loads both automatically:
   ```
   E2E_EMAIL=you@example.com
   E2E_PASSWORD=...
   ```
3. **At least one `job_profiles` row** (the form's profile dropdown must be non-empty).
4. **Port 1234 free** — turn off any real LM Studio so the stub can bind it.

## Run

```
# starts the LLM stub + the app, signs in once, then runs the spec
npx playwright test

# headed / debug
npx playwright test --headed
npx playwright test --debug

# single spec
npx playwright test tests/e2e/main-flow.spec.ts
```

If the Cloudflare `cfContext.waitUntil` background pipeline does not run under
`astro dev`, point the app webServer at the built worker instead:

```
E2E_WEB_COMMAND="npm run preview" npx playwright test
```

## Falsifiability — deliberate break (do this once to trust the test)

The test must go RED when Risk #8 materializes. Temporarily break the flow, confirm
red, then revert:

- Make the result never render: in `src/components/analysis/AnalysisView.tsx`, force
  the early `Loading results…` return (so progress never resolves), **or**
- Make the pipeline fail: in `support/llm-stub.mjs`, return malformed JSON
  (`content: "not json"`) so `status` becomes `failed`.

Either change should fail the "Match Summary" / "Completed" assertions. **Revert it** —
never commit the break.
