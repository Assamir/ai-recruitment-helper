# Output Grounding & Response Integrity (Test Rollout Phase 1) — Implementation Plan

## Overview

Phase 1 of the test rollout (`context/foundation/test-plan.md` §3) protects the
two highest-priority risks:

- **Risk #1 — Grounding/faithfulness**: the LLM generates questions/rationales
  referencing claims **not present** in the CV or job profile (hallucinated red
  flags). Today the only safeguard is a prompt instruction; nothing deterministic
  backs it.
- **Risk #2 — Response integrity**: a validated analysis silently renders as
  "no findings". This is a **confirmed live bug**: `AnalysisResults.tsx` groups
  questions by a `CATEGORY_LABELS` map whose keys do not match the schema's
  category enum, so every question section renders `null` while the summary shows
  — the textbook "confident-but-incomplete" failure.

This change (a) stands up the test infrastructure Phase 1 needs (a DOM
environment isolated from the existing node-env suite), (b) **fixes** the Risk #2
render bug and guards it with a component test, (c) adds a deterministic
faithfulness check plus a `(CV, JD, response)` fixture corpus for Risk #1, and
(d) wires `npm run test` into CI so the gate the test-plan marks "required after
Phase 1" is actually enforced.

## Current State Analysis

- **Pipeline**: upload → CV parse → `anonymizeCV` → `buildAnalysisPrompt` →
  `completeLLM` (`generateText` + `extractJSON` + Zod `safeParse`) → insert rows
  → GET → render. The oracle for grounding (`anonymizedText` + `profile`) is in
  scope at `src/pages/api/analysis/index.ts:149-171`.
- **Shape is validated; meaning is not.** Zod guarantees response shape and the
  category enum (`src/lib/analysis/schema.ts:3,16-19`). Malformed JSON correctly
  becomes a `failed` analysis (`api/analysis/index.ts:196-199`). But nothing
  checks that content is grounded (Risk #1), and a *valid* response renders empty
  due to the category desync (Risk #2).
- **The Risk #2 bug, confirmed by static tracing**:
  - Schema / prompt / DB inserts use `missing_elements | contradictions |
    vague_claims | anomalies` (`schema.ts:3`, `prompt.ts:3-7`,
    `api/analysis/index.ts:174-181` inserts `q.category` verbatim).
  - `src/components/analysis/AnalysisResults.tsx:24-30` keys `CATEGORY_LABELS`
    (and `CATEGORY_ICONS`) on `qa_fundamentals | test_automation | processes |
    technical | soft_skills` — a different vocabulary.
  - Render loop `:76-95` iterates `CATEGORY_LABELS`; `grouped` is keyed by the
    schema categories → no key matches → every section returns `null`. The
    `questions.length === 0` fallback `:97` never fires (length > 0). Net:
    summary renders, all N questions vanish, no empty-state.
  - `AnalysisResults.tsx` is the **only** file in `src/` using the
    `qa_fundamentals`-style keys; `AnalysisView.tsx:94-100` and
    `api/analysis/[id]/index.ts:32-36` pass `category` straight through with no
    remap.
- **Test infrastructure**:
  - Vitest 4.1.x (`package.json:66`), config `vitest.config.ts` — `@`→`src`,
    `globals:true`, `passWithNoTests:true`. **No `environment` set** (defaults to
    node), no setup file, no projects split, no coverage.
  - 11 tests, all under `tests/lib/**` mirroring `src/lib/**`.
  - **Network-edge mock already in repo**: `tests/lib/llm/client.test.ts:9-12`
    mocks `ai`'s `generateText` and `Output`; `:14-34` mock the provider
    factories. This is the seam the test-plan mandates mocking at.
  - **No DOM env, no `@testing-library/react`** → Risk #2's worst case is wholly
    untested.
  - **No fixture corpus** for `(CV, JD, response)` triples yet.
- **CI** (`.github/workflows/ci.yml`): the `lint-build` job runs `npm ci` →
  `npx astro sync` → `npm run lint` → `npm run build`. It does **not** run
  `npm run test`. The test-plan gate "unit + integration required after Phase 1"
  (§5) is therefore not yet enforced in CI.
- **Anonymizer placeholder format** (the oracle's vocabulary): `[CANDIDATE_NAME]`,
  `[EMAIL]`, `[PHONE]`, `[URL]`, `[COMPANY_1]`, `[COMPANY_2]`, …
  (`src/lib/anonymizer/index.ts:90-104`). The faithfulness check sees
  `anonymizedText`, so it must treat these placeholders as legitimate grounded
  tokens and never expect raw PII.

## Desired End State

After this change:

1. `npm run test` runs two Vitest projects — the existing `tests/lib/**` suite on
   the node environment (unchanged, still green) and a new `tests/components/**`
   suite on jsdom with `@testing-library/react`.
2. The Risk #2 render bug is **fixed**: a completed analysis with N questions
   renders the summary *and* all N questions grouped by their real categories; an
   empty-questions analysis shows the "No questions were generated." empty-state.
   A component test proves all three behaviors (GREEN).
3. A deterministic faithfulness helper plus a `(CV, JD, response)` fixture corpus
   prove Risk #1: a fabricated/ungrounded claim is flagged by the check; grounded
   real-run fixtures pass; legitimate `missing_elements` findings (referencing the
   JD, not the CV) are not falsely flagged.
4. CI's `lint-build` job runs `npm run test`; a failing grounding or render test
   blocks merge.
5. `test-plan.md` §6.2 / §6.5 cookbook sections and the Phase 1 status are
   updated.

### Key Discoveries

- The render bug is real and isolated to one component
  (`AnalysisResults.tsx:24-38,76-95`) — the fix is a vocabulary correction, not a
  data-flow change.
- The oracle is preserved end-to-end (`anonymizedText` + `profile`), so
  deterministic faithfulness is viable without an LLM-as-judge
  (`api/analysis/index.ts:149-171`).
- The `generateText` edge mock is already house style
  (`tests/lib/llm/client.test.ts:9-12`) — no MSW needed.
- Anonymizer emits structured placeholders (`index.ts:90-104`) the check must
  whitelist as grounded.

## What We're NOT Doing

- **No runtime grounding guard.** The faithfulness check is a test-only utility;
  the pipeline does not reject ungrounded responses at runtime. That would be a
  product decision with its own UX/perf/failure-mode questions, out of scope here.
- **No LLM-as-judge.** Deferred per test-plan §4 unless the deterministic check
  proves too noisy.
- **No coverage thresholds.** Premature for a young suite (test-plan §5 doesn't
  ask for it at Phase 1).
- **No full-pipeline / orchestration-route test.** `api/analysis/index.ts` is an
  Astro `APIRoute` with heavy `context.locals` and Supabase dependencies;
  end-to-end orchestration is explicitly deferred to test-plan Phase 4.
- **No new category-contract guard test.** The render fix + component test cover
  the bug; a separate enum-equality guard was considered and deliberately
  dropped to keep scope tight (per planning decision).
- **No changes to the anonymizer, schema, prompt, or LLM client logic.** Only the
  render component changes; everything else is additive (tests + config + CI).

## Implementation Approach

Four phases, ordered so each builds on the last and is independently verifiable:

1. **Test infrastructure** — split Vitest into node (`tests/lib/**`) and jsdom
   (`tests/components/**`) projects, add `@testing-library/react` + a setup file.
   Nothing else can be tested at the render layer until this lands.
2. **Risk #2 (render integrity)** — fix the `CATEGORY_LABELS` desync and prove it
   with a component test (GREEN). Depends on Phase 1's DOM env.
3. **Risk #1 (grounding)** — build the deterministic faithfulness helper, author
   the fixture corpus (hand-authored edge cases + 1–2 recorded real runs), and
   assert grounding over them.
4. **CI gate + docs** — add `npm run test` to CI and fill in the test-plan
   cookbook/status.

The faithfulness check is **deterministic and stronger than proper-noun
matching** (per planning decision): it extracts salient claim spans (skills,
proper nouns, numbers, certifications, multi-word terms) and scores each against
a normalized oracle using exact + n-gram/phrase-overlap matching, flagging spans
whose coverage falls below a tuned threshold. It is placeholder-aware and treats
both `anonymizedText` and the profile (name/description/expected_skills) as the
oracle.

## Critical Implementation Details

- **Vitest project isolation is load-bearing.** The existing 11 tests assume the
  node environment (they import server/lib modules, never a DOM). The jsdom
  project must be scoped to `tests/components/**` only; flipping the global
  environment risks subtle behavior changes in the existing suite. Verify Vitest
  4's current `projects` API via Context7 before writing config — the
  `environmentMatchGlobs` option was deprecated in favor of `projects` in recent
  Vitest versions.
- **The faithfulness threshold needs a deliberate ungrounded fixture to tune
  against.** Author at least one fixture whose question references a skill/tool
  absent from both CV and JD — the check MUST flag it. Without a known-bad
  fixture the threshold is unfalsifiable.
- **`missing_elements` findings are grounded in the JD, not the CV.** A question
  like "the role needs k6 but the CV omits it" references an expected skill — the
  oracle must include `profile.expected_skills`/`description`, or these
  legitimate findings get falsely flagged as hallucinations.

---

## Phase 1: Test Infrastructure (DOM environment, isolated)

### Overview

Add a jsdom-backed Vitest project and React Testing Library so render tests can
run, without disturbing the existing node-env `tests/lib/**` suite.

### Changes Required

#### 1. Testing dependencies

**File**: `package.json`

**Intent**: Add the libraries needed to render and assert React components in
tests. The render layer currently has no way to be exercised.

**Contract**: Add dev dependencies `@testing-library/react`,
`@testing-library/jest-dom`, `@testing-library/user-event` (if interaction is
needed), and a DOM env package (`jsdom`). Install at versions compatible with
React 19 and Vitest 4.1.x — verify current versions via Context7 / npm rather
than guessing.

#### 2. Vitest projects split

**File**: `vitest.config.ts`

**Intent**: Run `tests/lib/**` on node (as today) and `tests/components/**` on
jsdom, sharing the `@`→`src` alias and `globals: true`.

**Contract**: Convert the single `test` block into a two-project config (Vitest 4
`test.projects`): a `node` project (env `node`, include `tests/lib/**`) and a
`components` project (env `jsdom`, include `tests/components/**`, `setupFiles`
pointing at the new setup file). Preserve `globals` and `passWithNoTests`. Keep
the resolve alias shared across projects. Confirm the exact Vitest 4 projects
schema via Context7 before writing.

#### 3. Test setup file

**File**: `tests/setup/dom.ts` (new)

**Intent**: Register `@testing-library/jest-dom` matchers and any per-test
cleanup for the jsdom project.

**Contract**: Import `@testing-library/jest-dom/vitest`; rely on RTL's automatic
cleanup (or register `afterEach(cleanup)` if not automatic under `globals`).
Referenced by the components project's `setupFiles`.

### Success Criteria

#### Automated Verification

- Existing suite unaffected: `npm run test` runs all 11 `tests/lib/**` tests on
  node and they pass.
- A trivial smoke render test under `tests/components/**` (rendering a one-line
  component and asserting text) passes on jsdom.
- Lint passes: `npm run lint`.
- Build still passes: `npx astro sync && npm run build`.

#### Manual Verification

- `npm run test:watch` shows both projects and lets you filter to one.
- No node-env test accidentally picks up the jsdom environment (spot-check a
  `tests/lib` test still has no `document`).

**Implementation Note**: After automated verification passes, pause for manual
confirmation before proceeding to Phase 2.

---

## Phase 2: Risk #2 — Render Integrity (fix + component test)

### Overview

Fix the `CATEGORY_LABELS` category desync so validated questions render, and add
a component test proving the summary + all questions render, grouped correctly,
with a real empty-state for zero questions.

### Changes Required

#### 1. Correct the render category vocabulary

**File**: `src/components/analysis/AnalysisResults.tsx`

**Intent**: Make the render group questions by the same category vocabulary the
schema, prompt, and DB use, so every stored question is displayed under a
correct, labeled section.

**Contract**: Re-key `CATEGORY_LABELS` and `CATEGORY_ICONS` (`:24-38`) to the
`AnalysisCategory` enum from `src/lib/analysis/schema.ts:3`
(`missing_elements`, `contradictions`, `vague_claims`, `anomalies`) with
human-readable labels/icons. The render loop (`:76-95`) and empty-state (`:97`)
stay as-is — once the keys match `grouped`, sections populate and the
empty-state only fires on a genuinely empty array. Keep the label/icon source
consistent with the enum so a future enum change is a one-spot edit.

#### 2. Component test for the analysis render

**File**: `tests/components/analysis/AnalysisResults.test.tsx` (new)

**Intent**: Lock the Risk #2 protection: a completed analysis never silently
renders as "no findings".

**Contract**: Render `<AnalysisResults>` with RTL and assert:
- Given a `match_summary` + N questions spanning ≥2 categories: the summary text
  is present AND all N questions are visible, each under its correct category
  heading (the regression that proves the desync is fixed — this would FAIL
  against the pre-fix component).
- Given a non-null `match_summary` + `questions: []`: the "No questions were
  generated." empty-state renders (FR-007 legitimate-empty path).
- Question fields (`question`, `rationale`, `suggested_answer`) render; a `null`
  `suggested_answer` does not crash.

### Success Criteria

#### Automated Verification

- `npm run test` passes including the new component test.
- The N-questions assertion fails when run against the pre-fix `CATEGORY_LABELS`
  (verify once by temporarily reverting, to confirm the test actually guards the
  bug — then restore).
- Lint passes: `npm run lint`.

#### Manual Verification

- Run a real analysis locally (LM Studio) end-to-end; the dashboard analysis view
  now shows the questions grouped by category, not an empty list.
- Visual check: category labels/icons read sensibly for each of the four
  categories.

**Implementation Note**: After automated verification passes, pause for manual
confirmation before proceeding to Phase 3.

---

## Phase 3: Risk #1 — Deterministic Grounding (helper + fixtures)

### Overview

Add a deterministic, test-only faithfulness helper and a `(CV, JD, response)`
fixture corpus; assert that every salient claim in generated output traces to the
input oracle, and that a fabricated claim is flagged.

### Changes Required

#### 1. Deterministic faithfulness helper (test utility)

**File**: `tests/lib/analysis/faithfulness.ts` (new, test-only helper)

**Intent**: Given the oracle (`anonymizedText` + profile) and an
`AnalysisResponse`, return which salient claim spans in each question/rationale
are NOT grounded in the oracle — without ever asking a model what is "correct".

**Contract**: Export a function such as
`findUngroundedClaims(oracle: { anonymizedText: string; profile: { name: string; description: string; expected_skills: unknown } }, response: AnalysisResponse): UngroundedFinding[]`.
Behavior (per planning decisions):
- Build a normalized oracle string from `anonymizedText` + `profile.name` +
  `profile.description` + stringified `expected_skills`.
- Normalize case, whitespace, and punctuation on both sides before comparison.
- Whitelist anonymizer placeholders (`[CANDIDATE_NAME]`, `[EMAIL]`, `[PHONE]`,
  `[URL]`, `[COMPANY_N]`) as always-grounded.
- Extract **salient claim spans** from each `question` + `rationale` (skills,
  proper nouns, numbers, certifications, multi-word technical terms) — not
  connective prose.
- Score each span against the oracle with exact + n-gram/phrase-overlap matching
  (stronger than proper-noun-only); flag spans whose overlap is below a tuned
  threshold. Document the threshold and token-class rule in a comment.
- Return structured findings (which question index, which span, why) so failing
  tests are debuggable.

This is a test utility — it ships in `tests/`, not `src/`, and adds no runtime
dependency to the pipeline.

#### 2. Fixture corpus

**File**: `tests/fixtures/analysis/` (new directory)

**Intent**: Provide deterministic `(anonymizedText, profile, llmResult)` triples
covering the grounding edge cases and realistic model output.

**Contract**: Include:
- **Hand-authored — grounded**: a triple where every question traces to the CV
  or JD (must PASS the check).
- **Hand-authored — ungrounded**: a triple whose question references a skill/tool
  absent from both CV and JD (must be FLAGGED). This is the threshold's
  falsifiability anchor.
- **Hand-authored — legitimate missing_elements**: a question referencing an
  `expected_skills` item absent from the CV (must PASS, proving the profile is
  part of the oracle).
- **Hand-authored — empty + unrenderable edges**: `questions: []`, and a
  valid-but-edge response (already partly covered by `schema.test.ts`).
- **Recorded — 1–2 real runs**: real `(anonymizedText, profile, llmResult)`
  triples captured from a local LM Studio run for realistic Risk #1 signal.
  Store as JSON; document in a short `tests/fixtures/analysis/README.md` how they
  were captured so they can be regenerated.

#### 3. Grounding tests

**File**: `tests/lib/analysis/faithfulness.test.ts` (new)

**Intent**: Exercise the helper against the corpus to prove Risk #1 protection.

**Contract**: Assert grounded/legitimate fixtures yield zero ungrounded findings;
the ungrounded fixture yields ≥1 finding pointing at the fabricated span; recorded
real runs pass (or, if a real run surfaces a genuine grounding gap, document it as
a finding rather than loosening the threshold to hide it).

### Success Criteria

#### Automated Verification

- `npm run test` passes including `faithfulness.test.ts`.
- The ungrounded fixture is flagged (negative test asserts ≥1 finding).
- Grounded + legitimate-missing fixtures produce zero findings.
- Lint passes: `npm run lint`.

#### Manual Verification

- Review flagged spans on the ungrounded fixture read sensibly (the helper points
  at the actual fabricated token, not noise).
- Confirm the recorded real-run fixtures are anonymized (contain placeholders,
  no raw PII) before committing.

**Implementation Note**: After automated verification passes, pause for manual
confirmation before proceeding to Phase 4.

---

## Phase 4: CI Gate + Cookbook/Test-Plan Updates

### Overview

Enforce the new tests in CI and record the patterns in the test-plan so future
contributors follow them.

### Changes Required

#### 1. Run tests in CI

**File**: `.github/workflows/ci.yml`

**Intent**: Make a failing grounding or render test block merge — satisfying the
test-plan §5 gate "unit + integration required after Phase 1".

**Contract**: Add a `- run: npm run test` step to the `lint-build` job, after
`npm run lint` and before/after `npm run build` (tests don't need the build
artifact, so placing them right after lint gives faster feedback). No new secrets
required — tests mock the LLM edge and don't hit Supabase.

#### 2. Test-plan cookbook + status

**File**: `context/foundation/test-plan.md`

**Intent**: Fill the previously-TBD cookbook sections and mark Phase 1 done.

**Contract**: Update §6.2 (integration test pattern: LLM-response-fixture
grounding, edge-mock only), §6.5 (grounding/faithfulness pattern with the
`tests/lib/analysis/faithfulness.ts` helper + corpus), and optionally a §6.6 note.
Move the §3 Phase 1 Status to its completed value and update the §4 "API / network
mocking" and "CV fixture corpus"/"AI-native" rows to reflect what landed (edge
mock + fixture corpus exist; deterministic entailment chosen, LLM-judge still
deferred). Update §8 freshness date.

### Success Criteria

#### Automated Verification

- CI `lint-build` job runs `npm run test` (verify in the workflow run on the PR).
- A deliberately broken test causes the CI job to fail (verify once on a scratch
  commit, then revert).
- `npm run lint` and `npm run build` still pass in CI.

#### Manual Verification

- The PR check list shows the test step running and green.
- `test-plan.md` reads accurately for a contributor who wasn't part of this change
  (cookbook sections are followable, Phase 1 status reflects reality).

**Implementation Note**: Final phase — after automated + manual verification,
the change is ready to merge and archive.

---

## Testing Strategy

### Unit Tests

- Deterministic faithfulness helper over the fixture corpus (grounded passes,
  ungrounded flagged, legitimate-missing passes).
- Existing schema/parse tests remain the malformed-response guard
  (`tests/lib/analysis/schema.test.ts`, `tests/lib/llm/client.test.ts`).

### Integration Tests

- Component render test for `AnalysisResults` (jsdom) — the Risk #2 guard.
- Grounding tests treat recorded `(CV, JD, response)` triples as the fixture-driven
  integration surface (LLM mocked at the edge / captured offline).

### Manual Testing Steps

1. Run a real analysis locally via LM Studio; confirm the dashboard view shows
   questions grouped by category (not empty).
2. Confirm an analysis that genuinely returns `questions: []` shows the empty
   state.
3. Inspect the ungrounded-fixture findings for sensibility.
4. Open a PR and confirm CI runs and gates on `npm run test`.

## Performance Considerations

- The faithfulness check runs only in tests; no runtime/latency impact on the 60s
  analysis pipeline.
- jsdom adds startup cost only to the `tests/components/**` project; the node
  suite is unchanged.

## Migration Notes

- No DB or schema migration. The Risk #2 fix is a pure render-layer correction;
  stored `category` values already match the corrected vocabulary, so existing
  completed analyses render correctly immediately after deploy (no backfill).

## References

- Research: `context/changes/testing-output-grounding-response-integrity/research.md`
- Test plan: `context/foundation/test-plan.md` (§1 principles, §2 Risk #1/#2, §3
  Phase 1, §5 gates, §6 cookbook)
- Live bug: `src/components/analysis/AnalysisResults.tsx:24-38,76-97`
- Oracle in scope: `src/pages/api/analysis/index.ts:149-171`
- Edge-mock pattern: `tests/lib/llm/client.test.ts:9-34`
- Anonymizer placeholders: `src/lib/anonymizer/index.ts:90-104`
- CI workflow: `.github/workflows/ci.yml:9-28`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test Infrastructure (DOM environment, isolated)

#### Automated

- [x] 1.1 Existing 11 `tests/lib/**` tests pass on node via `npm run test` — bb47566
- [x] 1.2 A smoke render test under `tests/components/**` passes on jsdom — bb47566
- [x] 1.3 Lint passes: `npm run lint` — bb47566
- [x] 1.4 Build passes: `npx astro sync && npm run build` — bb47566

#### Manual

- [x] 1.5 `npm run test:watch` shows both projects and filters work — bb47566
- [x] 1.6 node-env tests still have no `document` (spot-check) — bb47566

### Phase 2: Risk #2 — Render Integrity (fix + component test)

#### Automated

- [x] 2.1 `npm run test` passes including the new component test — 82ddbf7
- [x] 2.2 N-questions assertion fails against pre-fix `CATEGORY_LABELS` (verified once, then restored) — 82ddbf7
- [x] 2.3 Lint passes: `npm run lint` — 82ddbf7

#### Manual

- [ ] 2.4 Real local analysis renders questions grouped by category
- [ ] 2.5 Category labels/icons read sensibly for all four categories

### Phase 3: Risk #1 — Deterministic Grounding (helper + fixtures)

#### Automated

- [x] 3.1 `npm run test` passes including `faithfulness.test.ts`
- [x] 3.2 Ungrounded fixture is flagged (≥1 finding)
- [x] 3.3 Grounded + legitimate-missing fixtures produce zero findings
- [x] 3.4 Lint passes: `npm run lint`

#### Manual

- [ ] 3.5 Flagged spans on the ungrounded fixture read sensibly
- [ ] 3.6 Recorded real-run fixtures are anonymized (placeholders, no raw PII)

### Phase 4: CI Gate + Cookbook/Test-Plan Updates

#### Automated

- [x] 4.1 CI `lint-build` job runs `npm run test`
- [x] 4.2 A deliberately broken test fails the CI job (verified once, then reverted)
- [x] 4.3 `npm run lint` and `npm run build` still pass in CI

#### Manual

- [ ] 4.4 PR check list shows the test step running and green
- [ ] 4.5 `test-plan.md` cookbook + Phase 1 status read accurately for a fresh contributor
