# Data isolation & API boundary (Risks #4, #7) — Plan Brief

> Full plan: `context/changes/testing-data-isolation-api-boundary/plan.md`
> Research: `context/changes/testing-data-isolation-api-boundary/research.md`

## What & Why

Phase 3 of the test rollout. Add integration tests on the API routes proving that **a recruiter cannot reach another recruiter's analysis** (Risk #4 — IDOR), and that **API routes reject untrusted input with a clean 4xx** (Risk #7). Make the minimal production changes needed for those protections to be real, not just asserted. Landing this enables the "API / boundary integration" quality gate.

## Starting Point

Eight API files / nine handlers exist. Read ownership is enforced **only by Supabase RLS** (handlers filter by id, not `user_id`), and denied cross-user reads return **404, not 403** by deliberate design. Only `POST /api/analysis` has real input validation. The sole existing API test mocks `@/lib/supabase` — which means it **cannot** test RLS and would false-pass an IDOR check. There is no `tests/helpers/`, and CI runs `npm run test` with **no Supabase env on the test step**.

## Desired End State

`npm run test` runs fast, Supabase-free tests proving cross-user reads → 404 and own reads succeed (via an ownership-enforcing fake client). A separate **gated** lane proves the *real* RLS denial with two sessions against a local Supabase. `createClient` refuses a `service_role` key. Oversized/wrong-type/malformed/garbage-id input is rejected with a clean 4xx at the analysis and auth routes. The cookbook and rollout status are updated.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| How to test RLS | Layered: ownership-enforcing fake (CI) + gated real-RLS lane | A mock can't test RLS; the fake proves the handler contract while a gated lane proves real enforcement | Plan |
| Cross-user status | Assert **404**, never 403 | Codebase deliberately collapses not-found and not-owned to 404 | Research |
| Risk #7 scope | Close headline gaps (file size, id format, auth try/catch), characterize the rest | Makes the "reject with 4xx" assertion true without phase-wide scope creep | Plan |
| `SUPABASE_KEY` guard | Add `service_role`-refusing guard + unit test | One cheap check protects the entire IDOR blast radius | Plan |
| Auth routes | Harden + test only the input boundary, not auth flow | Respects test-plan §7 (auth flows excluded) while closing the 500-on-malformed-body gap | Plan |
| SSR read paths | Out of scope | Phase is "API boundary"; foreign-id SSR leaks no result data | Plan |
| File fixtures | Synthetic `File` objects, extractor mocked | Tests the validation guard without reversing the Phase 2 binary-fixture deferral | Plan |

## Scope

**In scope:** API-route IDOR tests (404 contract); gated real-RLS lane; `service_role` key guard; server-side file-size cap, id-format guard, auth `formData` try/catch; input-validation tests; cookbook + gate updates.

**Out of scope:** auth-flow testing; SSR read paths; magic-byte/Zod validation (documented follow-ups); wiring real Supabase into the CI test job; `candidates` UPDATE-RLS (Phase 4).

## Architecture / Approach

Build shared `tests/helpers/` (an `APIContext` builder + an ownership-enforcing fake Supabase client) first, then layer tests on top: fast fake-backed handler tests in CI, a gated two-session lane for real RLS, a unit-tested config guard for the key blast radius, and chokepoint input guards + tests for Risk #7. The fake encodes the `user_id` filter so handler tests are meaningful; the gated lane is the documented source of truth for actual RLS.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Scaffolding | `makeApiContext` + ownership-enforcing fake Supabase | Fake mistaken for real RLS coverage |
| 2. Isolation tests (fake) | 404 cross-user + 401/400/503 matrix, CI-safe | False-pass if filter not modeled |
| 3. Real-RLS lane (gated) | Two-session RLS denial vs local Supabase | Skipped-not-failed gating must be correct |
| 4. Key guard | `service_role` key refused + unit test | False positive on valid anon/non-JWT keys |
| 5. Risk #7 hardening + tests | File-size cap, id guard, auth try/catch + tests | Scope creep; altering auth-flow behavior |
| 6. Cookbook + gate | §6.4 filled, §3 status flipped, gate noted | Doc drifts from reality |

**Prerequisites:** existing Vitest setup; local Supabase CLI for the Phase 3 manual run (optional for CI).
**Estimated effort:** ~2–3 sessions across 6 phases; phases 3 and 5 are the heaviest.

## Open Risks & Assumptions

- The ownership-enforcing fake must visibly model `user_id` filtering, or Phase 2 tests false-pass — falsifiability is checked in manual verification.
- `service_role` detection assumes the JWT `role` claim; non-JWT key formats are treated as safe (anon) to avoid false positives.
- The real-RLS lane depends on a local Supabase being available to actually run; in CI it is intentionally skipped until env is wired.

## Success Criteria (Summary)

- A request for another user's analysis id returns 404 across all read paths; own id works.
- Oversized / wrong-type / malformed / garbage-id input is rejected with a clean 4xx, no side effects.
- A misconfigured `service_role` key is refused; `npm run test` stays green in CI with no Supabase env.
