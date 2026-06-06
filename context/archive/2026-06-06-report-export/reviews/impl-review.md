<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Report Export (S-04)

- **Plan**: context/changes/report-export/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING ⚠️ |
| Scope Discipline | PASS ✅ |
| Safety & Quality | WARNING ⚠️ |
| Architecture | PASS ✅ |
| Pattern Consistency | WARNING ⚠️ |
| Success Criteria | PASS ✅ |

## Success Criteria Verification

### Automated (all PASS)

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS |
| `npm run test` | PASS — 31 files, 225 tests |
| `npx astro sync && npm run build` | PASS |

### Manual (all marked [x] with commit SHAs)

All 10 manual Progress rows are `[x]` with SHAs. Evidence in repo: `scripts/run-report-export-manual-checks.mjs`, `scripts/run-report-export-ui-checks.mjs`, and `context/changes/report-export/manual-verify/` sample exports from live Supabase run.

## Findings

### F1 — PDF export skips client-side error handling

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/analysis/ExportReportButton.tsx:18-20
- **Detail**: Plan Phase 3 requires "Show transient error text on non-OK responses" for both actions. Markdown uses `fetch` + `{ error }` parsing; PDF calls `window.open` and returns immediately. On 401/409/404 the user gets a new tab with raw JSON and no inline error.
- **Fix**: Preflight with `fetch(url)` for PDF too — on success open `URL.createObjectURL(blob)` in a new tab; on failure set `error` like the Markdown branch.
  - Strength: Matches Markdown path and DeleteAnalysisButton error UX.
  - Tradeoff: Slightly more code; blob URL must be revoked after open.
  - Confidence: HIGH — same pattern already used for Markdown download in this file.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — Silent candidate-fetch failure weakens redaction seeds

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/analysis/[id]/export.ts:128-136
- **Detail**: `candidateResult.error` is never checked. On failure the handler substitutes empty `pii_map`/names and still returns 200. Export is the only consumer of redaction seeds at download time — a failed candidate read can ship under-redacted content.
- **Fix**: If `candidateResult.error`, return `jsonResponse({ error: "Failed to load candidate data", code: "DB_ERROR" }, 500)` and do not export.
  - Strength: Fail-closed on anonymization dependency; aligns with lessons.md spirit (don't silently proceed when a dependent read fails).
  - Tradeoff: Export unavailable when candidate row is missing even if analysis exists.
  - Confidence: HIGH — export cannot redact without candidate seeds.
  - Blind spot: Haven't verified how often candidate fetch fails in production.
- **Decision**: FIXED

### F3 — Case-sensitive seed replacement may miss name variants

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/export/redact.ts:19-21
- **Detail**: `replaceAll` via `split/join` is case-sensitive. LinkedIn-path LLM output may echo `"jane doe"` while seeds are `"Jane"`/`"Doe"`. Pattern layer does not catch names — only email/phone/url.
- **Fix**: Add case-insensitive global replacement for candidate name seeds (regex with escaped needles and `gi` flag, or generate case variants).
  - Strength: Closes a realistic LinkedIn-path leak class.
  - Tradeoff: Regex edge cases for names containing special characters; must escape metacharacters.
  - Confidence: MED — common names are safe; unusual names need careful escaping.
  - Blind spot: False positives if a seed substring matches a common English word.
- **Decision**: FIXED

### F4 — Export button not gated on `status === "completed"`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/analysis/AnalysisView.tsx:152-154
- **Detail**: Plan requires export actions "only in the completed state." Component renders whenever `results` is truthy without checking `results.analysis.status === "completed"`. Works today via control flow (in-progress shows `AnalysisProgress`), but is fragile if results load for non-completed statuses.
- **Fix**: Wrap `<ExportReportButton />` in `{results.analysis.status === "completed" && …}`.
- **Decision**: FIXED

### F5 — Residual LinkedIn-path PII beyond seeds and three patterns

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/export/redact.ts:24-44
- **Detail**: Redaction uses `pii_map` values, candidate names, and email/phone/url patterns only. Company names, schools, and other entities echoed by the LLM on the LinkedIn path can remain. Plan explicitly acknowledges this residual risk and mitigates via confidentiality header — implementation matches plan intent.
- **Fix A ⭐ Recommended**: Document as accepted residual risk in change notes / export header wording; do not claim "fully anonymized" externally.
  - Strength: Honest scope; matches plan's acknowledged tradeoff.
  - Tradeoff: Exports may still contain identifiable entities not in seeds.
  - Confidence: HIGH — plan line 46 states this explicitly.
  - Blind spot: Stakeholder expectations for "anonymized" may exceed implementation.
- **Fix B**: Extend pattern layer (e.g. reuse anonymizer company/date detectors).
  - Strength: Stronger scrubbing.
  - Tradeoff: More false positives; scope expansion beyond S-04.
  - Confidence: LOW — company detection is heuristic-heavy.
  - Blind spot: Performance impact on large reports untested.
- **Decision**: FIXED (Fix A — documented in change.md)

### F6 — Markdown test uses assertions, not snapshot

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/lib/export/markdown.test.ts
- **Detail**: Plan calls for a "Markdown snapshot test." Implementation uses frozen-timestamp assertion checks covering the same content (header, four categories, redaction). Functionally equivalent; style differs from plan wording.
- **Fix**: Either rename plan expectation to "assertion test" or add `toMatchInlineSnapshot()` — optional polish only.
- **Decision**: FIXED

### F7 — `formatRequirementsLabel` duplicated from UI

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/export/format.ts:14-34
- **Detail**: `formatRequirementsLabel` mirrors `AnalysisResults.tsx:46-66`. Reasonable for a dependency-free export lib, but label logic can drift if UI changes.
- **Fix**: Extract shared helper to `src/lib/analysis/format-requirements.ts` and import from both UI and export.
- **Decision**: FIXED

### F8 — No integration test for `format=pdf` success path

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/lib/api/analysis-isolation.test.ts
- **Detail**: Contract tests cover md success (200 + headers + body) but not pdf (200 + text/html + inline). Plan's explicit contract only mandated md; pdf verified manually.
- **Fix**: Add one test asserting `format=pdf` returns 200, `text/html`, body contains `window.print()`.
- **Decision**: FIXED
