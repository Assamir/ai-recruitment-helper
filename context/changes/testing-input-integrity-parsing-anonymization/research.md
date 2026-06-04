---
date: 2026-06-04T13:05:00+02:00
researcher: Cursor (Claude Opus 4.8)
git_commit: ceac37d6c431d4bb626e553b2b9fe807d65d86f9
branch: main
repository: ai-recruitment-helper
topic: "Phase 2 input integrity — CV parsing (Risk #5) + anonymization boundary (Risk #3)"
tags: [research, codebase, cv-parser, anonymizer, pii, llm-boundary, test-plan]
status: complete
last_updated: 2026-06-04
last_updated_by: Cursor (Claude Opus 4.8)
---

# Research: Phase 2 input integrity — parsing + anonymization

**Date**: 2026-06-04T13:05:00+02:00
**Researcher**: Cursor (Claude Opus 4.8)
**Git Commit**: ceac37d6c431d4bb626e553b2b9fe807d65d86f9
**Branch**: main
**Repository**: ai-recruitment-helper

## Research Question

Phase 2 of the test rollout in `context/foundation/test-plan.md` (§3). Ground the two
risks before planning tests:

- **Risk #5** — Garbage CV text from PDF/DOCX parsing (empty/scanned/odd-format)
  feeds the pipeline silently → analysis looks correct but is built on nothing.
  *Must challenge:* "parser returned a string ⇒ parse succeeded." *Must ground:*
  what the parser returns for empty/scanned/odd files; how downstream detects
  "no usable text".
- **Risk #3** — Raw PII (name, email, phone, company) survives anonymization and
  crosses the org boundary into the LLM call **or** the exported report.
  *Must challenge:* "anonymizer unit tests pass ⇒ no PII crosses the boundary."
  *Must ground:* the actual boundary call site(s). Scope decision for this
  research: trace **both** the LLM boundary and the export/report boundary.

## Summary

The pipeline is **upload → CV parse → store raw → anonymize → build prompt →
`completeLLM` → store rows → GET → render**. Both risks are *real and partially
unguarded*, and in both cases the gap is exactly the one the test-plan warned about:

- **Risk #5:** The parser's only "no usable text" gate is `text.trim().length === 0`
  in `extractText` (throws `EMPTY_CONTENT`). Truly empty/scanned PDFs that yield `""`
  are rejected synchronously. **Non-empty garbage** (PDF metadata fragments, encoding
  noise, mangled tables) passes silently and flows unchanged into the LLM. There is
  **no minimum-length / quality / gibberish check anywhere** between parse and
  `completeLLM`. The paste path and the retry-from-DB path bypass the parser entirely
  (trim-non-empty only).
- **Risk #3:** On the production analysis route, anonymization is **mandatory** —
  the prompt is built from `anonymizedText`, never `capturedCvText`, so raw PII reaches
  the provider **only if the anonymizer misses it**. The anonymizer is regex + section
  heuristics with documented, *accepted* MVP gaps (header-only name; pipe-table-only
  companies; first occurrence per placeholder). Two real leak surfaces exist:
  (1) a **second LLM path** `/api/llm/health` sends un-anonymized synthetic CV text
  (with real company names) straight to the provider; (2) the in-app result
  (`match_summary` + questions) is LLM-derived and **can echo PII the anonymizer
  missed** back into the browser. **No file export/report exists yet** (roadmap S-04
  `proposed`); FR-009 already requires anonymized-only exports when built.

**Testing gap (both risks):** Current tests are isolation-only. cv-parser tests mock
the PDF/DOCX extractors (no real `unpdf`/`fflate` run, no binary corpus). anonymizer
tests assert on 2 inline strings. **Nothing asserts that the string handed to
`buildAnalysisPrompt` / `completeLLM` is free of raw PII**, and **nothing exercises the
parser on real empty/scanned/odd files**. A binary `.pdf`/`.docx` fixture corpus does
not exist and must be created (it was explicitly deferred from Phase 1, test-plan §4).

## Detailed Findings

### Risk #5 — CV parser return contract & downstream detection

**Entry point** `extractText(file: File): Promise<string>` (`src/lib/cv-parser/index.ts`):

- Success → returns the extractor's raw `string`, no normalization (`index.ts:34`).
- Wrong MIME → throws `CVParseError("UNSUPPORTED_FORMAT")` (`index.ts:13-15`).
- Extractor throws non-`CVParseError` → wrapped as `PARSE_FAILED` (`index.ts:21-25`).
- Inner `CVParseError` → re-thrown unchanged (`index.ts:22`).
- **Empty/whitespace-only after extract → `EMPTY_CONTENT`** — the *only* post-parse
  quality gate:

```27:32:src/lib/cv-parser/index.ts
  if (text.trim().length === 0) {
    throw new CVParseError(
      "EMPTY_CONTENT",
      "The file appears to be empty or contains only non-text content (e.g. scanned images).",
    );
  }
```

- **Non-empty garbage → returned silently** (`index.ts:34`). No min-length, entropy,
  gibberish, or CV-structure check anywhere.

**Extractors:**
- PDF: `unpdf` `extractText({ mergePages: true })`, no local guard (`src/lib/cv-parser/pdf.ts:3-6`).
  Scanned PDF behavior depends on `unpdf`: returns `""` → parent throws `EMPTY_CONTENT`;
  returns any non-whitespace artifact → garbage passes.
- DOCX: `fflate` `unzipSync` + a **hand-rolled `<w:t>` regex parser** (`src/lib/cv-parser/docx.ts:31-47`);
  missing `word/document.xml` or corrupt zip → `PARSE_FAILED`. (Note: `office-oxide-wasm`
  from planning docs was **not** used; `fflate` + custom XML was shipped instead.)

**Error contract** (`src/lib/cv-parser/errors.ts:1-11`): codes
`UNSUPPORTED_FORMAT | PARSE_FAILED | EMPTY_CONTENT`; API maps `CVParseError` → HTTP 400
(`src/pages/api/analysis/index.ts:69-73`).

**Downstream trace — the only production call site is the analysis route:**

| Hop | File:line | Usability check |
|---|---|---|
| File parse | `src/pages/api/analysis/index.ts:65-74` | parser empty/whitespace only |
| Paste path | `src/pages/api/analysis/index.ts:75-77` | trim-non-empty only (bypasses parser) |
| Retry from DB | `src/pages/api/analysis/index.ts:47-63` | falsy check only (bypasses parser) |
| Name resolution | `src/pages/api/analysis/index.ts:82-88` | none |
| DB persist raw `cv_text` | `src/pages/api/analysis/index.ts:92-100` | none |
| Background anonymize | `src/pages/api/analysis/index.ts:149` | empty pass-through only |
| Build prompt | `src/pages/api/analysis/index.ts:164` → `src/lib/analysis/prompt.ts:32-50` | none |
| LLM call | `src/pages/api/analysis/index.ts:166-171` → `src/lib/llm/client.ts:90-96` | validates **LLM output** schema, not input text |

**Risk #5 verdict:** silent-failure surface = **non-empty garbage** (scanned PDFs that
emit noise, mangled layouts, pasted junk, bad stored text on retry). Empty/scanned-to-`""`
and corrupt/wrong-type are already rejected loudly.

### Risk #3 — Anonymizer behavior & PII boundaries

**Contract** `anonymizeCV(text: string): AnonymizationResult` (`src/lib/anonymizer/index.ts:41`)
returns `{ anonymizedText, piiMap, piiCount }` (`src/lib/anonymizer/types.ts:1-11`).
Empty/whitespace → passthrough with empty map, zero counts (`index.ts:42-47`).
`piiMap` maps placeholder → **first** original occurrence only (`index.ts:107-109`).

**Detection (regex + heuristics):**
- `[EMAIL]` `findEmails` regex (`patterns.ts:20-22`)
- `[PHONE]` `findPhones` two regexes — international `+…` and US `(555) 123-4567` (`patterns.ts:24-45`)
- `[URL]` `findUrls` — `https?://`, `linkedin.com/…`, `github.com/…` (path required) (`patterns.ts:48-50`)
- `[CANDIDATE_NAME]` `findCandidateName` — first 10 lines, skip ALL-CAPS headers,
  **one** 2–4 Title-Case-word match (`section-rules.ts:10-39`)
- `[COMPANY_N]` `findCompanyNames` — only pipe-delimited `| Company |` experience lines,
  then all literal occurrences replaced (`section-rules.ts:48-72`, `index.ts:63-70`)
- **Addresses never detected** (`piiCount.addresses` hard-coded `0`, `index.ts:129`);
  `findDates` exists but is **never called** (`patterns.ts:53-55`).

**Documented / accepted slip-through (per prior decisions, not bugs to silently fix):**
names outside the header or repeated in the body; hyphenated/ALL-CAPS/single-token names;
companies only in prose; phones without `+`/US shape; bare domains.

**LLM boundary (mandatory anonymize on the analysis route):**

```149:171:src/pages/api/analysis/index.ts
        const { anonymizedText, piiMap } = anonymizeCV(capturedCvText);
        ...
        const userPrompt = buildAnalysisPrompt(anonymizedText, profile);

        const { data: llmResult } = await completeLLM({
          model: llmModel,
          schema: AnalysisResponseSchema,
          prompt: userPrompt,
          systemPrompt: QA_ANALYSIS_SYSTEM_PROMPT,
        });
```

The prompt embeds **only** `anonymizedText` (`src/lib/analysis/prompt.ts:49-50`), which
flows to `generateText` (`src/lib/llm/client.ts:90-96`). `anonymizedText` is **not**
persisted; raw `cv_text` and `pii_map` are server-side only. The org boundary is
`anonymizeCV() → buildAnalysisPrompt() → completeLLM() → OpenRouter/LM Studio`.

**Bypass / second boundary:** `/api/llm/health` sends un-anonymized `SYNTHETIC_CV_TEXT`
(with real-looking company names, `src/lib/llm/test-data.ts:7-19`) directly to the
provider with **no** `anonymizeCV()` call (`src/pages/api/llm/health.ts:23-28`).

**Export/report boundary:** **No file export exists** (`src/` has no download/PDF/report
route; roadmap S-04 `report-export` is `proposed`; PRD FR-009 requires anonymized-only
exports once built). Current "report" surfaces:
- GET `/api/analysis/[id]` returns `match_summary` + questions + `file_name` only — no
  `cv_text`/`pii_map`/`raw_response` (`src/pages/api/analysis/[id]/index.ts:21-60`).
- `AnalysisResults` renders LLM-derived text → **can echo missed PII**.
- Dashboard shows recruiter-entered `first_name`/`last_name` — intentional internal UI,
  not sent to the model (`src/pages/dashboard/index.astro:21-22,96-98`).
- `raw_response` is written (`index.ts:192`) but never read by any query.

**Risk #3 verdict:** raw PII reaching the provider on the main path requires an
anonymizer miss (the documented MVP gaps make this plausible). Independent leak surfaces:
the `/api/llm/health` bypass, and PII echo from the LLM into the rendered result.

### Existing test coverage & harness conventions

**Vitest** (`vitest.config.ts`): two projects — `node` (`tests/lib/**/*.test.ts`,
env `node`) and `components` (`tests/components/**`, env `jsdom`, setup
`tests/setup/dom.ts`); `globals: true`; `passWithNoTests: true`; alias `@` → `./src`
(lines 5–29). `tsconfig.json:9-10` mirrors the alias. Scripts: `test` = `vitest run`,
`test:watch` = `vitest` (`package.json`).

**cv-parser tests (mocked backends, no binaries):**
- `tests/lib/cv-parser/index.test.ts` — `vi.mock` of pdf/docx; covers MIME dispatch,
  `UNSUPPORTED_FORMAT`, `EMPTY_CONTENT` (empty + whitespace, via mock-returned strings),
  `PARSE_FAILED`, re-throw. Synthetic `File` blobs (lines 16–18).
- `tests/lib/cv-parser/docx.test.ts` — real `extractDocxText` on a **programmatic** ZIP
  (`fflate zipSync` + inline XML); valid payload + missing `word/document.xml`.
- **No `pdf.test.ts`** → `unpdf` is never exercised. **No `.pdf`/`.docx` binaries anywhere.**

**anonymizer tests (isolation only):**
- `tests/lib/anonymizer/patterns.test.ts` (the unit reference, test-plan §6.1) —
  `findEmails` / `findPhones` / `findUrls` with positives + negatives.
- `tests/lib/anonymizer/index.test.ts` — `anonymizeCV` on inline `CV_WITH_PII` +
  `SYNTHETIC_CV_TEXT`; happy-path placeholders, counts, empty/whitespace.
- **No `section-rules.test.ts`** (name/company heuristics untested in isolation).
- `tests/lib/analysis/prompt.test.ts:75-79` checks a pre-anonymized constant, **not**
  the `anonymizeCV → buildAnalysisPrompt` chain.

**Fixtures:** only `tests/fixtures/analysis/*.json` triples
(`anonymizedText, profile, response`), loaded via `readFileSync` + `import.meta.url`
(pattern in `tests/lib/analysis/faithfulness.test.ts:8-25`). **No `tests/fixtures/cv/`.**

**Gaps mapped to risks:**
- Risk #5: no real `unpdf`/`fflate` run; no empty/scanned/corrupt/odd binary corpus;
  no test for non-empty-garbage; no API-route test asserting `CVParseError` → 400.
- Risk #3: no boundary test (string into `buildAnalysisPrompt`/`completeLLM` is
  PII-free); `section-rules` heuristics untested; no messy real-CV corpus; overlap/dedup
  (`index.ts:10-22`) untested.

## Code References

- `src/lib/cv-parser/index.ts:13-34` — MIME dispatch + only "no usable text" gate (`EMPTY_CONTENT`)
- `src/lib/cv-parser/pdf.ts:3-6` — `unpdf` extraction, no guard
- `src/lib/cv-parser/docx.ts:31-47` — `fflate` + hand-rolled XML parser
- `src/lib/cv-parser/errors.ts:1-11` — `CVParseError` codes
- `src/lib/anonymizer/index.ts:41-131` — `anonymizeCV` orchestration, placeholders, piiMap
- `src/lib/anonymizer/patterns.ts:20-55` — email/phone/url regexes (+ unused `findDates`)
- `src/lib/anonymizer/section-rules.ts:10-72` — name (header-only) + company (pipe-table) heuristics
- `src/lib/analysis/prompt.ts:32-50` — prompt embeds `anonymizedText` only
- `src/lib/llm/client.ts:90-96` — `generateText` call (the org boundary)
- `src/pages/api/analysis/index.ts:65-74,82-100,139-200` — parse, persist, background anonymize→prompt→LLM
- `src/pages/api/llm/health.ts:23-28` — **un-anonymized** synthetic CV to provider (bypass)
- `src/pages/api/analysis/[id]/index.ts:21-60` — result GET (no raw PII fields)
- `vitest.config.ts:5-29` — two-project config, alias, setup
- `tests/lib/cv-parser/index.test.ts`, `tests/lib/cv-parser/docx.test.ts` — current parser coverage
- `tests/lib/anonymizer/index.test.ts`, `tests/lib/anonymizer/patterns.test.ts` — current anonymizer coverage
- `tests/lib/analysis/faithfulness.test.ts:8-25` — fixture-loading pattern to mirror

## Architecture Insights

- **Fail-loud vs fail-silent split.** Parse/empty/corrupt/wrong-type fail loud
  (`CVParseError` → 400). The dangerous class is *fail-silent*: non-empty garbage and
  PII echo, which pass all current guards and surface as confident-but-wrong output.
- **Single mandatory anonymize seam.** The analysis route has exactly one
  `anonymizeCV → buildAnalysisPrompt → completeLLM` path; there is no branch that skips
  it. This makes a boundary integration test cheap and decisive (assert the captured
  prompt/`generateText` argument has no raw PII).
- **`vi.mock("ai")` at the network edge** is the established LLM-mocking convention
  (`tests/lib/llm/client.test.ts`); test-plan §6.2 forbids mocking internal modules for
  integration.
- **Accepted MVP anonymizer gaps are product decisions, not bugs.** Phase 2 should
  *characterize* them with falsifiable fixtures (and assert the boundary), not silently
  rewrite the anonymizer/parser. A genuine fail-fast quality gate for non-empty garbage
  (Risk #5) currently **does not exist** — whether to add one is a planning/product call.

## Historical Context (from prior changes)

- `context/changes/first-gated-generation/research.md` — `pdf-parse`/`mammoth` don't run
  on workerd; chose `unpdf` (and `office-oxide-wasm` for DOCX, later shipped as `fflate`);
  `cv_text` stores **raw** extracted text, original file not persisted; org boundary =
  Workers/Supabase inside, OpenRouter outside; hybrid regex + section-rule anonymization;
  documented "won't catch" list (body-only companies, first-name-only refs).
- `context/changes/first-gated-generation/plan.md` / `plan-brief.md` — `CVParseError`
  code contract; `EMPTY_CONTENT` on empty extract; failed-status + retry UX; only
  `anonymizedText` crosses the boundary; placeholder conventions.
- `context/archive/2026-05-30-candidate-name-on-card/plan.md` + `research.md` — PII
  boundary is `anonymizeCV() → buildAnalysisPrompt()`; name redaction is **header-only**,
  body repeats unredacted = accepted MVP trade-off.
- `context/changes/testing-output-grounding-response-integrity/` (Phase 1) — artifact
  pattern to mirror: research→plan→plan-brief, deterministic checks (not LLM-as-judge),
  fixtures under `tests/fixtures/analysis/`, `vi.mock("ai")` edge, explicit "What we're
  NOT doing", no production-logic changes. Phase 1 explicitly **deferred the binary
  CV corpus to Phase 2** (test-plan §4).
- `context/foundation/prd.md` — Guardrail "PII safety" + NFR Privacy/GDPR list
  (names, emails, phones, company names, **addresses**); FR-001 parsing fragility +
  paste fallback; FR-006 real stage transitions; FR-009 anonymized-only exports.

## Related Research

- `context/changes/testing-output-grounding-response-integrity/research.md` — Phase 1
  (Risks #1/#2), same pipeline map and test conventions.

## Open Questions

1. **Define "no usable text" (Risk #5).** Is there an agreed minimum signal (char/word
   count, ratio of alphanumerics) that distinguishes a real CV from non-empty garbage?
   Should the pipeline add a fail-fast gate before `completeLLM`, or is that out of scope
   for a *test* phase (test-only characterization + documenting the gap)? This is a
   product/planning decision the plan must settle.
2. **Real `unpdf` on workerd in tests.** Can `unpdf`/`fflate` run inside the Vitest
   `node` project against real binary fixtures, or is a thin abstraction / `wrangler dev`
   needed for production-fidelity PDF behavior? (workerd ≠ Node, AGENTS.md.)
3. **Binary corpus sourcing.** Which real-world cases to include (clean PDF, scanned/
   image-only PDF, multi-column/table PDF, valid DOCX, empty-body DOCX, corrupt zip,
   wrong-MIME) and where they live (`tests/fixtures/cv/`)? Any privacy constraint on
   using real CVs as fixtures (likely must be synthetic/sanitized).
4. **`/api/llm/health` bypass.** Should Phase 2 assert/flag that this endpoint sends
   un-anonymized text to the provider, mock the provider off in CI, or treat it as
   out-of-scope (synthetic data, no real PII)?
5. **PII-echo from LLM output.** Should a boundary/integration test deliberately weaken
   anonymization and assert the rendered result (`match_summary`/questions) contains no
   raw PII — or is echo strictly downstream of anonymizer quality and thus covered by
   the boundary assert alone?
6. **Paste & retry paths.** These bypass the parser; should Risk #5 coverage include the
   paste path (`cv_text` form field) and retry-from-DB path, or scope to file parsing only?
