# Data isolation & API boundary (Risks #4, #7) Implementation Plan

## Overview

Phase 3 of the phased test rollout (`context/foundation/test-plan.md` §3). Add **integration tests on the API routes** that prove two protections, and make the small production changes required for those protections to actually hold:

- **Risk #4 — IDOR / data isolation.** A request for another user's analysis id is denied. The codebase contract is **404** (deliberate existence-hiding), and ownership for *reads* is enforced **only by Supabase RLS**. Tests must encode 404, and must exercise isolation at a layer where it is real — not a mocked client that false-passes.
- **Risk #7 — unvalidated input.** Oversized / wrong-type / malformed input is rejected with a clean **4xx**, with the server re-validating (client-side caps are not enough).

Landing this phase enables the **"API / boundary integration"** quality gate (`test-plan.md` §5).

## Current State Analysis

Grounded by `context/changes/testing-data-isolation-api-boundary/research.md` (same commit, `5a23b0f`):

- **Ownership of reads lives in RLS, not the handler.** `GET /api/analysis/:id` (`src/pages/api/analysis/[id]/index.ts:21-25`) and `GET /api/analysis/:id/status` (`src/pages/api/analysis/[id]/status.ts:20-24`) filter by `.eq("id", id)` only. Cross-user denial depends on RLS returning zero rows → handler maps to **404 `NOT_FOUND`**. `DELETE` and the `POST` retry path add a defense-in-depth `.eq("user_id", userId)` (`[id]/index.ts:84-89`, `index.ts:50-55`).
- **No handler returns 403.** Not-found and not-owned are intentionally collapsed to 404 (documented at `src/pages/api/analysis/[id]/index.ts:82-83`).
- **The client uses the anon key over `@supabase/ssr`** with cookie-forwarded sessions (`src/lib/supabase.ts:6-25`), so PostgREST runs as the logged-in user and RLS applies. The biggest IDOR risk is a misconfigured `SUPABASE_KEY` set to the `service_role` key, which bypasses RLS entirely. `SUPABASE_KEY` is read from `astro:env/server` (`astro.config.mjs:29-37`).
- **Risk #7 gaps:** no server-side max file size (only client `MAX_SIZE_MB = 5`), MIME-only type check (`src/lib/cv-parser/index.ts:11`), no UUID/format validation on ids (garbage `job_profile_id` can surface as a 500 `DB_ERROR`), and auth routes read `formData()` with **no try/catch** (`src/pages/api/auth/signin.ts:5`, `signup.ts:5`) → malformed body throws an uncaught 500. `POST /api/analysis` is the only route with substantive validation, and it converges all CV sources on `assertUsableCvText`.
- **Test infra:** Vitest 4.1.x with two projects (`node` = `tests/lib/**/*.test.ts`, `components` = jsdom); `@`→`src` alias, `globals: true`, `passWithNoTests: true` (`vitest.config.ts`). CI runs `npx astro sync` → `npm run lint` → `npm run test` → `npm run build`; **Supabase env is injected for the build step only, not the test step** (`.github/workflows/ci.yml:18-25`).
- **Sole API-route precedent** (`tests/lib/api/analysis-retry-garbage.test.ts`): imports the handler, mocks `@/lib/llm` and `@/lib/supabase`, builds a synthetic `APIContext` with `locals.user`, `cfContext.waitUntil = vi.fn()`, and stub `cookies`. **No `tests/helpers/`** exists.

### Key Discoveries

- The thing that enforces read isolation (RLS) is **not in the code under test** when `@/lib/supabase` is mocked — a naive mock-based IDOR test **false-passes** (research §Summary, Architecture Insight #1).
- 404-not-403 is the **contract**; asserting 403 would be wrong (research Architecture Insight #2).
- The node test project globs `tests/lib/**/*.test.ts`, so route tests belong under `tests/lib/api/`. A separate real-RLS lane needs its **own** Vitest project with a distinct include glob so it can be `skipIf`-gated by env.
- Supabase anon/service keys are JWTs carrying a `role` claim (`anon` vs `service_role`); newer `sb_publishable_…` / `sb_secret_…` formats are not JWTs. A guard must block the clearly-dangerous `service_role` JWT without false-positiving on anon or unknown formats.

## Desired End State

- `npm run test` (CI default) runs fast, Supabase-free integration tests that prove: cross-user reads return 404, own reads succeed, and the 401/400/503 status-matrix rows hold — using an **ownership-enforcing fake** Supabase client.
- A **gated real-RLS lane** (`tests/rls/`) exists and, when a local/CI Supabase is available, proves the actual RLS policies deny cross-user reads with two real sessions. It is the documented source of truth for RLS; it is **skipped** (not failed) when no Supabase env is present.
- `createClient` **refuses a `service_role` `SUPABASE_KEY`**, backed by a unit-tested pure helper.
- Oversized files, wrong MIME, malformed bodies, and garbage ids are rejected with a clean **4xx** at the analysis route and the auth routes; tests assert this with synthetic `File` objects and crafted requests.
- `test-plan.md` §6.4 cookbook is filled, §3 Phase 3 status is flipped, and `change.md` is marked planned→(later)implemented.

## What We're NOT Doing

- **Not** testing auth *flows* (sign in/up/out mechanics) — `test-plan.md` §7 excludes them; we only harden + test the *input* boundary of those routes (malformed body → 400).
- **Not** testing SSR read paths (`dashboard/index.astro`, `[id].astro`) — out of scope for "API boundary"; research indicates the foreign-id "parsing" default leaks no result data (Open Question #4 left as a documented note).
- **Not** closing every Risk #7 gap: magic-byte/extension verification and Zod request schemas are **characterized as documented follow-ups**, not implemented this phase.
- **Not** adding binary `.pdf`/`.docx` fixtures (Phase 2 §4 deferral preserved) — validation tests use synthetic `File` objects; extraction is mocked where reached.
- **Not** wiring a real Supabase instance into the CI test job — the RLS lane is gated and runs locally / when env is later added.
- **Not** addressing the `candidates` missing-UPDATE-RLS observation (research Open Question #5) — that is a Phase 4 pipeline-integrity concern.

## Implementation Approach

Layered, honest-about-signal strategy chosen during planning:

1. **Build shared scaffolding first** (`tests/helpers/`) so every route test uses one `makeApiContext` and one ownership-enforcing fake Supabase client. The fake filters rows by the session `user_id`, so the handler's "zero rows → 404" contract is exercised deterministically and in CI.
2. **Prove the handler contract** with the fake (fast, always-on).
3. **Prove the real enforcement** (RLS) in a separate gated lane that uses two real sessions against a live Supabase — the only layer that can truly falsify Risk #4 — without blocking CI.
4. **Guard the blast radius** (`service_role` key) with a cheap, unit-tested config check that is higher-leverage than any single route test.
5. **Make Risk #7's protection assertion true** by adding the headline server-side guards (file size, id format, auth `formData` try/catch) at chokepoints, following Phase 2's additive-gate pattern, then test them.
6. **Document** the patterns and flip the gate.

## Critical Implementation Details

- **Test boundary definition (resolves the §6.2/§6.4 policy-vs-precedent conflict):** for a Supabase-backed handler, "the external edge" is the **Supabase client**. The fake client is an *ownership-enforcing* test double (it encodes the `user_id` filter), explicitly documented as testing the *handler contract*; the *real* RLS enforcement is proven only by the gated `tests/rls/` lane. State this distinction in the cookbook so future tests don't mistake the fake for RLS coverage.
- **404, never 403:** assert `status === 404` and `code === "NOT_FOUND"` for every cross-user read. A test asserting 403 is wrong against this codebase.
- **`waitUntil` on POST:** the analysis POST schedules a background pipeline via `context.locals.cfContext.waitUntil`. Tests for POST input-validation must stub `waitUntil` (as the precedent does) and must reject **before** the pipeline for the validation cases (no analysis row inserted).
- **RLS lane gating:** guard with `describe.skipIf(!process.env.SUPABASE_TEST_URL)` (or equivalent) so the lane is *skipped*, not *failed*, when env is absent — keeps `npm run test` green in CI today.
- **`service_role` detection must be conservative:** only block a key that decodes as a JWT with `role === "service_role"`. Anon JWTs and non-JWT key formats pass through unchanged to avoid breaking valid configs.

## Phase 1: Test scaffolding (`tests/helpers/`)

### Overview

Create the shared harness all subsequent route tests depend on: a synthetic `APIContext` builder and an ownership-enforcing fake Supabase client. No production code changes.

### Changes Required

#### 1. API context builder

**File**: `tests/helpers/api-context.ts` (new)

**Intent**: Provide one reusable `makeApiContext(...)` so each test stops hand-rolling the `APIContext`. It centralizes the `locals.user`, `cfContext.waitUntil`, stub `cookies`, `params`, `request`, and `url` wiring currently duplicated in `analysis-retry-garbage.test.ts`.

**Contract**: Export `makeApiContext(opts: { user?: { id: string } | null; params?: Record<string,string>; request?: Request; url?: string }): APIContext`. Defaults: a valid `user`, `waitUntil = vi.fn()`, full stub `cookies` (`get/set/has/delete/headers`), `clientAddress`, `site`, `generator`, `props: {}`. Must satisfy `Parameters<typeof GET>[0]` for the analysis handlers (mirror the shape in `tests/lib/api/analysis-retry-garbage.test.ts:64-86`).

#### 2. Ownership-enforcing fake Supabase client

**File**: `tests/helpers/fake-supabase.ts` (new)

**Intent**: A factory that returns a Supabase-client-shaped object backed by an in-memory seed of rows, which **filters reads by the acting user's `user_id`** — so the handler's RLS-dependent "zero rows → 404" path is exercised without real Postgres. This is the test double that makes Risk #4 handler tests meaningful while staying CI-friendly.

**Contract**: Export `makeFakeSupabase(opts: { actingUserId: string; tables: { analyses?: Row[]; candidates?: Row[]; analysis_questions?: Row[]; job_profiles?: Row[] } })`. Returns an object with `.from(table)` exposing the chainable subset the handlers use: `select(...).eq(...).eq(...).single()`, `select(...).eq(...).order(...)`, `select(..., { count, head }).eq(...)`, `insert(...).select(...).single()`, `update(...).eq(...)`, `delete().eq(...).eq(...)`. **Read/delete/count chains MUST drop rows whose `user_id !== actingUserId`** (modeling RLS); `single()` on an empty result returns `{ data: null, error: <PostgREST-shaped not-found> }` so handlers hit their 404 branch. `job_profiles` is shared (no user filter). Returns `null` when configured to simulate the unconfigured-DB 503 case. Keep it small — model only what the handlers in `src/pages/api/analysis/**` call.

### Success Criteria

#### Automated Verification

- Type checking passes: `npx astro sync && npx tsc --noEmit` (or `npm run lint` if it includes tsc)
- Linting passes: `npm run lint`
- A trivial smoke test importing both helpers compiles and runs: `npm run test`

#### Manual Verification

- `makeApiContext` shape is accepted by an actual analysis handler signature (no `as any` casts needed beyond the documented `as Parameters<...>` pattern).
- Reviewer confirms the fake's `user_id` filtering is the *only* place ownership is modeled (so it is obvious the fake ≠ real RLS).

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Risk #4 — route-handler isolation tests (fake client)

### Overview

Prove the handler contract for every read path using the Phase 1 fake: another user's id → 404, own id → success, plus the denial/missing status-matrix rows. Runs in CI, no Supabase.

### Changes Required

#### 1. Cross-user read tests

**File**: `tests/lib/api/analysis-isolation.test.ts` (new)

**Intent**: Drive `GET /api/analysis/:id`, `GET /api/analysis/:id/status`, `DELETE /api/analysis/:id`, and the `POST /api/analysis` retry path with a fake seeded so that the requested id belongs to a *different* user, and assert 404 `NOT_FOUND`; then with an owned id and assert success (200/200/200/201). Mock `@/lib/llm` for the POST path (per precedent) so no real network is touched.

**Contract**: Import handlers from `@/pages/api/analysis/[id]/index`, `@/pages/api/analysis/[id]/status`, and `@/pages/api/analysis/index`; `vi.mock("@/lib/supabase")` to return `makeFakeSupabase({ actingUserId: USER_A, tables: { analyses: [{ id, user_id: USER_B, ... }] } })`. Cross-user assertions: `status === 404 && code === "NOT_FOUND"`. Explicitly assert **no 403 path exists**. Own-id assertions: success status + expected body keys.

#### 2. Status-matrix rows

**File**: `tests/lib/api/analysis-isolation.test.ts` (same file)

**Intent**: Cover the denial/missing matrix from research so the contract is fully pinned: no session → 401 `UNAUTHORIZED`; missing `:id` param → 400 `BAD_REQUEST`; unconfigured DB → 503 `SERVICE_UNAVAILABLE`; non-existent id → 404 (same as cross-user).

**Contract**: One `it` per cell across GET/status/DELETE. Use `makeApiContext({ user: null })` for 401, empty `params` for 400, and a fake configured to return `null` for 503.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- All new isolation tests pass: `npm run test`
- Cross-user cases assert `404`/`NOT_FOUND` (grep the test asserts no `403`)

#### Manual Verification

- Reviewer confirms each cross-user test would **fail** if the handler dropped its reliance on RLS/`user_id` (i.e., the fake's filter is what produces the 404) — falsifiability check.
- Reviewer confirms the matrix matches research's status table (`research.md` §"Status-code matrix").

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 3: Risk #4 — real-RLS lane (gated)

### Overview

Add the layer that actually falsifies Risk #4: two real user sessions against a live Supabase, proving the RLS policies (not a fake) deny cross-user reads. Gated so CI stays green without Supabase env.

### Changes Required

#### 1. New Vitest project for the RLS lane

**File**: `vitest.config.ts`

**Intent**: Add a third project `rls` with its own include glob so the gated lane is isolated from the always-on `node` suite.

**Contract**: Append a project `{ extends: true, test: { name: "rls", environment: "node", include: ["tests/rls/**/*.test.ts"] } }`. Because `passWithNoTests: true` and the suite self-skips without env, this changes nothing for current CI.

#### 2. Two-session RLS test

**File**: `tests/rls/analysis-isolation.rls.test.ts` (new)

**Intent**: Using the real `@supabase/supabase-js` (or `@supabase/ssr`) anon client against a local Supabase, create two users, have user A insert an analysis, then assert user B's session reads **zero rows** for A's id (the real RLS denial). This is the documented source of truth for Risk #4.

**Contract**: Guard the whole suite with `describe.skipIf(!process.env.SUPABASE_TEST_URL)`. Read `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` from env; sign in two seeded users (or create via admin), insert as A, select as B → expect empty. Document required env + `supabase start` in the cookbook (Phase 6). Do **not** import `astro:env/server` here (not available outside Astro) — read `process.env` directly.

### Success Criteria

#### Automated Verification

- `npm run test` still passes with **no** `SUPABASE_TEST_URL` set (the lane is skipped, not failed)
- Linting passes: `npm run lint`
- With a local Supabase + env set, `npx vitest run --project rls` passes and the cross-user select returns zero rows

#### Manual Verification

- Reviewer runs the lane locally against `supabase start` (or confirms it is documented well enough to run) and sees the real RLS denial.
- Reviewer confirms the lane is clearly labeled as the RLS source of truth vs the Phase 2 fake.

**Implementation Note**: Pause for manual confirmation. The local-Supabase run is the key manual step here.

---

## Phase 4: Risk #4 blast-radius — `SUPABASE_KEY` anon-key guard

### Overview

Refuse a `service_role` `SUPABASE_KEY` so a misconfiguration can't silently turn every read into a full IDOR. Cheap, unit-tested, higher-leverage than any single route test.

### Changes Required

#### 1. Pure key-role detector

**File**: `src/lib/supabase.ts` (add a helper; or `src/lib/supabase-key.ts` if cleaner)

**Intent**: A pure, side-effect-free function that decides whether a key is a Supabase `service_role` key. Conservative: only `true` for a JWT whose decoded payload has `role === "service_role"`; `false` for anon JWTs and non-JWT formats.

**Contract**: Export `isServiceRoleKey(key: string | undefined | null): boolean`. Base64url-decode the JWT payload (no signature verification needed — we only read the `role` claim) and check `role`. Must not throw on malformed input — return `false`.

#### 2. Wire the guard into `createClient`

**File**: `src/lib/supabase.ts:6-25`

**Intent**: Refuse to construct a client with a `service_role` key. Treat it like a misconfiguration so callers hit their existing 503 path, and log a server-side error so the operator sees why.

**Contract**: In `createClient`, after the existing `!SUPABASE_URL || !SUPABASE_KEY` null-guard, if `isServiceRoleKey(SUPABASE_KEY)` then `console.error(...)` and `return null`. Existing handlers already map `null` → 503 `SERVICE_UNAVAILABLE`, so no handler changes are needed.

#### 3. Unit test

**File**: `tests/lib/supabase/key.test.ts` (new)

**Intent**: Lock the detector's behavior with crafted JWTs.

**Contract**: `isServiceRoleKey` → `true` for a JWT with `{"role":"service_role"}` payload; `false` for `{"role":"anon"}`, for `sb_publishable_…`/`sb_secret_…` strings, for `undefined`/`null`, and for garbage. (Build test JWTs by base64url-encoding a header+payload+dummy-signature — no real signing.)

### Success Criteria

#### Automated Verification

- Linting + types pass: `npm run lint`
- Detector unit tests pass: `npm run test`
- Existing analysis tests still pass (anon/unknown keys unaffected)

#### Manual Verification

- Reviewer confirms a real anon key still constructs a client (no false positive) — spot-check locally.
- Reviewer confirms the `console.error` message is actionable (names the misconfig).

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 5: Risk #7 — input hardening + tests

### Overview

Add the headline server-side guards that make "untrusted input → clean 4xx" true, then test them. Characterize (don't fix) the deeper gaps.

### Changes Required

#### 1. Server-side file-size cap

**File**: `src/pages/api/analysis/index.ts` (file branch, ~`:66-75`) and/or `src/lib/cv-parser/index.ts:10`

**Intent**: Reject oversized uploads server-side before extraction. Mirror the client cap so the server no longer trusts the client.

**Contract**: Define a shared `MAX_CV_FILE_BYTES` (e.g. 5 MB, matching `FileUpload.tsx`). In the `file instanceof File` branch, if `file.size > MAX_CV_FILE_BYTES` return `jsonResponse({ error, code: "FILE_TOO_LARGE" }, 400)` (new `CVParseError` code or inline 400). Prefer the route branch so the limit is visible at the boundary; if placed in `extractText`, throw `CVParseError("FILE_TOO_LARGE")` which the route already maps to 400.

#### 2. Id-format guard

**File**: `src/pages/api/analysis/index.ts` (`job_profile_id`/`candidate_id`) and the `[id]` handlers' `:id` param

**Intent**: Reject non-UUID ids with a 400 instead of letting a malformed id reach Postgres and surface as a 500 `DB_ERROR`.

**Contract**: Add a small UUID check (regex or shared helper, e.g. `isUuid(s)`). In `POST`, if `jobProfileId`/`candidateId` is present but not a UUID → 400 `BAD_REQUEST`. In `[id]/index.ts` and `[id]/status.ts`, after the existing `!id` check, if `!isUuid(id)` → 400 (keeps non-existent-but-valid ids as 404, garbage ids as 400). Place the helper in `src/lib/api/` for reuse.

#### 3. Auth-route `formData` try/catch

**File**: `src/pages/api/auth/signin.ts:5`, `src/pages/api/auth/signup.ts:5`

**Intent**: A malformed body must not throw an uncaught 500. Harden only the *input* boundary; the auth flow itself stays untouched (respects §7).

**Contract**: Wrap `await context.request.formData()` in try/catch; on failure redirect back with an error (consistent with the existing redirect-on-error style) or return a 400 — pick the redirect style to match these routes. Also guard missing `email`/`password` (currently passed to Supabase as `undefined`). Do **not** test sign-in success/failure logic.

#### 4. Input-validation tests

**File**: `tests/lib/api/analysis-input-validation.test.ts` (new), `tests/lib/api/auth-input-validation.test.ts` (new)

**Intent**: Assert the new guards return clean 4xx and that no analysis row is inserted on rejection.

**Contract**:
- Oversized file: `new File([new Uint8Array(MAX + 1)], "cv.pdf", { type: "application/pdf" })` → 400 `FILE_TOO_LARGE`, no insert.
- Wrong MIME: `File` with `type: "image/png"` → 400 `UNSUPPORTED_FORMAT` (existing behavior, now asserted).
- Malformed body: a `Request` whose `formData()` throws → 400 `BAD_REQUEST` (analysis route already has this; assert it).
- Garbage id: non-UUID `job_profile_id` → 400 `BAD_REQUEST` (not 500).
- Auth routes: malformed `formData` → redirect-with-error / 400, not a 500.
- Use synthetic `File` objects only; mock `@/lib/llm` and `@/lib/supabase` (fake) as in Phase 2; assert `analysesInsert` not called on rejection.

#### 5. Document deferred gaps

**File**: covered in Phase 6 cookbook + this change's notes

**Intent**: Record magic-byte/extension verification and Zod request schemas as explicit follow-ups so they aren't silently forgotten.

**Contract**: A short "Accepted gaps / follow-ups" note (cookbook §6.4 and/or `change.md`). No code.

### Success Criteria

#### Automated Verification

- Linting + types pass: `npm run lint`
- All input-validation tests pass: `npm run test`
- Garbage-id test asserts `400`, not `500`
- Oversized-file test asserts rejection happens **before** any insert (`analysesInsert` not called)

#### Manual Verification

- Reviewer confirms the file-size cap value matches the client (`FileUpload.tsx` `MAX_SIZE_MB`).
- Reviewer confirms auth-route hardening does not alter the success redirect behavior (§7 respected).
- Reviewer confirms deferred gaps (magic-bytes, Zod) are documented, not silently closed.

**Implementation Note**: Pause for manual confirmation after automated verification passes.

---

## Phase 6: Cookbook + quality gate

### Overview

Document the new patterns, flip the rollout status, and record the gate. No source changes.

### Changes Required

#### 1. Fill cookbook §6.4

**File**: `context/foundation/test-plan.md` §6.4 (and a new §6.x per-phase note)

**Intent**: Replace the "TBD — see §3 Phase 3" stub with the concrete pattern: how to test an API route, the fake-vs-real-RLS boundary distinction, the 404-not-403 contract, synthetic-`File` validation, and how to run the gated RLS lane (`supabase start` + `SUPABASE_TEST_URL` env + `npx vitest run --project rls`).

**Contract**: Prose + reference to `tests/helpers/api-context.ts`, `tests/helpers/fake-supabase.ts`, `tests/lib/api/analysis-isolation.test.ts`, `tests/rls/analysis-isolation.rls.test.ts`. Add a Phase 3 entry under §6.6.

#### 2. Flip rollout status + gate

**File**: `context/foundation/test-plan.md` §3 (Phase 3 row) and §5 (gate row)

**Intent**: Mark §3 Phase 3 `done`, point its change-folder cell at this change, and note the "API / boundary integration" gate is now enforced via `npm run test` (with the RLS lane gated).

**Contract**: Status `not started` → `done`; gate row annotated. Update the doc's "Last updated" line.

#### 3. Update `change.md`

**File**: `context/changes/testing-data-isolation-api-boundary/change.md`

**Intent**: Reflect completion.

**Contract**: `status: preparing` → `implemented` (or `done` per repo convention), `updated: <today>`. Append a short "Accepted gaps" note (magic-bytes, Zod, SSR, `candidates` UPDATE RLS).

### Success Criteria

#### Automated Verification

- `npm run test` and `npm run lint` pass (regression check after doc-only phase)
- `npm run build` passes

#### Manual Verification

- Reviewer confirms §6.4 is actionable for a new contributor adding an API test.
- Reviewer confirms §3 status + §5 gate reflect reality.

**Implementation Note**: Final phase — confirm the whole suite is green before closing.

---

## Testing Strategy

### Unit Tests

- `isServiceRoleKey` against crafted anon/service/non-JWT/garbage keys (Phase 4).
- Id-format helper (`isUuid`) if extracted (Phase 5).

### Integration Tests

- Cross-user reads → 404 across GET/status/DELETE/POST-retry, plus 401/400/503 matrix (Phase 2, fake client).
- Real two-session RLS denial (Phase 3, gated lane).
- Oversized / wrong-MIME / malformed-body / garbage-id → 4xx, no side-effect insert (Phase 5).
- Auth-route malformed-body → clean rejection (Phase 5).

### Manual Testing Steps

1. Run `supabase start`, set `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`, run `npx vitest run --project rls` → see real RLS denial.
2. Locally set `SUPABASE_KEY` to a fabricated `service_role` JWT and confirm `createClient` returns null (handlers 503) and logs an error.
3. Confirm `npm run test` is green in CI with no Supabase env (RLS lane skipped).

## Performance Considerations

Tests are unit/integration with mocked or local DB — negligible runtime. The gated RLS lane adds latency only when explicitly run.

## Migration Notes

No data migration. The `SUPABASE_KEY` guard is backward-compatible for anon keys (the documented/expected config). Operators using a `service_role` key (a misconfiguration) will start seeing 503 + an error log — intended.

## References

- Research: `context/changes/testing-data-isolation-api-boundary/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (Risks #4/#7), §3, §5, §6.4
- Precedent test: `tests/lib/api/analysis-retry-garbage.test.ts`
- Handlers: `src/pages/api/analysis/[id]/index.ts`, `[id]/status.ts`, `src/pages/api/analysis/index.ts`
- Client + env: `src/lib/supabase.ts`, `astro.config.mjs:29-37`
- RLS policies: `supabase/migrations/20260527185003_data_schema_and_rls.sql:146-178`, `20260530150600_analysis_delete_rls.sql:7-15`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test scaffolding (tests/helpers/)

#### Automated

- [x] 1.1 Type checking passes (astro sync + tsc/lint)
- [x] 1.2 Linting passes (npm run lint)
- [x] 1.3 Smoke test importing both helpers runs (npm run test)

#### Manual

- [x] 1.4 makeApiContext shape accepted by an analysis handler signature
- [x] 1.5 Fake's user_id filtering is the only place ownership is modeled

### Phase 2: Risk #4 — route-handler isolation tests (fake client)

#### Automated

- [x] 2.1 Linting passes
- [x] 2.2 Isolation tests pass (npm run test)
- [x] 2.3 Cross-user cases assert 404/NOT_FOUND (no 403)

#### Manual

- [x] 2.4 Cross-user tests would fail without the user_id filter (falsifiability)
- [x] 2.5 Matrix matches research status table

### Phase 3: Risk #4 — real-RLS lane (gated)

#### Automated

- [x] 3.1 npm run test passes with no SUPABASE_TEST_URL (lane skipped)
- [x] 3.2 Linting passes
- [x] 3.3 With local Supabase + env, npx vitest run --project rls passes (cross-user select empty)

#### Manual

- [x] 3.4 Reviewer runs the lane locally and sees real RLS denial
- [x] 3.5 Lane clearly labeled as RLS source of truth vs the fake

### Phase 4: Risk #4 blast-radius — SUPABASE_KEY anon-key guard

#### Automated

- [x] 4.1 Linting + types pass
- [x] 4.2 Detector unit tests pass
- [x] 4.3 Existing analysis tests still pass

#### Manual

- [x] 4.4 Real anon key still constructs a client (no false positive)
- [x] 4.5 console.error message is actionable

### Phase 5: Risk #7 — input hardening + tests

#### Automated

- [x] 5.1 Linting + types pass
- [x] 5.2 Input-validation tests pass
- [x] 5.3 Garbage-id test asserts 400 not 500
- [x] 5.4 Oversized-file rejected before any insert

#### Manual

- [x] 5.5 File-size cap matches client MAX_SIZE_MB
- [x] 5.6 Auth-route hardening preserves success redirect (§7)
- [x] 5.7 Deferred gaps (magic-bytes, Zod) documented, not silently closed

### Phase 6: Cookbook + quality gate

#### Automated

- [x] 6.1 npm run test and npm run lint pass
- [x] 6.2 npm run build passes

#### Manual

- [x] 6.3 §6.4 cookbook actionable for a new contributor
- [x] 6.4 §3 status + §5 gate reflect reality
