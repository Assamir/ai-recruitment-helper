# Pipeline Integration & Quality Gates Implementation Plan

## Overview

Phase 4 (final) of the test rollout in `context/foundation/test-plan.md` (§3). Two
independent deliverables plus a scoped follow-up:

1. **Risk #6 pipeline-integration test** — prove the `POST /api/analysis`
   orchestration holds end-to-end with the LLM mocked at the network edge, and
   that failures surface as a clean observable `failed` state rather than a false
   `completed`. The correctness lives almost entirely in the `cfCtx.waitUntil(...)`
   back-half, which **no current test executes** (the harness stubs `waitUntil` as
   a no-op).
2. **CI "lock the floor"** — add the missing `typecheck` gate to CI, register the
   new pipeline-integration test as a required gate (auto-runs via `npm run test`),
   and reconcile the stale Husky/Lefthook duplication.
3. **`candidates` UPDATE RLS characterization** — the one inherited follow-up that
   is a genuine *pipeline-integrity* bug: the background `pii_map` update may affect
   0 rows under real RLS. Characterize it in the gated RLS lane; fix-migration is a
   logged follow-up, not part of this change.

## Current State Analysis

The analysis pipeline is **two-phase** (`src/pages/api/analysis/index.ts:13-222`):

- **Synchronous front-half** (`index.ts:14-154`): auth → form parse → CV-text
  resolution (retry / file / paste branches) → `assertUsableCvText` quality gate →
  candidate + analysis DB inserts → LLM config preflight. Always returns
  **`201 { analysis_id }`** on success (`index.ts:221`).
- **Asynchronous back-half** (`index.ts:161-219`, inside `cfCtx.waitUntil(async IIFE)`):
  status → `anonymizing`, `anonymizeCV`, `candidates.pii_map` update, status →
  `analyzing`, `job_profiles` fetch, `buildAnalysisPrompt`, `completeLLM`, insert
  `analysis_questions` (only if `length > 0`), flip `analyses` to `completed`. A
  single catch flattens **any** throw to `status:"failed"` + `error_message = err.message`
  (`index.ts:214-217`), discarding the typed `.code` taxonomy.

**The Risk #6 hole:** `makeApiContext` stubs `locals.cfContext.waitUntil` as a no-op
`vi.fn()` (`tests/helpers/api-context.ts:27`). Every current POST test therefore
returns `201` **without running anonymize → LLM → store**. The full chain is net-new
coverage — exactly what Phases 1–3 deferred here.

**CI state** (`.github/workflows/ci.yml:10-29`): one blocking `lint-build` job runs
`npm ci → astro sync → npm run lint → npm run test → npm run build`. Two gaps vs
test-plan §5: (1) `npm run typecheck` (`astro sync && astro check`,
`package.json:12`) **never runs in CI** — `astro build` is not a substitute for
`astro check`; (2) no pipeline gate because the test doesn't exist. The `rls` Vitest
project runs but self-skips without `SUPABASE_TEST_URL` (by design). A stale
`.husky/pre-commit` + `lint-staged` block (`package.json:78-85`) coexists with the
active Lefthook config (`lefthook.yml`); `AGENTS.md` still references Husky.

### Key Discoveries:

- **`waitUntil` is the central testing challenge** — `tests/helpers/api-context.ts:27`
  must be overridable so the test can capture and `await` the background promise.
- **Network-edge mock precedent exists** — `tests/lib/llm/client.test.ts:9-34`
  mocks `ai` (`generateText`) + the two provider factories, returning `{ text: "<JSON>" }`;
  real `completeLLM` then runs and Zod-parses. This is "Pattern A" — the right seam
  for Risk #6.
- **`getLLMConfig` reads `astro:env/server`** (`src/lib/llm/config.ts:1`) — to let the
  real config path run, the test mocks `astro:env/server` (decision below).
- **Fake-Supabase cannot persist bulk inserts** — `Chain.execute()`
  (`tests/helpers/fake-supabase.ts:135-153`) has no `insert` branch; only
  `Chain.single()` (`:114-122`) persists, and only the first element. The pipeline does
  `insert(questions)` without `.single()` (`index.ts:201-202`), so questions are dropped.
- **Fixtures ready** — `tests/fixtures/analysis/grounded.json` is a validated
  `(anonymizedText, profile, response)` triple usable as the `mockGenerateText`
  payload and `job_profiles` seed.
- **Empty `questions: []` is a valid completion** — `AnalysisResponseSchema`
  (`src/lib/analysis/schema.ts:16-19`) accepts it; not treated as a failure (out of scope).
- **Canonical route-integration pattern** — `tests/lib/api/analysis-isolation.test.ts:5-32`:
  hoist `vi.mock` before handler import; swap `createClient` via a `createClientImpl`
  closure; seed with `makeFakeSupabase`; build ctx with `makeApiContext`.

## Desired End State

- A new `tests/lib/api/analysis-pipeline-integration.test.ts` runs in the Vitest
  `node` project (auto-included by `tests/lib/**/*.test.ts`) and proves: a grounded
  run drives the background chain to `completed` with `match_summary` and persisted
  `analysis_questions`; an LLM-edge throw drives it to `failed` with a non-empty
  `error_message`. Both pass under `npm run test`.
- `makeApiContext` accepts a `waitUntil` override; `makeFakeSupabase` persists bulk
  `insert(array)`. All existing suites stay green.
- A gated `tests/rls/` test characterizes whether the background `pii_map` UPDATE
  affects 0 rows under real RLS. It self-skips in CI (no `SUPABASE_TEST_URL`).
- CI `lint-build` runs an explicit `npm run typecheck` step; the pipeline test is a
  required gate via `npm run test`.
- The stale `.husky/pre-commit` + `lint-staged` config is removed; `AGENTS.md` and
  test-plan §5 reflect Lefthook reality; test-plan §3 marks Phase 4 done, §6 documents
  the pipeline cookbook, and the observability gate is recorded as a recommended
  follow-up.

Verify: `npm run lint && npm run typecheck && npm run test && npm run build` all pass
locally; the new pipeline test fails if `waitUntil` is reverted to a no-op or the
network mock is removed (falsifiability).

## What We're NOT Doing

- **Not** fixing the `candidates` UPDATE RLS policy (migration) — only characterizing
  it. Fix is a logged follow-up regardless of the test outcome.
- **Not** addressing the other three inherited follow-ups: magic-byte verification,
  Zod request schemas, SSR foreign-id read paths (Risk #7/#4 hardening — their own slice).
- **Not** building analysis-latency / error observability (Cloudflare Workers logs/metrics)
  — recorded as a recommended (non-required) follow-up only.
- **Not** asserting LLM-internal `.code` taxonomy — the route deliberately discards it;
  tests assert the observable contract (`status` + `error_message`/`match_summary`).
- **Not** treating empty `questions: []` as a failure — it is a valid completion.
- **Not** adding coverage tooling/thresholds (none exists; out of scope).

## Implementation Approach

Build the test-harness prerequisites first (Phase 1), so the pipeline test (Phase 2)
can capture the background promise and assert persisted questions. The RLS
characterization (Phase 3) is independent and lives in the gated lane. CI wiring and
doc/config reconciliation (Phase 4) lock the floor last, once the test that the gate
enforces actually exists.

The pipeline test uses **Pattern A** (network-edge `ai` mock + real `completeLLM`) so
the real Zod-parse and error-translation path stays live — that path is the heart of
Risk #6. `astro:env/server` is mocked so the real `getLLMConfig`/`createLLMModel`
path also runs.

## Critical Implementation Details

- **`waitUntil` capture+await is mandatory.** The background IIFE is fire-and-forget;
  the handler returns `201` before it settles. The test must inject a `waitUntil` that
  stores the promise, then `await` it after the POST resolves before asserting on
  `analyses.status`. A no-op `waitUntil` (the current default) makes the test assert on
  a never-run pipeline.
- **`astro:env/server` mock must be hoisted.** `vi.mock("astro:env/server", ...)` has
  to register before `src/lib/llm/config.ts` is imported (transitively via the handler).
  Provide `LLM_PROVIDER`/`LLM_MODEL` (and `OPENROUTER_API_KEY` if `openrouter`) so
  `getLLMConfig()` returns non-null and `createLLMModel` succeeds. The provider factories
  (`@ai-sdk/openai-compatible`, `@openrouter/ai-sdk-provider`) and `ai` must also be
  mocked exactly as in `tests/lib/llm/client.test.ts:9-34`.
- **Fake-Supabase bulk insert must not regress `.single()`.** The existing single-insert
  path (`fake-supabase.ts:114-122`) is relied on by every current POST/insert test. The
  new array branch must persist all elements (each with a generated `id`) without
  changing single-insert semantics.

## Phase 1: Test-harness extensions

### Overview

Make the harness capable of observing the background pipeline and persisting bulk
inserts, without breaking existing suites.

### Changes Required:

#### 1. `makeApiContext` — allow capturing the background promise

**File**: `tests/helpers/api-context.ts`

**Intent**: Let a test inject its own `waitUntil` so it can capture and await the
background IIFE. Default behavior (no-op `vi.fn()`) is unchanged for existing callers.

**Contract**: Add `waitUntil?: (p: Promise<unknown>) => void` to `MakeApiContextOpts`;
use it for `locals.cfContext.waitUntil` when provided, else fall back to the current
`vi.fn()`. Tests pass `waitUntil: (p) => { captured = p; }` (or push to an array) and
`await captured` after the handler returns.

#### 2. `makeFakeSupabase` — persist bulk `insert(array)`

**File**: `tests/helpers/fake-supabase.ts`

**Intent**: Persist `insert([...])` calls that are awaited directly (no `.single()`),
so `analysis_questions` written by the pipeline become assertable.

**Contract**: Add an `insert` branch to `Chain.execute()` (`:135-153`) that, when
`op === "insert"`, appends every payload element (array or single) with a generated
`id` to `allTables[table]` and resolves `{ data: <rows>, error: null }`. The existing
`Chain.single()` insert path (`:114-122`) stays as-is; only the awaited-without-`single`
path is new. Preserve ownership/filter semantics for non-insert ops.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Full suite passes (no regressions in existing API/isolation tests): `npm run test`

#### Manual Verification:

- A scratch assertion confirms `makeFakeSupabase` returns all inserted rows for a
  bulk `insert(array)` and a single `.single()` insert still returns one row with an `id`.

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding.

---

## Phase 2: Pipeline integration test (Risk #6)

### Overview

The net-new coverage: exercise the full background chain through the network-edge LLM
mock, asserting the observable completion contract on both a positive and a negative
anchor.

### Changes Required:

#### 1. New pipeline-integration test

**File**: `tests/lib/api/analysis-pipeline-integration.test.ts` (new)

**Intent**: Drive `POST /api/analysis` through the real background pipeline with `ai`
mocked at the network edge, capturing+awaiting `waitUntil`, and assert the observable
`analyses` outcome (and persisted questions) for a grounded run and an LLM-throw run.

**Contract**: Mirrors the mock topology of `tests/lib/llm/client.test.ts:9-34`
(`vi.mock("ai")` with a controllable `mockGenerateText`; mock `@ai-sdk/openai-compatible`
and `@openrouter/ai-sdk-provider`) PLUS `vi.mock("astro:env/server", ...)` supplying
`LLM_PROVIDER`/`LLM_MODEL`, PLUS `vi.mock("@/lib/supabase")` swapped via a
`createClientImpl` closure (per `analysis-isolation.test.ts:28-32`). Import `POST` from
`@/pages/api/analysis/index` after the mocks. Seed `makeFakeSupabase` (acting `USER_A`)
with a `job_profiles` row built from `grounded.json`'s `profile` and `JOB_PROFILE_ID`.
Build context with `makeApiContext({ request: <multipart POST with job_profile_id +
cv_text>, waitUntil: capture })`. Cases:

- **Happy path**: `mockGenerateText` resolves `{ text: JSON.stringify(grounded.response) }`
  → after awaiting the captured promise, the seeded `analyses` row has `status:"completed"`,
  a non-empty `match_summary`, and `analysis_questions` rows persisted (count === fixture
  questions length). This is the positive falsifiability anchor.
- **LLM throws**: `mockGenerateText` rejects (e.g. `new Error("fetch failed: ECONNREFUSED")`)
  → after awaiting, the `analyses` row has `status:"failed"` and a non-empty
  `error_message`; no `completed`. Negative anchor.

Use `cv_text` (paste branch) rather than a `File` to avoid the binary-fixture surface
(deferred per test-plan §4). The POST returns `201` in both cases — the assertions are
on post-await `analyses`/`analysis_questions` state.

### Success Criteria:

#### Automated Verification:

- New test passes: `npm run test`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- Reverting `makeApiContext`'s `waitUntil` to a no-op makes the happy-path assertions
  fail (proves the test observes the real background chain).
- Removing the `vi.mock("ai")` edge (or pointing it at a real call) breaks the test
  (proves the network edge is the controlled seam, not an internal module stub).

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding.

---

## Phase 3: `candidates` UPDATE RLS characterization

### Overview

Characterize the latent pipeline-integrity bug: does the background `pii_map` UPDATE
(`index.ts:169`) affect 0 rows under real RLS? Evidence first; fix is a follow-up.

### Changes Required:

#### 1. Gated RLS characterization test

**File**: `tests/rls/candidates-update.rls.test.ts` (new)

**Intent**: Against a real Supabase instance, prove whether an UPDATE to
`candidates.pii_map` by the owning user is permitted (affects 1 row) or silently
no-ops (affects 0 rows) under the live RLS policies.

**Contract**: Follow the gating pattern of `tests/rls/analysis-isolation.rls.test.ts:11-14`
(`describe.skipIf(!process.env.SUPABASE_TEST_URL || !process.env.SUPABASE_TEST_ANON_KEY)`).
Insert a candidate as the owning user, attempt `update({ pii_map: {...} }).eq("id", ...)`,
then read back / inspect the affected-row signal and assert the observed behavior. The
test documents ground truth either way (it is a characterization, not a guard that must
be green).

#### 2. Log the fix-migration follow-up

**File**: `context/changes/testing-pipeline-integration-quality-gates/change.md`

**Intent**: Record, in this change's Notes, that if the RLS test confirms the 0-row
UPDATE, the policy-fix migration (additive, backward-compatible per AGENTS.md) is a
separate follow-up — not done here.

**Contract**: Append a short "Follow-ups" note referencing the RLS finding and the
deferred migration.

### Success Criteria:

#### Automated Verification:

- Suite still passes with the RLS test self-skipping in CI (no `SUPABASE_TEST_URL`): `npm run test`
- Linting + typecheck pass: `npm run lint && npm run typecheck`

#### Manual Verification:

- With a local Supabase (`supabase start`, then `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`
  from `supabase status`), `npx vitest run --project rls` runs the new test and reports a
  definitive verdict (permitted vs 0-row).
- The follow-up note in `change.md` records the verdict and the deferred fix.

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation before proceeding.

---

## Phase 4: CI quality gates & reconciliation

### Overview

Lock the floor: add the typecheck gate, ensure the pipeline test is enforced, and
remove the Husky/Lefthook confusion. Update docs to match reality.

### Changes Required:

#### 1. Add typecheck gate to CI

**File**: `.github/workflows/ci.yml`

**Intent**: Run `npm run typecheck` as its own named step in `lint-build`, after
`npm run lint` and before `npm run test`, so Astro/TS type drift is caught in CI (not
just lefthook-local).

**Contract**: Insert a `- run: npm run typecheck` step into the `lint-build` job
(`:18-22`). `npm run typecheck` runs `astro sync && astro check`; the existing standalone
`astro sync` step (`:19`) is retained so the build/test steps still have generated stubs.
The pipeline-integration test needs no CI wiring — it auto-runs under the existing
`npm run test`.

#### 2. Remove stale Husky / lint-staged config

**File**: `package.json` and `.husky/pre-commit`

**Intent**: Eliminate the orphaned pre-commit system so Lefthook is the single source of
truth.

**Contract**: Delete the `lint-staged` block (`package.json:78-85`) and remove the
`husky` devDependency if unused elsewhere; delete `.husky/pre-commit` (and the `.husky/`
dir if empty). `"prepare": "lefthook install"` (`package.json:19`) and `lefthook.yml`
remain the active hook config.

#### 3. Fix AGENTS.md and test-plan wording

**File**: `AGENTS.md`, `context/foundation/test-plan.md`

**Intent**: Make the docs match reality — Lefthook (not Husky) owns pre-commit, CI now
runs typecheck and tests.

**Contract**: In `AGENTS.md`, replace the Husky/lint-staged reference with Lefthook and
note CI runs `lint → typecheck → test → build`. In `test-plan.md`, correct §5 line 115
("lint + typecheck … already wired") to reflect that typecheck is now wired in CI by this
change; flip §3 Phase 4 Status to **done** with the change-folder path; add a §6 cookbook
subsection documenting the pipeline-integration pattern (waitUntil capture + network-edge
`ai` mock + `astro:env/server` mock + observable-contract assertions); add a §6.6 Phase 4
note.

#### 4. Record observability as a recommended follow-up

**File**: `context/changes/testing-pipeline-integration-quality-gates/change.md`
(and a one-line pointer in test-plan §5 if not already clear)

**Intent**: Keep the thread on analysis-latency / error observability (Workers logs/metrics)
as the remaining *recommended* (non-required) gate — explicitly not built here.

**Contract**: Append a "Follow-ups" note naming the observability gate as recommended and
deferred; test-plan §5 already lists it as "recommended after §3 Phase 4" — leave that row,
do not promote it to required.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run typecheck` passes
- `npm run test` passes (pipeline test included; RLS self-skips)
- `npm run build` passes
- CI `lint-build` job runs the new `npm run typecheck` step (verify in the PR's Actions run)

#### Manual Verification:

- Fresh clone + `npm install` installs only Lefthook hooks; committing a TS file triggers
  Lefthook (not Husky); no `lint-staged` invocation occurs.
- `AGENTS.md` and `test-plan.md` §3/§5/§6 read correctly against the shipped state.
- The PR's CI shows a distinct, named typecheck step whose failure is attributable.

**Implementation Note**: After completing this phase and all automated verification
passes, pause for manual confirmation. This is the final phase.

---

## Testing Strategy

### Unit / harness Tests:

- Existing suites must stay green after harness changes (regression guard for the
  `makeFakeSupabase` bulk-insert branch and `makeApiContext` `waitUntil` option).

### Integration Tests:

- Risk #6 happy path: grounded fixture → `completed` + `match_summary` + persisted questions.
- Risk #6 negative: LLM-edge throw → `failed` + non-empty `error_message`.

### RLS (gated):

- `candidates` UPDATE characterization in `tests/rls/`, gated by `SUPABASE_TEST_URL`.

### Manual Testing Steps:

1. `npm run lint && npm run typecheck && npm run test && npm run build` — all green.
2. Revert `waitUntil` to a no-op → pipeline happy-path assertions fail (falsifiability).
3. `supabase start` + env → `npx vitest run --project rls` → RLS verdict recorded.

## Performance Considerations

Negligible. The pipeline test runs against the fake Supabase and a mocked LLM edge — no
network, no real model call. The added CI typecheck step costs a few seconds (one extra
`astro sync` internally).

## Migration Notes

No DB migration in this change. If the RLS characterization confirms the 0-row UPDATE,
the corrective UPDATE-policy migration is a separate follow-up and must be additive /
backward-compatible (`wrangler rollback` does not revert schema — AGENTS.md).

## References

- Research: `context/changes/testing-pipeline-integration-quality-gates/research.md`
- Test plan: `context/foundation/test-plan.md` §3 (Phase 4), §5 (gates), §6 (cookbook)
- Pipeline entry: `src/pages/api/analysis/index.ts:13-222`
- Network-edge mock precedent: `tests/lib/llm/client.test.ts:9-34`
- Route-integration pattern: `tests/lib/api/analysis-isolation.test.ts:5-32`
- Harness: `tests/helpers/api-context.ts:27`, `tests/helpers/fake-supabase.ts:114-153`
- RLS gate pattern: `tests/rls/analysis-isolation.rls.test.ts:11-14`
- CI: `.github/workflows/ci.yml:10-29`; scripts: `package.json:12,15,19`; `lefthook.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Test-harness extensions

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — a550e89
- [x] 1.2 Type checking passes: `npm run typecheck` — a550e89
- [x] 1.3 Full suite passes with no regressions: `npm run test` — a550e89

#### Manual

- [x] 1.4 Scratch assertion confirms bulk `insert(array)` returns all rows and `.single()` insert still returns one row with an `id` — a550e89

### Phase 2: Pipeline integration test (Risk #6)

#### Automated

- [x] 2.1 New pipeline test passes: `npm run test` — 8985e1e
- [x] 2.2 Linting passes: `npm run lint` — 8985e1e
- [x] 2.3 Type checking passes: `npm run typecheck` — 8985e1e

#### Manual

- [x] 2.4 Reverting `waitUntil` to a no-op fails the happy-path assertions (observes real chain) — 8985e1e
- [x] 2.5 Removing the `vi.mock("ai")` edge breaks the test (network edge is the controlled seam) — 8985e1e

### Phase 3: candidates UPDATE RLS characterization

#### Automated

- [x] 3.1 Suite passes with RLS test self-skipping in CI: `npm run test` — c2a73a8
- [x] 3.2 Linting + typecheck pass: `npm run lint && npm run typecheck` — c2a73a8

#### Manual

- [x] 3.3 With local Supabase env, `npx vitest run --project rls` reports a definitive verdict (permitted vs 0-row) — c2a73a8
- [x] 3.4 Follow-up note in `change.md` records the verdict and deferred fix — c2a73a8

### Phase 4: CI quality gates & reconciliation

#### Automated

- [x] 4.1 `npm run lint` passes — 1fdc941
- [x] 4.2 `npm run typecheck` passes — 1fdc941
- [x] 4.3 `npm run test` passes (pipeline included; RLS self-skips) — 1fdc941
- [x] 4.4 `npm run build` passes — 1fdc941
- [x] 4.5 CI `lint-build` runs the new `npm run typecheck` step (verify in Actions) — 1fdc941

#### Manual

- [x] 4.6 Fresh clone + `npm install` installs only Lefthook hooks; commit triggers Lefthook, no lint-staged — 1fdc941
- [x] 4.7 `AGENTS.md` and `test-plan.md` §3/§5/§6 match shipped state — 1fdc941
- [ ] 4.8 PR CI shows a distinct, named typecheck step
