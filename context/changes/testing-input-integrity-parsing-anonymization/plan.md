# Input Integrity â€” Parsing + Anonymization (Test Rollout Phase 2) â€” Implementation Plan

## Overview

Phase 2 of the test rollout (`context/foundation/test-plan.md` Â§3) protects the two
input-side risks on the **upload â†’ parse â†’ store raw â†’ anonymize â†’
`buildAnalysisPrompt` â†’ `completeLLM` â†’ render** pipeline:

- **Risk #5 â€” garbage CV text analyzed as if real.** The only "no usable text" gate
  today is `text.trim().length === 0 â†’ EMPTY_CONTENT` in
  `src/lib/cv-parser/index.ts:27-32`. Empty/scanned-to-`""`, corrupt, and wrong-MIME
  files fail loud. **Non-empty garbage** (PDF noise, mangled tables, pasted junk, bad
  stored text on retry) passes silently into `completeLLM`. The change goal is explicit:
  garbage must be **rejected, not analyzed**.
- **Risk #3 â€” raw PII crosses the org boundary.** On the analysis route, anonymization
  is mandatory: the prompt embeds only `anonymizedText` (`api/analysis/index.ts:149-171`,
  `prompt.ts:49-50`), so raw PII reaches the provider **only on an anonymizer miss**. The
  anonymizer is regex + section heuristics with documented, *accepted* MVP gaps. Nothing
  today asserts that the string handed to `buildAnalysisPrompt` / `completeLLM` is free of
  raw PII.

This change (a) adds a **fail-fast quality gate** that rejects non-empty garbage at the
single resolved-`cvText` chokepoint (covering file, paste, and retry inputs) and tests it;
(b) characterizes real parser dispatch/error behavior with mocked-extractor text fixtures;
(c) adds the **decisive Risk #3 boundary assert** â€” no catchable raw PII survives
`anonymizeCV â†’ buildAnalysisPrompt` â€” plus unit characterization of the anonymizer's
section heuristics and its accepted MVP gaps; and (d) records the patterns in the test-plan
cookbook and flips Phase 2 status. CI already runs `npm run test` (wired in test-rollout
Phase 1), so the new tests gate automatically.

## Current State Analysis

- **Single mandatory anonymize seam.** The analysis route has exactly one
  `anonymizeCV â†’ buildAnalysisPrompt â†’ completeLLM` path with no skip branch
  (`api/analysis/index.ts:149-171`). The prompt embeds only `anonymizedText` at its tail
  (`prompt.ts:49-50`). This makes a boundary assert cheap and decisive at the lib seam â€”
  no route harness needed.
- **`cvText` is resolved through three branches that then converge.** Retry-from-DB
  (`index.ts:47-64`, falsy-check only), file upload (`:65-74`, `extractText` â†’
  `EMPTY_CONTENT`/`PARSE_FAILED`/`UNSUPPORTED_FORMAT` â†’ 400), and paste (`:75-77`,
  trim-non-empty only). All three assign `cvText` and fall through to a common point at
  `:80` before name resolution and DB insert. **That convergence point at `:80` is the
  single chokepoint** where a quality gate covers every input path.
- **Parser error contract.** `CVParseError` carries codes
  `UNSUPPORTED_FORMAT | PARSE_FAILED | EMPTY_CONTENT` (`cv-parser/errors.ts:1-11`); the
  route maps any `CVParseError` from the file branch â†’ HTTP 400 (`index.ts:69-73`).
- **Anonymizer behavior** (`anonymizer/index.ts:41-132`): empty/whitespace â†’ passthrough;
  email/phone/url regexes (`patterns.ts:20-51`); header-only Title-Case name
  (`section-rules.ts:10-40`); pipe-table-only companies, then all literal occurrences
  replaced (`section-rules.ts:48-73`, `index.ts:58-71`). **Addresses hard-coded to 0**
  (`index.ts:129`); `findDates` defined but **never called** (`patterns.ts:53-55`). These
  are documented, accepted MVP trade-offs â€” not bugs to silently rewrite.
- **Test infrastructure exists.** Vitest two-project config from Phase 1: `node`
  (`tests/lib/**`) + `components` (`tests/components/**`, jsdom); `globals: true`,
  `@`â†’`src` (`vitest.config.ts`). `vi.mock("ai")` at the network edge is house style
  (`tests/lib/llm/client.test.ts`). CI runs `npm run test` (test-rollout Phase 1 wired it).
- **Current coverage gaps** (research):
  - cv-parser: `index.test.ts` mocks the extractors (MIME dispatch, `EMPTY_CONTENT`,
    `PARSE_FAILED`, re-throw); `docx.test.ts` runs real `fflate` on a programmatic ZIP. **No
    test for non-empty garbage**; **no quality gate exists** to test.
  - anonymizer: `patterns.test.ts` + `index.test.ts` on inline strings. **No
    `section-rules.test.ts`**. `prompt.test.ts:75-79` checks a pre-anonymized constant,
    **not** the `anonymizeCV â†’ buildAnalysisPrompt` chain. **No boundary PII-free assert.**

## Desired End State

After this change:

1. A non-empty-garbage CV (via file, paste, or retry) is **rejected with a clean 400**
   before `completeLLM`, never analyzed. A real-but-terse CV still passes. A deterministic
   unit test proves all three, with a known-bad fixture anchoring the threshold's
   falsifiability.
2. The parser's dispatch and full error contract
   (`UNSUPPORTED_FORMAT`/`PARSE_FAILED`/`EMPTY_CONTENT`/new gate) are characterized with
   extractor-output text fixtures and a mocked extractor edge.
3. A deterministic boundary test proves Risk #3: across a synthetic messy-CV corpus, the
   string `buildAnalysisPrompt` produces from `anonymizeCV(cv).anonymizedText` contains
   **none** of the catchable raw-PII values (email, intl/US phone, header name, pipe-table
   company).
4. The anonymizer's section heuristics and its accepted MVP gaps (body-only company,
   single-token/ALL-CAPS/hyphenated name, phone without `+`/US shape, addresses, dates)
   are characterized with falsifiable fixtures â€” documenting current behavior, not
   rewriting the anonymizer.
5. `test-plan.md` Â§6 cookbook, Â§3 Phase 2 status, Â§4 corpus row, and Â§8 freshness are
   updated; the new tests gate in CI.

### Key Discoveries

- The three input branches converge at `index.ts:80` â€” one gate call there covers
  file + paste + retry (the user's "single chokepoint" decision).
- The org boundary is a pure lib seam (`anonymizeCV â†’ buildAnalysisPrompt`), so the
  decisive Risk #3 assert needs no Supabase/route/LLM â€” just the two function calls and a
  string check.
- PII echo âŠ† anonymizer misses: the LLM only ever sees `anonymizedText`, so it can only
  echo PII already present in `anonymizedText`. The boundary PII-free assert fully covers
  the echo surface â€” no separate render-layer echo test is needed (planning decision).
- `CVParseError` + the route's existing `â†’ 400` mapping is the established pattern to reuse
  for the new gate (`errors.ts:1-11`, `index.ts:69-73`).

## What We're NOT Doing

- **No rewrite of the anonymizer or parser detection logic.** The accepted MVP gaps
  (body-only company, single-token name, addresses, unused `findDates`) are product
  decisions; Phase 2 *characterizes* them with falsifiable fixtures, it does not silently
  fix them. The only production change is the additive Risk #5 quality gate.
- **No real `unpdf`/`fflate` runs against binary fixtures.** Per the planning decision, the
  extractor edge is mocked and the corpus is extractor-output *text*; real PDF-extraction
  quirks stay uncovered (accepted). The one existing real-`fflate` DOCX test
  (`docx.test.ts`) is left as-is.
- **No `/api/llm/health` work.** That endpoint sends synthetic (no real PII), auth-gated
  text to the provider; it is out of scope for this phase and left untouched.
- **No separate PII-echo / rendered-output test.** Covered by the boundary assert (echo âŠ†
  anonymizer misses).
- **No full analysis-route integration test.** The route is a heavy Astro `APIRoute`
  (`context.locals`, Supabase); end-to-end orchestration and the route-level
  "garbage â†’ 400" / boundary assertion are deferred to test-rollout Phase 4. Risk #5/#3
  automated signal here is the deterministic lib-level unit/integration tests; the
  route-wired gate is verified by build + manual.
- **No export/report test.** No file export exists yet (roadmap S-04 `proposed`); FR-009
  is a future-build concern.
- **No CI changes.** `npm run test` already gates (test-rollout Phase 1). New tests run
  automatically.

## Implementation Approach

Three phases, each independently verifiable:

1. **Risk #5** â€” add a conservative, deterministic quality heuristic + a new
   `CVParseError` code, wire it once at the resolved-`cvText` chokepoint, and prove it
   (clean passes, garbage rejected, terse-real passes) plus characterize the parser's
   dispatch/error contract with mocked-extractor text fixtures.
2. **Risk #3** â€” characterize the anonymizer's section heuristics in isolation, then add
   the decisive boundary PII-free assert over a synthetic messy-CV corpus split into
   "catchable" (must be removed) and "accepted-miss" (documented pass-through) classes.
3. **Docs + gate verification** â€” fill the test-plan cookbook, flip Phase 2 status,
   confirm the new tests gate in CI.

The Risk #5 gate is **conservative by design**: it must reject obvious non-text noise
without rejecting short-but-real CVs. The threshold is tuned against fixtures, with at
least one borderline "terse real CV" fixture that MUST pass and one "non-empty garbage"
fixture that MUST be rejected â€” making the threshold falsifiable rather than arbitrary.

## Critical Implementation Details

- **Gate placement is load-bearing.** The check must sit at the convergence point
  (`api/analysis/index.ts:~80`, after all three branches assign `cvText`, before name
  resolution and the candidates insert) so file, paste, and retry are all covered by one
  call. Placing it inside `extractText` would miss the paste and retry paths.
- **The threshold must be falsifiable.** Author one "non-empty garbage" fixture that MUST
  be rejected and one terse-but-real CV fixture that MUST pass. Without both anchors the
  heuristic is unverifiable and risks rejecting real CVs in production.
- **The Risk #3 boundary corpus must be split by catchability.** Asserting "no raw PII in
  the prompt" over an accepted-miss fixture (e.g. a body-only company name) would FAIL the
  decisive test against documented, accepted behavior. Keep catchable-PII fixtures (assert
  fully removed) separate from accepted-miss fixtures (characterize as pass-through, assert
  current behavior).
- **All Risk #3 fixtures are synthetic.** Use invented names/emails/phones/companies; no
  real candidate data ever enters `tests/fixtures/`.

---

## Phase 1: Risk #5 â€” Fail-Fast Quality Gate + Parser Characterization

### Overview

Add a conservative deterministic quality heuristic and a new `CVParseError` code, wire it
once at the resolved-`cvText` chokepoint so non-empty garbage is rejected (file/paste/retry),
and characterize the parser's dispatch and error contract with mocked-extractor text fixtures.

### Changes Required

#### 1. Quality-gate error code

**File**: `src/lib/cv-parser/errors.ts`

**Intent**: Give the new gate a typed, route-mappable failure code consistent with the
existing parser error contract, so a rejected garbage CV returns a clean 400 like the other
parse failures.

**Contract**: Extend `CVParseErrorCode` with a new member (e.g. `INSUFFICIENT_CONTENT`),
distinct from `EMPTY_CONTENT` (which stays for truly-empty extraction). No change to the
`CVParseError` class shape. The route's existing `CVParseError â†’ 400` mapping already
handles any code.

#### 2. Quality heuristic helper

**File**: `src/lib/cv-parser/quality.ts` (new)

**Intent**: Decide whether a resolved CV string carries enough real textual signal to be
worth analyzing, rejecting obvious non-empty garbage while never rejecting a short-but-real
CV.

**Contract**: Export a function (e.g. `assertUsableCvText(text: string): void` that throws
`CVParseError("INSUFFICIENT_CONTENT", â€¦)` when the text fails the heuristic, or a
predicate `assessCvTextQuality(text): { usable: boolean; reason?: string }` the route turns
into a throw â€” pick one and keep it pure/synchronous). The heuristic combines a few cheap,
deterministic signals tuned conservatively (e.g. minimum count of word-like tokens, minimum
ratio of alphanumeric/letter characters to total, minimum distinct-word count) so dense
encoding noise and metadata fragments fail while a terse real CV passes. Document the chosen
signals and thresholds in a comment, and note they are tuned against the Phase 1 fixtures.
Empty/whitespace input is already handled upstream (`EMPTY_CONTENT`); this helper targets the
**non-empty garbage** class.

#### 3. Wire the gate at the resolved-`cvText` chokepoint

**File**: `src/pages/api/analysis/index.ts`

**Intent**: Reject garbage from any input path before it is persisted, anonymized, and sent
to the LLM.

**Contract**: After the file/paste/retry branch assigns `cvText` (immediately after the
`if/else` block ends, ~`:80`, before name resolution at `:82`), call the quality helper. On
failure return the existing `jsonResponse({ error, code }, 400)` shape (wrap in try/catch
mirroring the file branch at `:69-73`, or branch on the predicate result). This single call
covers file, paste, and retry. Leave `extractText`'s `EMPTY_CONTENT` gate and the per-branch
handling unchanged.

#### 4. Quality-gate unit tests

**File**: `tests/lib/cv-parser/quality.test.ts` (new)

**Intent**: Prove the gate rejects garbage, passes real CVs, and is falsifiable.

**Contract**: Using extractor-output text fixtures (inline strings or
`tests/fixtures/cv/`), assert: a clean CV string passes; a **non-empty garbage** string
(encoding noise / metadata fragments / repeated punctuation) is rejected with
`INSUFFICIENT_CONTENT`; a **terse-but-real** CV (few lines, real words) passes â€” the
falsifiability anchor proving the threshold isn't over-aggressive. Cover the boundary around
the threshold with at least one just-above and one just-below case.

#### 5. Parser dispatch + error-contract characterization

**File**: `tests/lib/cv-parser/index.test.ts` (extend existing)

**Intent**: Lock the full "what the parser returns / rejects" contract research mapped,
including the previously-untested non-empty-garbage handoff.

**Contract**: With the extractor edge mocked (existing pattern), assert: MIME dispatch to
the right extractor; `UNSUPPORTED_FORMAT` for an unknown type; `EMPTY_CONTENT` for `""`/
whitespace extractor output; `PARSE_FAILED` for an extractor throw; inner `CVParseError`
re-thrown unchanged; and that **non-empty garbage extractor output is returned by
`extractText` unchanged** (documenting that `extractText` itself does not gate quality â€” the
chokepoint helper does). Keep the existing real-`fflate` `docx.test.ts` untouched.

### Success Criteria

#### Automated Verification

- `npm run test` passes including `quality.test.ts` and the extended `index.test.ts`.
- The garbage fixture is rejected with `INSUFFICIENT_CONTENT`; the terse-real fixture passes
  (negative + positive anchors both assert).
- Lint passes: `npm run lint`.
- Build passes: `npx astro sync && npm run build`.

#### Manual Verification

- Locally upload/paste an obviously-garbage "CV" (random bytes saved as `.pdf`, or a
  metadata-only paste) â†’ the request returns 400 with the new code, no analysis row reaches
  `analyzing`.
- A short but real CV still analyzes end-to-end (no false rejection).
- A retry against a candidate whose stored `cv_text` is garbage is now also rejected.

**Implementation Note**: After automated verification passes, pause for manual confirmation
before proceeding to Phase 2.

---

## Phase 2: Risk #3 â€” Anonymizer Characterization + Boundary PII-Free Assert

### Overview

Characterize the anonymizer's section heuristics in isolation, then add the decisive
boundary test: across a synthetic messy-CV corpus, no catchable raw PII survives
`anonymizeCV â†’ buildAnalysisPrompt`. Accepted MVP gaps are characterized as documented
pass-throughs, not asserted clean.

### Changes Required

#### 1. Section-rules unit characterization

**File**: `tests/lib/anonymizer/section-rules.test.ts` (new)

**Intent**: Cover the name/company heuristics research flagged as untested, pinning both
what they catch and the accepted classes they miss.

**Contract**: For `findCandidateName`: a header Title-Case 2â€“4-word name is matched;
ALL-CAPS header lines are skipped; only the first qualifying line wins; **misses**
single-token names, 5+-word lines, lines with digits/special chars, and names below the
header (assert current `[]`/no-match behavior, tagged as accepted gaps). For
`findCompanyNames`: a `Title | Company | Date` line yields the company; date-range and
length filters work (`section-rules.ts:59-63`); **misses** companies that appear only in
prose (assert current no-match, tagged accepted).

#### 2. Synthetic messy-CV PII corpus

**File**: `tests/fixtures/cv/` (new directory) + a short `README.md`

**Intent**: Provide deterministic, synthetic CV strings exercising the PII classes at the
boundary, split by catchability.

**Contract**: Two fixture groups, all synthetic:
- **Catchable PII** â€” CV strings containing email, an intl `+` phone, a US `(555)` phone, a
  header Title-Case name, and a pipe-table company. The boundary test asserts none of these
  raw values appear in the prompt.
- **Accepted-miss PII** â€” CV strings containing a body-only company, a single-token/
  ALL-CAPS/hyphenated name, a phone without `+`/US shape, a bare domain, a street address,
  and a `dd/mm/yyyy` date. The characterization tests assert current pass-through behavior,
  tagged as documented gaps (addresses never detected, `findDates` never called).
  `README.md` records that fixtures are synthetic and how to add new ones.

#### 3. Boundary PII-free assert

**File**: `tests/lib/anonymizer/boundary.test.ts` (new)

**Intent**: The decisive Risk #3 guard â€” prove that the string actually handed toward the
LLM is free of catchable raw PII.

**Contract**: For each **catchable-PII** fixture, compute
`buildAnalysisPrompt(anonymizeCV(cv).anonymizedText, profile)` (synthetic `profile`) and
assert the prompt contains the expected placeholders (`[EMAIL]`, `[PHONE]`,
`[CANDIDATE_NAME]`, `[COMPANY_N]`) and **none** of the fixture's raw PII values. This is a
pure lib seam â€” no Supabase, no route, no real LLM. Optionally add one variant that routes
the same prompt through `completeLLM` with `vi.mock("ai")` (house pattern) and asserts the
captured `generateText` prompt argument is equally PII-free, for call-site fidelity.

#### 4. Accepted-miss characterization

**File**: `tests/lib/anonymizer/index.test.ts` (extend existing)

**Intent**: Document, with falsifiable fixtures, which PII classes currently survive
anonymization â€” so the gap is visible and a future improvement is measurable, without
pretending it's fixed.

**Contract**: For each accepted-miss fixture, assert the corresponding raw value **still
appears** in `anonymizeCV(cv).anonymizedText` (current behavior), each test named/commented
to mark it as a documented MVP gap, not a passing privacy guarantee. Include the
hard-coded `piiCount.addresses === 0` and the unused `findDates` as explicit characterizations.

### Success Criteria

#### Automated Verification

- `npm run test` passes including `section-rules.test.ts`, `boundary.test.ts`, and the
  extended `index.test.ts`.
- Every catchable-PII fixture yields a prompt with zero raw PII values and the expected
  placeholders.
- Accepted-miss characterizations assert the current pass-through (so a future anonymizer
  improvement will visibly flip them).
- Lint passes: `npm run lint`.

#### Manual Verification

- Review the boundary assertions: the raw-PII checks key on the actual fixture values, not
  trivially-absent strings.
- Confirm all `tests/fixtures/cv/` content is synthetic (no real candidate PII) before
  committing.

**Implementation Note**: After automated verification passes, pause for manual confirmation
before proceeding to Phase 3.

---

## Phase 3: Test-Plan Cookbook + Status + Gate Verification

### Overview

Record the Phase 2 patterns in the test-plan, flip the Phase 2 status, and confirm the new
tests gate in CI (already wired in test-rollout Phase 1).

### Changes Required

#### 1. Test-plan cookbook + status + freshness

**File**: `context/foundation/test-plan.md`

**Intent**: Make the parsing-quality-gate and boundary-PII-free patterns followable by a
future contributor, and reflect that Phase 2 shipped.

**Contract**: Add cookbook entries for (a) the CV fixture corpus + quality-gate unit
pattern and (b) the boundary PII-free assert at the `anonymizeCV â†’ buildAnalysisPrompt`
seam (mock the `ai` edge only if asserting the call-site variant). Flip Â§3 Phase 2 Status to
its done value with the change-folder path. Update the Â§4 "CV fixture corpus" row (binary
corpus deliberately deferred; extractor edge mocked; `tests/fixtures/cv/` text corpus
exists). Note in Â§6.6 the Risk #5 production gate decision (garbage now rejected at the
chokepoint) and the Risk #3 echo âŠ† misses reasoning. Update Â§8 freshness date.

#### 2. CI gate verification (no code change)

**File**: `.github/workflows/ci.yml` (verify only)

**Intent**: Confirm the existing `npm run test` step picks up and gates on the new tests.

**Contract**: No edit expected â€” confirm the `lint-build` job already runs `npm run test`
(wired in test-rollout Phase 1) and that the new node-project tests run there. Only edit if
the step is somehow missing.

### Success Criteria

#### Automated Verification

- Full `npm run test` (all node + components projects) passes on a clean checkout.
- CI run on the PR shows the test step executing the new tests and gating (a deliberately
  broken assertion fails the job â€” verify once on a scratch commit, then revert).
- `npm run lint` and `npm run build` still pass.

#### Manual Verification

- `test-plan.md` reads accurately for a contributor who wasn't part of this change
  (cookbook entries are followable; Phase 2 status reflects reality).

**Implementation Note**: Final phase â€” after automated + manual verification, the change is
ready to merge and archive.

---

## Testing Strategy

### Unit Tests

- `quality.test.ts` â€” the Risk #5 gate (clean pass, garbage reject, terse-real pass,
  threshold boundary).
- Extended `cv-parser/index.test.ts` â€” full dispatch/error contract incl. non-empty-garbage
  handoff, mocked extractor edge.
- `anonymizer/section-rules.test.ts` â€” name/company heuristics, catch + accepted-miss.
- Extended `anonymizer/index.test.ts` â€” accepted-miss characterizations (body-only company,
  single-token name, address, dates, `piiCount.addresses === 0`).

### Integration Tests

- `anonymizer/boundary.test.ts` â€” `anonymizeCV â†’ buildAnalysisPrompt` PII-free assert over
  the catchable-PII corpus (the decisive Risk #3 guard); optional `vi.mock("ai")` call-site
  variant.

### Manual Testing Steps

1. Upload/paste obvious garbage locally â†’ 400 with `INSUFFICIENT_CONTENT`, no analysis runs.
2. A short but real CV analyzes normally (no false rejection).
3. Retry against a candidate with garbage stored `cv_text` â†’ also rejected.
4. Spot-check boundary assertions key on real fixture PII values; confirm fixtures synthetic.
5. Open a PR; confirm CI runs and gates on the new tests.

## Performance Considerations

- The quality gate is a synchronous, cheap string scan on the front-half of the request
  (before the `waitUntil` background pipeline) â€” negligible latency, no impact on the ~60s
  analysis budget.
- All new tests run in the node Vitest project; no jsdom or network cost added.

## Migration Notes

- No DB or schema migration. The `CVParseErrorCode` union gains a member (additive,
  backward-compatible). The quality gate is a **behavior change**: previously-accepted thin
  inputs could now be rejected â€” the conservative threshold plus the terse-real
  falsifiability fixture mitigate false rejections. No backfill; existing stored analyses
  are unaffected.

## References

- Research: `context/changes/testing-input-integrity-parsing-anonymization/research.md`
- Test plan: `context/foundation/test-plan.md` (Â§2 Risk #3/#5, Â§3 Phase 2, Â§5 gates, Â§6/Â§7)
- Phase 1 artifact pattern: `context/changes/testing-output-grounding-response-integrity/plan.md`
- Gate chokepoint: `src/pages/api/analysis/index.ts:47-80,149-171`
- Parser contract: `src/lib/cv-parser/index.ts:10-35`, `src/lib/cv-parser/errors.ts:1-11`
- Anonymizer seam: `src/lib/anonymizer/index.ts:41-132`, `src/lib/anonymizer/section-rules.ts:10-73`,
  `src/lib/analysis/prompt.ts:32-51`
- Edge-mock pattern: `tests/lib/llm/client.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` â€” <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Risk #5 â€” Fail-Fast Quality Gate + Parser Characterization

#### Automated

- [x] 1.1 `npm run test` passes incl. `quality.test.ts` + extended `index.test.ts` — e18040f
- [x] 1.2 Garbage fixture rejected with `INSUFFICIENT_CONTENT`; terse-real fixture passes — e18040f
- [x] 1.3 Lint passes: `npm run lint` — e18040f
- [x] 1.4 Build passes: `npx astro sync && npm run build` — e18040f

#### Manual

- [x] 1.5 Local garbage upload/paste â†’ 400, no analysis runs — e18040f
- [x] 1.6 Short-but-real CV still analyzes (no false rejection) — e18040f
- [x] 1.7 Retry against garbage stored `cv_text` is rejected — e18040f

### Phase 2: Risk #3 â€” Anonymizer Characterization + Boundary PII-Free Assert

#### Automated

- [x] 2.1 `npm run test` passes incl. `section-rules.test.ts`, `boundary.test.ts`, extended `index.test.ts` — e18040f
- [x] 2.2 Every catchable-PII fixture â†’ prompt with zero raw PII + expected placeholders — e18040f
- [x] 2.3 Accepted-miss characterizations assert current pass-through — e18040f
- [x] 2.4 Lint passes: `npm run lint` — e18040f

#### Manual

- [x] 2.5 Boundary assertions key on real fixture PII values (not trivially-absent strings) — e18040f
- [x] 2.6 All `tests/fixtures/cv/` content confirmed synthetic before commit — e18040f

### Phase 3: Test-Plan Cookbook + Status + Gate Verification

#### Automated

- [x] 3.1 Full `npm run test` passes on a clean checkout — e18040f
- [x] 3.2 CI run shows new tests executing and gating (broken assert fails job, then reverted) — e18040f
- [x] 3.3 `npm run lint` and `npm run build` still pass — e18040f

#### Manual

- [x] 3.4 `test-plan.md` cookbook + Phase 2 status read accurately for a fresh contributor — e18040f
