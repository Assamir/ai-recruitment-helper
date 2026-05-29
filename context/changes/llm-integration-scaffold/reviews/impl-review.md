<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: LLM Integration Scaffold

- **Plan**: context/changes/llm-integration-scaffold/plan.md
- **Scope**: All 5 Phases
- **Date**: 2026-05-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — completeLLM uses generateText instead of generateObject

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/llm/client.ts:57-97
- **Detail**: Plan specified wrapping generateObject() for structured output. Implementation uses generateText() with two paths: (1) default path appends "Respond ONLY with valid JSON" to prompt and manually extracts JSON via regex-based extractJSON helper; (2) opt-in useStructuredOutput=true uses Output.object({schema}). The extractJSON helper (lines 44-55) and useStructuredOutput flag are entirely unplanned additions. Plan-brief mentioned this as an "open risk" fallback, but it was implemented as the default path.
- **Fix A ⭐ Recommended**: Accept deviation, update plan as addendum
  - Strength: The approach works and handles models that don't support native structured output. The plan-brief anticipated this risk.
  - Tradeoff: Plan becomes a slightly moving target; the regex JSON extraction is inherently fragile.
  - Confidence: HIGH — the viability test passed with real LLM calls.
  - Blind spot: Long-term maintenance cost of extractJSON vs using generateObject natively when models support it.
- **Fix B**: Refactor to use generateObject as default, keep text as fallback
  - Strength: Matches the plan exactly; generateObject validates schema at the SDK level (more robust).
  - Tradeoff: Requires testing whether generateObject works with Zod v4 on the AI SDK (the original concern).
  - Confidence: MEDIUM — need to verify Zod v4 compat with AI SDK.
  - Blind spot: May break the proven working path.
- **Decision**: FIXED (Fix A) — addendum added to plan.md documenting accepted deviation

### F2 — Null output not validated in structured output mode

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/llm/client.ts:81
- **Detail**: When useStructuredOutput=true, result.output from the AI SDK's Output.object() can be null if the model fails to produce valid structured output. The code casts directly: `data = result.output as z.infer<T>`. A null value would propagate to callers unchecked.
- **Fix**: Add null-check: `if (!result.output) throw new LLMParseError("Model did not return structured output")`.
- **Decision**: FIXED — null-check added at client.ts:81

### F3 — Fragile JSON error classification via includes("JSON")

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/llm/client.ts:133
- **Detail**: Error classification uses `error.message.includes("JSON")` to detect parse failures. Any error with "JSON" in its message (e.g. "Failed to connect to JSON API endpoint") will be misclassified as LLMParseError instead of LLMConnectionError, masking connectivity failures.
- **Fix**: Check for SyntaxError instance (what JSON.parse throws) instead of substring matching: `if (error instanceof SyntaxError) { throw new LLMParseError(...) }`.
- **Decision**: FIXED — replaced includes("JSON") with instanceof SyntaxError

### F4 — Missing completeLLM unit tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: tests/lib/llm/client.test.ts
- **Detail**: Plan explicitly specified: "client.test.ts — Provider factory + completeLLM error wrapping tests." The file only tests createLLMModel (4 tests). completeLLM — the core service function with timeout, error wrapping, and two output paths — has zero test coverage. Progress checkbox 4.1 is marked [x] but the planned scope was not fully delivered.
- **Fix A ⭐ Recommended**: Add completeLLM tests now
  - Strength: Addresses the coverage gap for the most complex function. Would also surface the null-output issue (F2) and fragile error detection (F3).
  - Tradeoff: Requires mocking generateText from the AI SDK; moderate effort (~30 min).
  - Confidence: HIGH — the plan specified these tests and the test infrastructure is already in place.
  - Blind spot: None significant.
- **Fix B**: Defer to S-01 implementation
  - Strength: completeLLM's interface may change when real analysis prompts are added in S-01.
  - Tradeoff: Core function remains untested through next slice.
  - Confidence: MEDIUM — depends on whether S-01 changes the API.
  - Blind spot: If S-01 builds on the current API without testing it, bugs compound.
- **Decision**: FIXED (Fix A) — 7 completeLLM tests added covering success, fenced JSON, schema mismatch, invalid JSON, timeout, connection error, and null structured output

### F5 — Synthetic CV is ~500 words vs ~2000 planned

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/llm/test-data.ts
- **Detail**: Plan specified "~2000 words fake QA CV" to represent realistic workload for timing viability. Implementation is ~550 words (~25% of target). The viability test's purpose is stress-testing the 60-second budget — an undersized input may produce artificially fast timing results that don't represent production workload.
- **Fix**: Expand SYNTHETIC_CV_TEXT to ~2000 words by adding detailed project descriptions, more positions, or technical narratives with deliberate anomalies.
- **Decision**: FIXED — CV expanded to ~2000 words with additional positions, project details, certifications, and professional development section

### F6 — Unchecked manual verification steps

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A (Progress section in plan.md)
- **Detail**: 6 manual verification items remain unchecked: 3.4 (LM Studio stopped → 502), 3.5 (No auth → 401 JSON), 3.6 (No LLM config → 503), 5.4 (wrangler dev --remote timing < 60s), 5.5 (Local dev returns 200 with LM Studio), 5.6 (Console logs visible via wrangler tail). Change status is "implemented" despite incomplete verification.
- **Fix**: Complete manual verification and update checkboxes, or set status to "implementing" until verified.
- **Decision**: PARTIALLY FIXED — verified 3.5 (401 JSON confirmed). Items 3.4, 3.6, 5.4-5.6 require authenticated session and/or running services (LM Studio, Cloudflare) — must be tested manually by developer.

### F7 — Default provider unreachable on Workers

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/llm/types.ts:20
- **Detail**: DEFAULT_PROVIDER = 'lmstudio' with LMSTUDIO_BASE_URL = 'http://localhost:1234/v1'. On Cloudflare Workers, localhost is unreachable. If LLM_PROVIDER is not set in production, the health endpoint will return a 502. AGENTS.md documents this, but there's no runtime guard or warning log.
- **Fix**: Add a console.warn in createLLMModel when lmstudio is selected, noting it's only functional in local dev.
- **Decision**: FIXED — console.warn added to lmstudio case in createLLMModel
