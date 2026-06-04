# Input Integrity — Parsing + Anonymization (Test Rollout Phase 2) — Plan Brief

> Full plan: `context/changes/testing-input-integrity-parsing-anonymization/plan.md`
> Research: `context/changes/testing-input-integrity-parsing-anonymization/research.md`

## What & Why

Phase 2 of the test rollout protects the two input-side risks on the analysis pipeline:
**garbage CV text must be rejected, not analyzed** (Risk #5), and **no raw PII may cross the
org boundary into the LLM call** (Risk #3). Today non-empty garbage passes silently into
`completeLLM`, and nothing asserts the string handed to the prompt is PII-free.

## Starting Point

The pipeline (`upload → parse → store raw → anonymize → buildAnalysisPrompt → completeLLM →
render`) has one parser quality gate (`text.trim().length === 0 → EMPTY_CONTENT`) that
catches empty/scanned/corrupt files loudly, but lets non-empty garbage through. Anonymization
is mandatory on the analysis route (prompt embeds only `anonymizedText`), but its regex +
section heuristics have documented, accepted MVP gaps and no boundary assertion guards them.
Vitest two-project infra and a CI test gate already exist from test-rollout Phase 1.

## Desired End State

Non-empty garbage (via file, paste, or retry) is rejected with a clean 400 before any LLM
call; a short-but-real CV still analyzes. A deterministic test proves that across a synthetic
messy-CV corpus, the prompt built from anonymized text contains no catchable raw PII, while
the anonymizer's accepted gaps are characterized as documented pass-throughs rather than
silently rewritten.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Risk #5 mitigation | Add a minimal fail-fast quality gate + test it | Change goal is "garbage rejected, not analyzed"; text quality is cheaply detectable, unlike grounding | Plan |
| Gate placement | Single chokepoint on resolved `cvText` | Covers file + paste + retry (all bypass-prone) in one call | Plan |
| Parser test fidelity | Mock the extractor edge; no real binaries | Avoids workerd≠Node `unpdf` fidelity questions; cost×signal | Plan |
| Fixture corpus form | Extractor-output text fixtures (`tests/fixtures/cv/`) | Consistent with mocking the edge; deterministic, no binary assets | Plan |
| Risk #3 guard | Boundary PII-free assert at `anonymizeCV → buildAnalysisPrompt` | Pure lib seam — decisive and cheap; no route/Supabase/LLM | Plan |
| PII echo | Boundary assert alone | Echo ⊆ anonymizer misses (LLM only sees `anonymizedText`) | Plan |
| Anonymizer gaps | Characterize, don't rewrite | Accepted MVP trade-offs are product decisions | Research / Plan |
| `/api/llm/health` bypass | Out of scope | Synthetic, auth-gated data — no real PII | Plan |

## Scope

**In scope:** Risk #5 quality gate + parser characterization tests; Risk #3 boundary
PII-free assert + anonymizer section-rule characterization; synthetic CV fixture corpus;
test-plan cookbook/status updates.

**Out of scope:** Real `unpdf`/`fflate` binary runs; `/api/llm/health`; a separate PII-echo
test; full analysis-route integration (Phase 4); export/report (S-04); anonymizer/parser
detection rewrites; CI changes (gate already wired).

## Architecture / Approach

One small production change — a conservative, deterministic quality heuristic
(`src/lib/cv-parser/quality.ts`) plus a new `INSUFFICIENT_CONTENT` `CVParseError` code, wired
once at the resolved-`cvText` convergence point in the analysis route (`~index.ts:80`) so all
three input paths are gated → 400. Everything else is additive tests in the node Vitest
project: parser/quality units with a mocked extractor edge, anonymizer section-rule
characterization, and the decisive Risk #3 boundary assert that feeds synthetic messy CVs
through `anonymizeCV → buildAnalysisPrompt` and checks the prompt for raw PII.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Risk #5 gate + parser chars | Garbage rejected at the chokepoint; parser contract tested | Over-aggressive threshold rejecting real CVs |
| 2. Risk #3 boundary + anon chars | No catchable PII in the prompt; accepted gaps documented | Corpus mis-split (asserting clean on an accepted-miss class) |
| 3. Docs + gate verification | Test-plan cookbook/status; CI gates new tests | Stale/incomplete cookbook for future contributors |

**Prerequisites:** Vitest two-project infra + CI test gate (test-rollout Phase 1, done).
**Estimated effort:** ~2–3 sessions across 3 phases; mostly test authoring + one small route wiring.

## Open Risks & Assumptions

- The quality heuristic threshold is judgment-based; the terse-real + garbage anchor
  fixtures keep it falsifiable, but real-world tuning may need a follow-up.
- Mocking the extractor edge means real `unpdf` PDF-extraction quirks remain uncovered
  (deliberate; revisit if a production parsing bug surfaces).
- The boundary assert proves catchable-PII removal; accepted-miss classes (body-only
  company, single-token name, addresses, dates) remain real residual leak surfaces by design.

## Success Criteria (Summary)

- Non-empty garbage is rejected with a clean 400 across file/paste/retry; a real CV still analyzes.
- No catchable raw PII survives `anonymizeCV → buildAnalysisPrompt` across the synthetic corpus.
- The anonymizer's accepted gaps are characterized (visible, measurable) without being silently rewritten.
