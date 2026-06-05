---
date: 2026-06-05T15:30:00+02:00
researcher: dczaj
git_commit: 5d9b5e3b5eefe88ce43ccab474ffbe90d751060d
branch: main
repository: ai-recruitment-helper
topic: "Pipeline integration & quality gates (Phase 4 / Risk #6 + cross-cutting)"
tags: [research, codebase, pipeline, integration-test, ci, quality-gates, waitUntil, llm, risk-6]
status: complete
last_updated: 2026-06-05
last_updated_by: dczaj
---

# Research: Pipeline integration & quality gates

**Date**: 2026-06-05T15:30:00+02:00
**Researcher**: dczaj
**Git Commit**: 5d9b5e3b5eefe88ce43ccab474ffbe90d751060d
**Branch**: main
**Repository**: ai-recruitment-helper

## Research Question

Phase 4 of the test rollout (`context/foundation/test-plan.md` §3): prove the
analysis pipeline **holds together end-to-end with a mocked LLM**, that failures
**surface as clean errors rather than silent false success** (Risk #6), and
**lock the floor in CI** with the quality gates from §5. Research both halves
equally and in detail; observability is deferred to a follow-up note.

## Summary

The analysis pipeline is **two-phase**: a synchronous front-half inside
`POST /api/analysis` (auth → form parse → CV-text resolution → quality gate →
DB inserts → LLM config preflight) that always returns **`201 { analysis_id }`**,
and an **asynchronous back-half** run inside `context.locals.cfContext.waitUntil(...)`
(anonymize → status updates → job-profile fetch → prompt build → `completeLLM` →
insert questions → mark `completed`). All failure taxonomy in the back-half is
flattened into `analyses.status = "failed"` + a string `error_message`, observable
only by polling `GET /api/analysis/[id]/status`.

**The core Risk #6 finding:** no existing test executes the back-half at all. The
shared `makeApiContext` helper stubs `waitUntil` as a no-op (`vi.fn()`), so every
current POST test returns `201` **without running anonymize → LLM → store**. The
full chain (real `anonymizeCV` + real `completeLLM` with `ai` mocked at the network
edge + store + observable `failed`/`completed`) is **net-new coverage** — exactly
the hole Phases 1–3 explicitly deferred here.

**The CI half:** CI runs `lint → test (vitest run) → build`. Two material gaps vs
test-plan §5: (1) **`astro check` / `npm run typecheck` does NOT run in CI** —
§5's "lint + typecheck … already wired" overstates reality (typecheck is
lefthook-local only); (2) there is **no pipeline-integration gate** because the
test doesn't exist yet. The `rls` Vitest project runs in CI but **self-skips**
(no `SUPABASE_TEST_URL`), which is by design. A stale Husky/`lint-staged` setup
coexists with the active Lefthook config and should be reconciled.

**Inherited Phase-4 follow-ups** (logged by Phase 3): magic-byte verification,
Zod request schemas, SSR foreign-id read paths, and **`candidates` UPDATE RLS** —
the last is a latent *pipeline-integrity* bug (the background `pii_map` update may
affect 0 rows under real RLS).

## Detailed Findings

### Area 1 — Pipeline orchestration & error seams

Entry point: `src/pages/api/analysis/index.ts`.

**Synchronous front-half** (returns HTTP JSON with a `code`):

| Stage | Condition | HTTP | `code` | Ref |
|---|---|---|---|---|
| Auth | no session | 401 | `UNAUTHORIZED` | `index.ts:14-16` |
| Supabase | `createClient` null | 503 | `SERVICE_UNAVAILABLE` | `index.ts:19-21` |
| Form | `formData()` throws | 400 | `BAD_REQUEST` | `index.ts:27-31` |
| Validation | missing/bad `job_profile_id` (UUID) | 400 | `BAD_REQUEST` | `index.ts:40-45` |
| Retry (branch A) | bad `candidate_id` / not found / no stored text | 400 / 404 | `BAD_REQUEST` / `NOT_FOUND` | `index.ts:52-71` |
| Parse (branch B) | `CVParseError` / other | 400 | `err.code` / `PARSE_FAILED` | `index.ts:79-82` |
| Paste (branch C) | none of A/B/C | 400 | `BAD_REQUEST` | `index.ts:84-88` |
| Quality gate | `CVParseError` (`INSUFFICIENT_CONTENT`) | 400 | `INSUFFICIENT_CONTENT` | `index.ts:91-98` |
| Quality gate | **non-`CVParseError`** | — | **unhandled 500 (no JSON envelope)** | `index.ts:97` |
| DB insert | candidate / analysis insert error | 500 | `DB_ERROR` | `index.ts:122-124, 139-141` |
| LLM config | `!llmModel` | 503 | `LLM_CONFIG_ERROR` | `index.ts:148-153` |
| Success | — | **201** | `{ analysis_id }` (no code) | `index.ts:221` |

**Asynchronous back-half** (`index.ts:161-219`, inside `cfCtx.waitUntil(async IIFE)`):
sets `status` to `anonymizing` → `analyzing`, runs `anonymizeCV` (sync, no throw),
updates `candidates.pii_map`, fetches `job_profiles`, builds the prompt, calls
`completeLLM`, inserts `analysis_questions` (only if `length > 0`), then flips
`analyses` to `completed`. Any throw hits a single catch that writes
`status:"failed"` + `error_message = err.message` (`index.ts:214-217`). **All LLM
`.code` taxonomy is discarded** at this layer.

The LLM **network edge** (the `vi.mock("ai")` seam) is:

```90:96:src/lib/llm/client.ts
      const result = await generateText({
        model,
        prompt: jsonPrompt,
        system: systemPrompt,
        abortSignal: controller.signal,
      });
```

`completeLLM` parses `result.text` via `extractJSON` + `AnalysisResponseSchema.safeParse`
→ throws `LLMParseError` on mismatch (`src/lib/llm/client.ts:99-103`); timeout is
`55_000ms` (`src/lib/llm/types.ts:19`). Error classes: `LLMConfigError`,
`LLMConnectionError`, `LLMTimeoutError`, `LLMParseError` (`src/lib/llm/errors.ts`).

**Candidate silent-failure seams (the heart of Risk #6):**

1. **`201` before the background runs** — client must poll to learn failure (`index.ts:221`).
2. **Catch flattens taxonomy** — typed `.code` lost; only a string survives (`index.ts:215-216`).
3. **Unchecked background DB writes** — every `update`/`insert` result is ignored; a failed write may never set `failed` (`index.ts:165,169,172,202,205-213,216`).
4. **`analysis_questions` insert failure** — if it errors without throwing, code still marks `completed` (`index.ts:201-213`).
5. **Empty `questions: []` is a valid completion** — schema + route accept it; indistinguishable from model under-production (`src/lib/analysis/schema.ts:16-19`, `index.ts:201-213`).
6. **Non-existent `job_profile_id`** — sync phase creates rows; background fails late with generic `"Job profile not found"` (`index.ts:174-180`).
7. **`candidates` UPDATE RLS gap** — background `pii_map` update may affect 0 rows under real RLS (see Area 4 / inherited follow-up).
8. **`waitUntil` stubbed in all API tests** — POST tests get `201` with the pipeline never running → false CI confidence (`tests/helpers/api-context.ts:27`).

Observation surface for async outcomes: `GET /api/analysis/[id]/status`
(`status`, `match_summary?`, `error_message?`; `src/pages/api/analysis/[id]/status.ts:34-41`)
and `GET /api/analysis/[id]` (full result). Client polling: `AnalysisProgress.tsx`
(3s interval, ~60 polls, keeps polling on `!res.ok`, client-only timeout not written to DB).

### Area 2 — Test infrastructure reusable for the pipeline test

**Helpers** (`tests/helpers/`):
- `makeApiContext(opts)` — synthetic `APIContext`; default user `USER_A`;
  **`locals.cfContext.waitUntil` is `vi.fn()` (no-op)** (`tests/helpers/api-context.ts:19-42`, esp. `:27`). **Must be overridden** to capture and `await` the background promise, e.g. `waitUntil: vi.fn((p) => p)`.
- `makeFakeSupabase({ actingUserId, tables })` — ownership-enforcing double over
  `analyses`/`candidates`/`analysis_questions`/`job_profiles`; models the handler
  contract, **not real RLS** (`tests/helpers/fake-supabase.ts:1-8, 156-174`).
  **Gap:** no bulk `insert(array)` without `.single()` — the pipeline does
  `insert(questions)` without `.single()` (`index.ts:201-202`), so questions may
  not persist unless the fake is extended.
- `tests/helpers/ids.ts` — canonical UUID literals (`USER_A`, `JOB_PROFILE_ID`, …).

**LLM mocking — two patterns:**
- **Pattern A (network edge, the one Risk #6 needs):** `vi.mock("ai")` replacing
  `generateText`, plus provider-factory mocks, returning `{ text: "<JSON>" }`
  (`tests/lib/llm/client.test.ts:7-34, 71-74`). Real `completeLLM` then runs +
  Zod-parses. Requires `getLLMConfig`/`createLLMModel` to succeed (reads
  `astro:env/server` via `src/lib/llm/config.ts:1-23`) — so either partial-mock
  `@/lib/llm` (real `completeLLM`, stubbed config) or mock `astro:env/server`.
- **Pattern B (module edge, current API tests):** `vi.mock("@/lib/llm")` stubbing
  `completeLLM` entirely (`tests/lib/api/analysis-isolation.test.ts:7-11`). Good
  for isolation/validation, **wrong for Risk #6** (short-circuits the chain).

**Fixtures** (`tests/fixtures/`):
- `analysis/*.json` triples `(anonymizedText, profile, response)` — use `response`
  as the `mockGenerateText` payload and `profile` to seed `job_profiles`;
  `grounded.json` / `recorded-run-1.json` (happy), `ungrounded.json` (negative),
  `empty-questions.json` (no-questions completion).
- `cv/catchable.ts` — raw-PII CV, the best **upload/paste input** for a full run
  (`CATCHABLE_CV_FIXTURES[0].cv`). `cv/accepted-miss.ts` is for characterization.
- `findUngroundedClaims(oracle, response)` (`tests/lib/analysis/faithfulness.ts:172-196`,
  threshold `0.55`) — reusable post-pipeline grounding assert.

**Canonical API-route integration pattern** (best composite reference
`tests/lib/api/analysis-isolation.test.ts`): hoist `vi.mock` before handler import;
import `POST`/`GET` from `@/pages/api/...`; swap `createClient` via a closure
(`createClientImpl`); seed with `makeFakeSupabase`; build ctx with `makeApiContext`;
assert HTTP status + JSON `code`.

**Location:** a new `tests/lib/api/analysis-pipeline-integration.test.ts` is auto-picked
by the Vitest `node` project (`include: ["tests/lib/**/*.test.ts"]`).

### Area 3 — CI quality-gate audit (current state vs §5)

`.github/workflows/ci.yml` — one blocking `lint-build` job: `npm ci` → `npx astro sync`
→ `npm run lint` → `npm run test` → `npm run build` (Supabase secrets on build step
only) → upload `dist/`. Then `deploy` (push to `master`) and `preview` (same-repo PR).

| Gate | Where | Required? | Catches |
|---|---|---|---|
| eslint (`npm run lint`) | CI + lefthook (staged) | yes | lint + much TS via `strictTypeChecked` (`eslint.config.js:14-20`) |
| **`astro check` (`npm run typecheck`)** | **lefthook pre-commit only** | **NOT in CI** | Astro/TS type drift |
| vitest `node` + `components` | CI | yes | lib + handler-contract integration |
| vitest `rls` | CI (invoked) | **self-skips** (no `SUPABASE_TEST_URL`) | real Postgres RLS |
| `astro build` | CI | yes | build failures (**not** full typecheck) |
| **pipeline integration (mocked LLM)** | **nowhere** | **not started (Phase 4)** | cross-layer orchestration |
| prettier (lint-staged) | stale Husky path only | no | formatting |
| coverage | nowhere | no | — |

Key facts:
- `npm run typecheck = astro sync && astro check` (`package.json:12`) is **never run
  in CI**; `astro build` does not substitute for `astro check`. → **§5 line 115
  ("lint + typecheck … already wired") is inaccurate for CI.**
- `npm run test = vitest run` (no `--project` filter) runs all three projects; `rls`
  self-skips via `describe.skipIf(!testUrl || !testAnonKey)`
  (`tests/rls/analysis-isolation.rls.test.ts:11-14`); CI sets no test-DB env.
- **Pre-commit is Lefthook**, not Husky: `"prepare": "lefthook install"`
  (`package.json:19`); `lefthook.yml` runs (parallel) staged-eslint, `npm run typecheck`,
  and a scoped `vitest related` runner (`scripts/lefthook-related-tests.mjs`). The
  `.husky/pre-commit` + `lint-staged` config is **orphaned/stale**; `AGENTS.md:63`
  still references Husky.
- No coverage tooling/thresholds anywhere; default Vitest reporter only.
- `wrangler.jsonc`: `nodejs_compat`, `observability.enabled: true`.

### Area 4 — Historical context & inherited follow-ups

**Patterns to reuse** (built by Phases 1–3): Vitest `projects` split; `vi.mock("ai")`
network-edge mock; `findUngroundedClaims` + analysis fixture triples; chokepoint
quality gate `assertUsableCvText`; boundary PII assert; `makeApiContext` +
`makeFakeSupabase`; "404, never 403" ownership contract; gated `tests/rls/` lane;
falsifiability anchors (known-bad MUST fail, known-good MUST pass).

**Inherited Phase-4 follow-ups** (test-plan §6.6 line 223-224; mirrored in
`context/changes/testing-data-isolation-api-boundary/change.md:22-27`):
1. Magic-byte / extension verification beyond MIME (Risk #7).
2. Zod request schemas on API routes.
3. SSR foreign-id read paths (`dashboard/index.astro`, `[id].astro`).
4. **`candidates` UPDATE RLS** — flagged as *pipeline integrity*: the background
   `pii_map` update may affect 0 rows under RLS (Phase 3 research Open Q #5).

**Orchestration explicitly deferred to Phase 4** (not "gaps" — the core work):
- Phase 1 plan: "end-to-end orchestration is explicitly deferred to test-plan Phase 4."
- Phase 2 plan: route-level "garbage → 400" + boundary assertion deferred to Phase 4.
- `first-gated-generation/plan.md:537`: "API route integration (would require mocking
  Supabase + LLM + Workers runtime)" listed under "What's NOT Tested" — the hole Phase 4 fills.

## Code References

- `src/pages/api/analysis/index.ts:14-221` — orchestration entry; sync front-half + `waitUntil` back-half
- `src/pages/api/analysis/index.ts:161-219` — background pipeline (anonymize → LLM → store)
- `src/pages/api/analysis/index.ts:214-217` — catch that flattens errors to `status:"failed"`
- `src/pages/api/analysis/[id]/status.ts:34-41` — async-outcome polling surface
- `src/lib/llm/client.ts:90-103` — `generateText` edge + JSON/Zod parse → `LLMParseError`
- `src/lib/llm/errors.ts` — typed LLM error hierarchy; `src/lib/llm/config.ts:1-23` — `getLLMConfig`/`astro:env`
- `src/lib/analysis/schema.ts:3-19` — `AnalysisResponseSchema` (empty `questions: []` is valid)
- `src/lib/anonymizer/index.ts:41-132` — `anonymizeCV` (sync, no throw)
- `src/lib/cv-parser/index.ts`, `quality.ts:87-95`, `errors.ts:1-16` — parse + chokepoint gate
- `tests/helpers/api-context.ts:19-42` — `makeApiContext` (`waitUntil` no-op at `:27`)
- `tests/helpers/fake-supabase.ts:156-174` — `makeFakeSupabase` (no bulk insert)
- `tests/lib/llm/client.test.ts:7-34,71-74` — `vi.mock("ai")` network-edge precedent
- `tests/lib/analysis/faithfulness.ts:172-196` — `findUngroundedClaims`
- `tests/lib/api/analysis-isolation.test.ts:5-32,58-147` — canonical route-integration pattern
- `tests/fixtures/analysis/*.json`, `tests/fixtures/cv/catchable.ts` — reusable fixtures
- `.github/workflows/ci.yml:10-29` — `lint-build` job (no typecheck step)
- `package.json:12,15,19` — `typecheck`, `test`, `prepare` (lefthook) scripts
- `lefthook.yml` — active pre-commit; `scripts/lefthook-related-tests.mjs` — scoped test runner
- `tests/rls/analysis-isolation.rls.test.ts:11-14` — `skipIf` gate
- `wrangler.jsonc` — `nodejs_compat`, `observability.enabled`

## Architecture Insights

- **Two-phase request shape is the central testing challenge.** Correctness lives
  almost entirely in the `waitUntil` back-half, which the current test harness
  cannot observe. Any Risk #6 test must (a) override `waitUntil` to capture+await
  the promise, (b) mock `ai` at the network edge (Pattern A), and (c) assert on the
  resulting `analyses.status`/`error_message` (or via `GET .../status`).
- **Error taxonomy is lossy by design at the orchestration layer.** Tests should
  assert the *observable contract* (`failed` + a non-empty `error_message`, or
  `completed` + `match_summary`), not internal `.code` values, because the route
  deliberately discards them in the background catch.
- **"Clean error vs false success" is the falsifiability axis.** Each negative case
  (LLM throws, malformed JSON, missing job profile) must end in `failed`; each
  positive case must end in `completed`. The anti-pattern to avoid (§2/§6 Risk #6)
  is over-mocking internal modules or asserting only the `201`.
- **CI "lock the floor" has two concrete, independent deliverables:** add the
  pipeline-integration test to the `node` project (auto-runs via existing `npm run
  test`), and close the typecheck-in-CI gap (add `npm run typecheck` / `astro check`
  to `lint-build`). Reconciling the stale Husky/Lefthook duplication is a cheap
  cleanup that removes contributor confusion.

## Historical Context (from prior changes)

- `context/changes/testing-output-grounding-response-integrity/` (Phase 1) — grounding/faithfulness helper, fixtures, `vi.mock("ai")`; orchestration deferred to Phase 4.
- `context/changes/testing-input-integrity-parsing-anonymization/` (Phase 2) — chokepoint quality gate + boundary PII assert; route-level assertions deferred to Phase 4.
- `context/changes/testing-data-isolation-api-boundary/` (Phase 3) — `makeApiContext`/`makeFakeSupabase`, 404 contract, gated RLS lane; logged the four Phase-4 follow-ups (`change.md:22-27`).
- `context/changes/first-gated-generation/plan.md:534-538` — names API-route integration as "NOT Tested," i.e. Phase 4's target.
- `context/foundation/test-plan.md` §3 (Phase 4 row, line 81), §5 (gates, lines 118-119), §6.6 (per-phase notes), §7 (do-not-test list).

## Related Research

- `context/changes/testing-data-isolation-api-boundary/research.md` — API-boundary / RLS (esp. Open Q #5: `candidates` UPDATE RLS).
- `context/changes/testing-output-grounding-response-integrity/research.md` — grounding helper + LLM-edge mock origins.
- `context/changes/testing-input-integrity-parsing-anonymization/research.md` — parser/anonymizer boundary.

## Open Questions

1. **`candidates` UPDATE RLS** — confirm whether the background `pii_map` update
   silently affects 0 rows under real RLS, and whether Phase 4 should fix the policy
   (migration) or only characterize it. This is a real pipeline-integrity bug, not
   just a test gap.
2. **Fake-Supabase bulk insert** — extend `makeFakeSupabase` to persist
   `insert(array)` without `.single()` so `analysis_questions` are assertable, or
   assert completion via `analyses` status only? (Cheapest signal vs fidelity.)
3. **`getLLMConfig`/`astro:env` in the pipeline test** — partial-mock `@/lib/llm`
   (real `completeLLM`, stubbed config) vs mock `astro:env/server`? The former keeps
   the network-edge real; pick one and document it in the cookbook.
4. **Typecheck-in-CI** — add `npm run typecheck` as its own `lint-build` step, and
   correct test-plan §5 line 115 + `AGENTS.md` (Husky→Lefthook, add `test`).
5. **Scope of "cross-cutting"** — which of the four inherited follow-ups land in
   this change vs get re-deferred? (`candidates` UPDATE RLS is the strongest Phase-4
   fit; magic-bytes/Zod/SSR are Risk #7/#4 hardening that may warrant their own slice.)
6. **Deferred (per scope decision):** analysis-latency / error observability for the
   ~60s budget (test-plan §5 "recommended") — noted as a follow-up, not researched here.
