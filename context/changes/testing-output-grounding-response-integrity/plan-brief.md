# Output Grounding & Response Integrity (Test Rollout Phase 1) — Plan Brief

> Full plan: `context/changes/testing-output-grounding-response-integrity/plan.md`
> Research: `context/changes/testing-output-grounding-response-integrity/research.md`

## What & Why

Phase 1 of the test rollout protects the two highest-priority risks behind the
team's top fear ("we will hire the wrong person; the analysis must be correct"):
**Risk #1** — the LLM invents red flags not present in the CV/JD (no deterministic
grounding check exists today); and **Risk #2** — a validated analysis silently
renders as "no findings". Risk #2 is a **confirmed live bug**, not a hypothetical.

## Starting Point

The pipeline validates response *shape* (Zod) but never *meaning*. Grounding is
enforced only by a prompt instruction. The render component
(`AnalysisResults.tsx`) groups questions by a `CATEGORY_LABELS` map keyed on the
wrong vocabulary (`qa_fundamentals…`) versus the schema enum
(`missing_elements…`), so every question section renders `null` while the summary
shows. Vitest runs node-env only — no DOM, no React Testing Library, no fixture
corpus — and CI runs lint+build but **not** tests.

## Desired End State

A completed analysis reliably shows its summary *and* all its questions grouped by
real category (the empty-state only fires on a genuinely empty result). A
deterministic, test-only faithfulness check plus a `(CV, JD, response)` fixture
corpus prove generated claims trace back to the input. `npm run test` runs in CI
and gates merges.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Risk #2 bug disposition | Fix rides along; render test lands GREEN | Ship the working view + its guard together so the test-plan goal is actually met | Plan |
| Risk #1 mechanism | Deterministic entailment, no LLM-as-judge | Cheapest check with real signal; avoids the oracle problem (test-plan §1/§4) | Research / Plan |
| Check granularity | Stronger than proper-noun: salient-span + n-gram/phrase overlap | Catch paraphrased fabrications, still deterministic | Plan |
| Helper home | Test-only utility under `tests/` | Phase 1 proves grounding via tests; runtime guard is a separate product call | Plan |
| DOM environment | Vitest `projects`: node for `tests/lib`, jsdom for `tests/components` + RTL | Clean isolation; zero impact on the existing 11 tests | Plan |
| Fixture provenance | Hybrid: hand-authored edges + 1–2 recorded real runs | Deterministic Risk #2 edges + realistic Risk #1 signal | Plan |
| Oracle scope | `anonymizedText` + profile, placeholder-aware, normalized | `missing_elements` findings reference the JD, not the CV | Research / Plan |
| CI gate | Add `npm run test` to `lint-build` (no step exists today) | Enforce the test-plan §5 "required after Phase 1" gate | Plan |

## Scope

**In scope:** Vitest jsdom project + RTL; fix `AnalysisResults` category desync +
component test; deterministic faithfulness helper + fixture corpus + grounding
tests; add `npm run test` to CI; update test-plan cookbook/status.

**Out of scope:** runtime grounding guard; LLM-as-judge; coverage thresholds;
full-pipeline/route test (Phase 4); changes to anonymizer/schema/prompt/LLM client;
a separate category-contract guard test.

## Architecture / Approach

Two risks live on opposite sides of the validated boundary. **Risk #1** is caught
*before* validation can help — a test-only helper compares salient claim spans in
each question/rationale against a normalized oracle (`anonymizedText` + profile),
whitelisting anonymizer placeholders. **Risk #2** is caught *after* validation —
fix the render vocabulary and assert in jsdom that questions actually appear. The
LLM is mocked at the network edge (existing `vi.mock("ai")` house style); no MSW.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Test infrastructure | jsdom Vitest project + RTL, isolated from node suite | Misconfigured projects split leaking jsdom into `tests/lib` |
| 2. Risk #2 render integrity | `CATEGORY_LABELS` fix + component test (GREEN) | Fix touches a prod component in a "testing" change |
| 3. Risk #1 grounding | Deterministic helper + fixture corpus + tests | Threshold tuning — false positives on legitimate findings |
| 4. CI gate + docs | `npm run test` in CI + test-plan cookbook/status | None significant |

**Prerequisites:** Node 22.14.0; local LM Studio run to capture 1–2 real fixtures
(Phase 3). **Estimated effort:** ~3–4 focused sessions across the 4 phases.

## Open Risks & Assumptions

- Faithfulness threshold tuning is the main unknown; the deliberate ungrounded
  fixture is the falsifiability anchor that keeps it honest.
- Vitest 4's `projects` API supersedes `environmentMatchGlobs`; confirm current
  schema via Context7 before writing config.
- Recorded real-run fixtures must be verified anonymized before commit.

## Success Criteria (Summary)

- A completed analysis with N questions always shows those N questions grouped by
  category — never a silent "no findings".
- A fabricated claim is flagged by the grounding check; legitimate `missing_elements`
  findings are not.
- A failing grounding or render test blocks merge in CI.
