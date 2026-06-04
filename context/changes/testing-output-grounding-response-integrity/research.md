---
date: 2026-06-04T11:26:00+02:00
researcher: dczaj
git_commit: df9cbb5baa02dbb767cacc1502abc5e653afeace
branch: main
repository: ai-recruitment-helper
topic: "Phase 1 grounding — where Risk #1 (ungrounded output) and Risk #2 (response-shape drift / silent 'no findings') actually live"
tags: [research, codebase, analysis, llm, grounding, response-integrity, phase-1]
status: complete
last_updated: 2026-06-04
last_updated_by: dczaj
---

# Research: Output grounding & response integrity (test rollout Phase 1)

**Date**: 2026-06-04T11:26:00+02:00
**Researcher**: dczaj
**Git Commit**: df9cbb5baa02dbb767cacc1502abc5e653afeace
**Branch**: main
**Repository**: ai-recruitment-helper

## Research Question

For Phase 1 of `context/foundation/test-plan.md` — *Output grounding & response
integrity* — locate the **actual code anchors** for:

- **Risk #1**: LLM generates questions/anomalies referencing claims **not present**
  in the CV or job requirements (hallucinated red flags).
- **Risk #2**: LLM response shape drifts; a category is silently dropped or
  mislabeled so the recruiter sees a confident-but-incomplete analysis and trusts it.

Per test-plan §1 principle #3, research (not the plan) is the ground truth for
where each failure lives, what the oracle is, and the cheapest layer to protect it.

## Summary

The pipeline is: **upload → CV parse → anonymize → build prompt → `completeLLM`
(generateText + JSON extract + Zod parse) → store rows → GET → render**. Two
findings dominate:

1. **Risk #2 is a LIVE BUG, not a hypothetical.** The render layer
   (`src/components/analysis/AnalysisResults.tsx`) groups questions by a
   `CATEGORY_LABELS` map whose keys (`qa_fundamentals`, `test_automation`,
   `processes`, `technical`, `soft_skills`) **do not match** the schema/prompt
   category vocabulary used everywhere else (`missing_elements`, `contradictions`,
   `vague_claims`, `anomalies`). Because the render renders only sections whose
   key is in `CATEGORY_LABELS`, and the stored `category` values are always the
   schema enum values, **every question section evaluates to `null` — the
   recruiter sees the match summary and zero questions even on a fully successful
   analysis with N findings.** This is exactly the test-plan Risk #2 scenario
   ("confident-but-incomplete analysis the recruiter trusts"). It has **zero test
   coverage** today (no component/render tests, no jsdom env in Vitest).

2. **Risk #1 has NO code-level protection.** Faithfulness/grounding is enforced
   *only* by a prompt instruction (`prompt.ts:10` "Reference ONLY information
   present in the provided CV"). There is no entailment/grounding check anywhere
   in the pipeline. The good news for testing: the **oracle is fully available** —
   `anonymizedText` + `profile` (name/description/expected_skills) are both in
   scope at the call site (`src/pages/api/analysis/index.ts:149-171`), so a
   fixture-driven `(CV, JD, response)` test can assert each claim traces to the
   input without ever asking the model what is correct.

The cheap mocking seam already exists: `generateText` from the `ai` package is
mocked via `vi.mock("ai")` in `tests/lib/llm/client.test.ts`. That is the network
edge the test-plan mandates mocking at.

## Detailed Findings

### Risk #1 — Grounding / faithfulness (where output is assembled, where the oracle lives)

- **Output is the model's raw content.** There is no post-LLM "assembly" that
  could introduce ungrounded claims — the questions/rationale come straight from
  the model. So the faithfulness check must compare each `question.question` /
  `question.rationale` against the input text.
- **Parse + validate**: `src/lib/llm/client.ts:48-59` (`extractJSON` — handles
  fenced ```json blocks and brace-slice fallback) → `:99-103`
  (`schema.safeParse`, throws `LLMParseError` on mismatch). This validates
  *shape*, never *grounding*.
- **The oracle is in scope at the call site**: `src/pages/api/analysis/index.ts:149`
  (`anonymizedText` from `anonymizeCV`) and `:156-164` (`profile` →
  `buildAnalysisPrompt`). Both feed the prompt at `:164-171`. A recorded fixture
  of `(anonymizedText, profile, llmResult)` reproduces this exactly.
- **Only safeguard today**: the system prompt constraint
  `src/lib/analysis/prompt.ts:10` ("Reference ONLY information present… Never
  fabricate") and `:12` ("clear rationale for every question explaining what in
  the CV triggered it"). No deterministic check backs this.
- **Implication for the cheapest layer**: a unit/integration faithfulness test
  over recorded fixtures — assert every claim token/span in each question traces
  to a span in `anonymizedText` or the profile. AI-native judge only if
  deterministic entailment proves too brittle (test-plan §4 keeps that option,
  `checked: 2026-06-02`). The oracle problem is avoided because the input docs —
  never the model output — are the source of truth.

### Risk #2 — Response contract & "empty vs missing" (where it is decided, where it silently fails)

- **Contract**: `src/lib/analysis/schema.ts:3` (`AnalysisCategory` enum =
  `missing_elements | contradictions | vague_claims | anomalies`), `:7-19`
  (`AnalysisQuestionSchema`, `AnalysisResponseSchema` = `{ match_summary: string,
  questions: AnalysisQuestion[] }`).
- **Where "empty vs missing" is decided**:
  - A *malformed* response (missing `match_summary`, out-of-enum category,
    missing `question`) → `safeParse` fails → `LLMParseError`
    (`client.ts:100-102`) → caught in the pipeline `catch`
    (`api/analysis/index.ts:196-199`) → analysis row `status: "failed"`. **Good:
    malformed = hard error, not silent.** Already covered by
    `tests/lib/analysis/schema.test.ts` and `tests/lib/llm/client.test.ts`.
  - An *empty* `questions: []` is **valid** per schema
    (`schema.test.ts:36-42`) → 0 rows inserted (`api/analysis/index.ts:183-185`)
    → status `completed`. The render shows "No questions were generated."
    (`AnalysisResults.tsx:97`). This is the FR-007 "empty categories hidden" path —
    legitimate, but indistinguishable from a model that under-produced.
- **THE SILENT FAILURE (live bug)** — category vocabulary desync:
  - Schema/prompt/DB inserts all use `missing_elements | contradictions |
    vague_claims | anomalies` (`schema.ts:3`, `prompt.ts:4-7`,
    `api/analysis/index.ts:174-181` inserts `q.category` verbatim).
  - Render uses a *different* vocabulary:
    `src/components/analysis/AnalysisResults.tsx:24-30` (`CATEGORY_LABELS` =
    `qa_fundamentals, test_automation, processes, technical, soft_skills`).
  - Render logic `:76-95`: iterates `CATEGORY_LABELS`, `const qs = grouped[key];
    if (!qs?.length) return null;`. Since `grouped` is keyed by the *schema*
    categories, **no label key ever matches** → every section returns `null`.
  - `:97` fallback (`questions.length === 0`) does **not** fire, because
    `questions.length > 0`. Net effect: **summary renders, all N questions
    vanish, no empty-state message.** A textbook "confident-but-incomplete"
    silent failure.
  - Grep confirms `AnalysisResults.tsx` is the **only** file in `src/` using the
    `qa_fundamentals`-style keys; every other layer uses the schema vocabulary.
  - Data path that exposes it: `api/analysis/[id]/index.ts:32-36` (GET returns
    `category` as stored) → `AnalysisView.tsx:94-100` (passes `questions`
    straight through, **no remap**) → `dashboard/[id].astro` (mounts
    `AnalysisView`).
- **Coverage gap**: no render/component test exists; Vitest has no jsdom/browser
  environment configured (`vitest.config.ts:10-13` — `globals:true`,
  `passWithNoTests:true` only). Risk #2's worst case is therefore wholly
  untested.

### Test infrastructure (what exists, what Phase 1 must add)

- **Runner**: Vitest 4.1.x (`package.json:66`), config at `vitest.config.ts` —
  `@`→`src` alias, `globals:true`, `passWithNoTests:true`. No `environment` set
  (defaults to `node`), no setup file, no coverage config.
- **Existing tests** (11, all under `tests/lib/`, mirroring `src/lib/`):
  `analysis/schema.test.ts`, `analysis/prompt.test.ts`,
  `analysis/candidate-cleanup.test.ts`, `llm/client.test.ts`, `llm/errors.test.ts`,
  `llm/types.test.ts`, `anonymizer/*`, `cv-parser/*`, `candidate/name.test.ts`.
- **Network-edge mock pattern already in repo**: `tests/lib/llm/client.test.ts:9-12`
  mocks `ai`'s `generateText` and `Output`; `:14-34` mock the provider factories.
  This is the seam the test-plan says to mock at (never internal modules). No MSW
  or fetch-stub installed yet — `generateText` mock is sufficient for grounding
  fixtures and avoids adding a dependency.
- **No fixture corpus** for `(CV, JD, response)` yet (test-plan §4 row "API /
  network mocking — none yet"). Phase 1 introduces it.
- **The orchestration route is hard to unit-test directly**:
  `api/analysis/index.ts` is an Astro `APIRoute` depending on
  `context.locals.user`, `createClient` (Supabase), `context.locals.cfContext.waitUntil`,
  and chained `supabase.from(...)` calls. Grounding signal is cheaper to capture
  at the `completeLLM` + a dedicated faithfulness helper than by exercising the
  whole route. Full-pipeline orchestration is explicitly deferred to test-plan
  Phase 4.

## Code References

- `src/lib/analysis/schema.ts:3` — `AnalysisCategory` enum (canonical category vocabulary)
- `src/lib/analysis/schema.ts:16-19` — `AnalysisResponseSchema` (the response contract)
- `src/lib/analysis/prompt.ts:10` — the ONLY grounding safeguard (prompt-level "Reference ONLY")
- `src/lib/analysis/prompt.ts:32-51` — `buildAnalysisPrompt` (CV + profile = the oracle, joined here)
- `src/lib/llm/client.ts:48-59` — `extractJSON` (fenced + brace-slice JSON recovery)
- `src/lib/llm/client.ts:99-103` — Zod `safeParse` → `LLMParseError` on shape drift
- `src/pages/api/analysis/index.ts:149-171` — pipeline: anonymize → profile → prompt → `completeLLM` (oracle in scope here)
- `src/pages/api/analysis/index.ts:174-185` — questions inserted with raw `q.category`
- `src/pages/api/analysis/index.ts:196-199` — `LLMParseError`/any throw → status `failed` (malformed = hard error)
- `src/components/analysis/AnalysisResults.tsx:24-30` — `CATEGORY_LABELS` with the WRONG keys (live Risk #2 bug)
- `src/components/analysis/AnalysisResults.tsx:76-97` — render-by-label loop that drops all schema-category questions
- `src/components/analysis/AnalysisView.tsx:94-100` — passes `questions` through with no category remap
- `src/pages/api/analysis/[id]/index.ts:32-36` — GET returns `category` as stored
- `tests/lib/llm/client.test.ts:9-34` — existing `generateText`/provider mock pattern (the network-edge seam)
- `tests/lib/analysis/schema.test.ts:36-56` — existing empty-array-valid / bad-category-rejected coverage
- `vitest.config.ts:10-13` — node env only; no jsdom for render tests

## Architecture Insights

- **Shape is validated; meaning is not.** Zod guarantees the response *shape* and
  the category *enum*, but nothing checks that the content is grounded in the
  input (Risk #1) or that the validated categories survive to the screen
  (Risk #2). The two risks live on opposite sides of the validated boundary:
  Risk #1 *before* validation can catch it (content), Risk #2 *after* it (render).
- **Fail-loud on parse, fail-silent on render.** Malformed LLM JSON correctly
  becomes a `failed` analysis; but a perfectly valid analysis silently renders
  empty due to the category desync. The dangerous failure is the silent one.
- **The oracle is preserved end-to-end** (`anonymizedText` + `profile`), which
  makes deterministic faithfulness testing viable without an LLM-as-judge.
- **Mock at the edge is already the house style** — extend the `generateText`
  mock rather than introducing MSW.

## Historical Context (from prior changes)

- `context/changes/first-gated-generation/plan.md` & `research.md` — the change
  that built this generation pipeline (prompt, schema, `completeLLM`, the analysis
  route, and the render components). The category-vocabulary desync most likely
  originates here (render scaffolded with placeholder QA-skill categories while
  the schema settled on anomaly categories).
- `context/changes/llm-integration-scaffold/plan.md` — established the `src/lib/llm`
  client, error hierarchy, and the `vi.mock("ai")` test pattern reused above.
- `context/changes/data-schema-and-rls/plan.md` — defines `analyses` /
  `analysis_questions` tables and the `category` column that stores the enum.

## Related Research

- `context/changes/first-gated-generation/research.md` — prior exploration of the
  generation flow.
- `context/archive/2026-05-30-candidate-name-on-card/research.md` — touches
  `AnalysisView`/candidate rendering (adjacent render-layer context).

## Open Questions

1. **Is the `CATEGORY_LABELS` desync confirmed in a running build, or is there a
   remap I missed?** Static tracing shows none, but a quick manual run (or the
   first render test) should confirm the empty-render before we decide the fix
   belongs in this change or a separate bug-fix change. (Phase 1 is a *testing*
   rollout — does the bug-fix ride along, or does the test land RED and the fix
   follow?)
2. **Render test environment**: Phase 1's Risk #2 protection needs a DOM. Add
   `environment: "jsdom"` (or `happy-dom`) + `@testing-library/react`, scoped to
   `tests/components/**` via Vitest projects/`environmentMatchGlobs` so the
   existing node-env `tests/lib` suite is unaffected? Decide in planning.
3. **Faithfulness granularity for Risk #1**: token/substring entailment vs.
   span-level NLI. Start with the cheapest deterministic check (every proper-noun /
   skill / claim token in a question or rationale must appear in
   `anonymizedText` or the profile) and only escalate to LLM-as-judge if it is too
   noisy?
4. **Fixture provenance**: record real `(anonymizedText, profile, llmResult)`
   triples from a local LM Studio run, or hand-author minimal fixtures? Real
   recordings give better Risk #1 signal; hand-authored give deterministic Risk #2
   edge cases (empty array, valid-but-unrenderable category).
