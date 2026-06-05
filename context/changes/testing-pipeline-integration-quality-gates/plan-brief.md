# Pipeline Integration & Quality Gates — Plan Brief

> Full plan: `context/changes/testing-pipeline-integration-quality-gates/plan.md`
> Research: `context/changes/testing-pipeline-integration-quality-gates/research.md`

## What & Why

Phase 4 (final) of the test rollout. Prove the `POST /api/analysis` orchestration
holds end-to-end with the LLM mocked at the network edge, and that failures surface as
a clean observable `failed` state rather than a false `completed` (Risk #6). Then lock
the floor in CI. The correctness lives almost entirely in the `cfCtx.waitUntil(...)`
back-half — which **no current test executes**, because the harness stubs `waitUntil`
as a no-op, so every existing POST test returns `201` over a pipeline that never ran.

## Starting Point

The pipeline is two-phase (`src/pages/api/analysis/index.ts`): a synchronous front-half
that always returns `201 { analysis_id }`, and an async `waitUntil` back-half
(anonymize → status updates → job-profile fetch → `completeLLM` → insert questions →
`completed`) whose single catch flattens any throw to `status:"failed"`. CI runs
`lint → test → build` only; `npm run typecheck` runs lefthook-locally but **not in CI**.
A stale Husky/`lint-staged` config coexists with the active Lefthook setup.

## Desired End State

A new `tests/lib/api/analysis-pipeline-integration.test.ts` drives the real background
chain through a mocked `ai` edge and asserts the observable outcome on two anchors
(grounded → `completed` + persisted questions; LLM-throw → `failed`). CI runs an
explicit typecheck gate, the pipeline test is enforced via `npm run test`, the
Husky/Lefthook duplication is gone, and the `candidates` UPDATE RLS bug is
characterized in the gated RLS lane.

## Key Decisions Made

| Decision                              | Choice                                                     | Why (1 sentence)                                                                 | Source   |
| ------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| Cross-cutting follow-up scope         | `candidates` UPDATE RLS only                               | Only follow-up that is a genuine pipeline-integrity bug; others are own slice.   | Plan     |
| RLS bug treatment                     | Characterize in gated RLS lane; fix-migration is follow-up | Get ground-truth evidence before touching a backward-compat migration.          | Plan     |
| Fake-Supabase fidelity                | Extend to persist bulk `insert(array)`                     | Lets the test verify questions actually land, not just status.                  | Plan     |
| LLM config seam in test               | Mock `astro:env/server`                                    | Exercises the real `getLLMConfig`/`createLLMModel` path end-to-end.             | Plan     |
| CI typecheck gate                     | Separate `npm run typecheck` step after lint               | Distinct named gate with clear failure attribution.                             | Plan     |
| Risk #6 negative/positive coverage    | Happy path + LLM-throw (minimal falsifiable pair)          | Smallest set satisfying the test-plan's falsifiability rule.                    | Plan     |
| Husky/Lefthook reconciliation         | Remove stale Husky/lint-staged + fix `AGENTS.md`           | Cheap removal of active contributor confusion.                                  | Plan     |
| Observability gate                    | Document as recommended follow-up, don't build             | Honors §5 "recommended, not a unit test" framing; keeps scope tight.            | Plan     |

## Scope

**In scope:** harness extensions (`waitUntil` override, bulk insert); the Risk #6
pipeline test (happy + LLM-throw); `candidates` UPDATE RLS characterization (gated);
CI typecheck step; Husky/Lefthook + docs reconciliation; observability follow-up note.

**Out of scope:** RLS policy fix migration; magic-byte / Zod / SSR follow-ups; building
observability; asserting LLM `.code` taxonomy; treating empty `questions:[]` as failure;
coverage tooling.

## Architecture / Approach

The pipeline test uses **Pattern A**: mock `ai` (`generateText`) + provider factories at
the network edge so the real `completeLLM` runs and Zod-parses, mock `astro:env/server`
so real `getLLMConfig` runs, swap `createClient` for `makeFakeSupabase`, and inject a
`waitUntil` that captures the background promise to `await` before asserting on the
`analyses`/`analysis_questions` rows. Harness prerequisites land first; CI/doc wiring last.

## Phases at a Glance

| Phase                                  | What it delivers                                              | Key risk                                                        |
| -------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| 1. Test-harness extensions             | `waitUntil` override + bulk `insert(array)` persistence      | Regressing the existing single-insert path used by all tests.   |
| 2. Pipeline integration test (Risk #6) | Falsifiable happy + LLM-throw coverage of the real back-half | `astro:env/server` mock hoisting; over-mocking internal modules.|
| 3. `candidates` UPDATE RLS char.       | Gated RLS test proving 0-row vs permitted UPDATE             | Needs local Supabase; verdict may surface a real latent bug.    |
| 4. CI quality gates & reconciliation   | Typecheck gate, enforced pipeline test, Husky cleanup, docs  | Removing the wrong hook config; doc drift.                      |

**Prerequisites:** Node 22.14.0; local Supabase (`supabase start`) for Phase 3's manual
RLS run only. No new dependencies.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- The `astro:env/server` mock can be hoisted reliably in the Vitest `node` project (the
  precedent mocks `ai` + provider factories but not `astro:env`; this is the one new seam).
- Extending `makeFakeSupabase` for bulk insert won't subtly change ownership/filter
  behavior relied on by existing isolation tests.
- The RLS characterization may confirm a real bug; the fix is deliberately deferred, so
  a known latent issue remains open (tracked as a follow-up) until that slice ships.

## Success Criteria (Summary)

- A grounded run drives the background pipeline to `completed` with persisted questions;
  an LLM-edge throw drives it to `failed` — both observable, both falsifiable.
- `npm run lint && npm run typecheck && npm run test && npm run build` pass; CI runs a
  distinct typecheck gate and enforces the pipeline test.
- Pre-commit is Lefthook-only; docs match reality; the RLS verdict and observability gate
  are recorded as follow-ups.
