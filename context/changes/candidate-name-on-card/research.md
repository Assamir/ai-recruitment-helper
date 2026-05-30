---
date: 2026-05-30T12:58:00+02:00
researcher: dczaj
git_commit: 24934b98d60e09a2f12079c4e6df3bc8c1ec4add
branch: main
repository: ai-recruitment-helper
topic: "Show candidate first and last name on the analysis card (S-05)"
tags: [research, codebase, candidate-name, dashboard, anonymization, pii, supabase]
status: complete
last_updated: 2026-05-30
last_updated_by: dczaj
---

# Research: Show candidate first and last name on the analysis card (S-05)

**Date**: 2026-05-30T12:58:00+02:00
**Researcher**: dczaj
**Git Commit**: 24934b98d60e09a2f12079c4e6df3bc8c1ec4add
**Branch**: main
**Repository**: ai-recruitment-helper

## Research Question

For roadmap slice S-05 (`candidate-name-on-card`), determine what it takes to display the candidate's first and last name on the analysis card in the dashboard list. Specifically: is the name captured/persisted today, where is the card rendered, and how do we surface raw-name PII on the recruiter dashboard without leaking it into the LLM pipeline or future exports.

## Summary

The roadmap prerequisite — "**F-01 (candidate name persisted in the schema)**" — is **not actually satisfied**. There are no `first_name` / `last_name` (or any candidate-name) columns in the schema. The only place a name exists is the anonymizer's `candidates.pii_map` JSONB, under the key `"[CANDIDATE_NAME]"`, storing a **single full-name string** (e.g. `"Jane Smith"`), captured heuristically from the CV header. That value is:

- written **after** upload during the `anonymizing` stage (so it's `null` for analyses still in `parsing`),
- written via an `UPDATE` on `candidates` that has **no RLS UPDATE policy** — so the write may fail silently under RLS in production,
- **not selected** by either the dashboard list query or the detail GET API,
- **not split** into first/last.

The dashboard "card" is **inline Astro markup** in `src/pages/dashboard/index.astro` (not a reusable React component); its primary label today is the **CV filename** (`candidates.file_name`), falling back to `"Pasted CV"`. The precise UI insertion point is line 108, after extending the Supabase select on line 20.

There is **no export feature yet** (S-04 is `proposed`). The LLM boundary is correctly placed at `anonymizeCV()` → `buildAnalysisPrompt()`: only `anonymizedText` ever leaves the org boundary.

**Net gap to close for S-05:** persist a first/last name on `candidates` (dedicated columns recommended over relying on `pii_map`), populate it at ingest from the existing `findCandidateName()` heuristic (split into first/last), add an RLS UPDATE policy (or write the name on the initial INSERT), then select + render it on the dashboard card — while keeping the name out of the LLM prompt and any future export builder.

## Detailed Findings

### Data layer — name is not a first-class field

- `candidates` table has `file_name`, `cv_text`, `linkedin_text`, `pii_map` — **no name columns** (`supabase/migrations/20260527185003_data_schema_and_rls.sql:26-33`; `pii_map` added in `supabase/migrations/20260529210000_s01_schema_extensions.sql:7-8`).
- Generated types confirm the same — no `first_name`/`last_name`/`candidate_name`/`full_name` (`src/db/database.types.ts:118-145`). Repo-wide grep for those identifiers returns zero matches.
- `job_profiles.name` is the **job profile title**, not a candidate (`supabase/migrations/20260527185003_data_schema_and_rls.sql:16-24`).
- Analysis creation writes only `user_id, cv_text, file_name` to `candidates` and no name to `analyses` (`src/pages/api/analysis/index.ts:80-84`, `93-100`).
- LLM structured output is `match_summary` + `questions` only — no candidate name (`src/lib/analysis/schema.ts:16-19`; prompt in `src/lib/analysis/prompt.ts:43-50` sends the **anonymized** CV).

### Where the name actually is — `pii_map["[CANDIDATE_NAME]"]`

- Captured by a header heuristic: first 10 non-blank lines, a line of 2–4 Title Case words, single match, **not split** (`src/lib/anonymizer/section-rules.ts:6-39`).
- Stored as placeholder → original value in the pii map (`src/lib/anonymizer/index.ts:99-109`).
- Persisted via `UPDATE candidates.pii_map` in the background pipeline, error not checked (`src/pages/api/analysis/index.ts:129-134`).
- Confirmed by tests: `piiMap["[CANDIDATE_NAME]"] === "Jane Smith"` (`tests/lib/anonymizer/index.test.ts:44-48`).

### Dashboard card — inline Astro, keyed by filename

- The list query selects `id, status, created_at, candidates(file_name), job_profiles(name, seniority_level)` — **no `pii_map`, no name** (`src/pages/dashboard/index.astro:20`; row type at `:8-15`).
- Cards are inline `<a>` elements, not a component (`src/pages/dashboard/index.astro:103-115`). Primary label = `file_name` or `"Pasted CV"` (`:93`, `:108`); subtitle = profile + seniority (`:109`); right column = status + date (`:112-113`).
- Detail view delegates to React `AnalysisView` → `AnalysisResults`, whose header also shows `fileName ?? "Pasted CV"` (`src/components/analysis/AnalysisResults.tsx:55-60`; props plumbed in `src/components/analysis/AnalysisView.tsx:24-25`, `94-100`).
- Detail GET API returns `candidate: { id, file_name }` only (`src/pages/api/analysis/[id]/index.ts:36-37`, `57`).

### PII / anonymization boundary

- Boundary sits at `anonymizeCV(capturedCvText)` → `buildAnalysisPrompt(anonymizedText, ...)` (`src/pages/api/analysis/index.ts:132-147`); the prompt is explicitly labeled `CV (anonymized):` (`src/lib/analysis/prompt.ts:49-50`).
- `anonymizedText` is **never persisted** — it lives only in the background `waitUntil` closure. Raw `cv_text` and `pii_map` are persisted but **never exposed** via any GET API.
- Name redaction is **header-only**: `findCandidateName` returns at most one match and there is no global replace (contrast with companies, which use `findAllOccurrences` at `src/lib/anonymizer/index.ts:68-70`). A name repeated in the CV body would not be redacted — an accepted MVP trade-off (`context/changes/first-gated-generation/research.md:120-125`).
- No export feature exists yet; S-01 plan lists "No PDF/Markdown export" as a non-goal (`context/changes/first-gated-generation/plan.md:58`). PRD FR-009 requires exports to contain anonymized content + confidentiality header (`context/foundation/prd.md:77-78`, `83-84`).
- The LLM health endpoint sends a synthetic raw CV directly (auth-gated, test-only) (`src/pages/api/llm/health.ts:28`).

## Code References

- `supabase/migrations/20260527185003_data_schema_and_rls.sql:26-33` — `candidates` table (no name columns)
- `supabase/migrations/20260527185003_data_schema_and_rls.sql:136-144` — `candidates` RLS: SELECT + INSERT only, **no UPDATE policy**
- `supabase/migrations/20260529210000_s01_schema_extensions.sql:7-11` — adds `candidates.pii_map`, `analyses.raw_response`
- `src/db/database.types.ts:118-145` — `candidates` Row/Insert/Update types
- `src/lib/anonymizer/section-rules.ts:6-39` — `findCandidateName()` header heuristic (single, unsplit match)
- `src/lib/anonymizer/index.ts:99-109` — placeholder mapping incl. `[CANDIDATE_NAME]`
- `src/pages/api/analysis/index.ts:80-84` — candidate INSERT (no name)
- `src/pages/api/analysis/index.ts:129-134` — `pii_map` UPDATE during `anonymizing`
- `src/pages/api/analysis/index.ts:132-147` — anonymize → prompt boundary
- `src/pages/api/analysis/[id]/index.ts:36-37,57` — detail GET returns `id, file_name` only
- `src/pages/dashboard/index.astro:8-15,20` — list row type + Supabase select
- `src/pages/dashboard/index.astro:87-115` — card derivation + inline markup (insertion point: line 108)
- `src/components/analysis/AnalysisResults.tsx:55-60` — detail header label
- `src/components/analysis/AnalysisView.tsx:24-25,94-100` — candidate props plumbing
- `tests/lib/anonymizer/index.test.ts:44-48` — name extraction test

## Architecture Insights

- **Two-layer storage by design:** raw PII (`cv_text`, `pii_map`) is server-internal; only LLM-derived, anonymized-input artifacts (`match_summary`, `analysis_questions`) are returned to the client. S-05 must respect this — a raw name is the first piece of raw PII intentionally surfaced to the UI, so it needs its own column and a query that is used **only on recruiter dashboard pages**, never joined into the prompt or a future export builder.
- **The card is not componentized.** Showing the name is a small edit to inline Astro, but if S-06 (removal) and future per-card actions land, extracting an `AnalysisCard` component may be worth doing alongside S-05.
- **Timing matters:** `pii_map` is populated during the `anonymizing` stage, so any name read from it is `null` for `pending`/`parsing` rows. Persisting the name on the initial candidate INSERT (extracting from raw `cvText` synchronously) avoids both the timing hole and the missing-RLS-UPDATE problem.
- **RLS gap:** the `pii_map` UPDATE relies on a policy that doesn't exist. Whichever approach S-05 takes, either add a `candidates` UPDATE policy or write the name at INSERT time.

## Historical Context (from prior changes)

- `context/changes/first-gated-generation/research.md:120-125` — accepts header-only name redaction as an MVP trade-off.
- `context/changes/first-gated-generation/plan.md:58,60,62` — export and `pii_map` rehydration explicitly deferred; original file discarded after parse.
- `context/changes/data-schema-and-rls/plan.md:135-145` — `candidates` intentionally SELECT + INSERT only (no UPDATE), which is why the later `pii_map` write is on shaky ground.

## Related Research

- `context/changes/first-gated-generation/research.md` — the S-01 pipeline this slice builds on.

## Open Questions

1. **Source of the name to display:** reuse the header heuristic (`findCandidateName`) at ingest vs. add an explicit recruiter-entered name field on the upload form (`AnalysisForm.tsx` has no such field today). The heuristic is zero-friction but unreliable for mononyms / 3+ word names / non-Latin scripts.
2. **First/last split rule:** `pii_map` holds one string. Define the split (first token = first name, remainder = last name?) and the fallback when only one token or none is found.
3. **Persistence approach:** dedicated `first_name`/`last_name` columns (matches the roadmap's "persisted in the schema" wording, and keeps the displayed name independent of the sensitive `pii_map`) vs. exposing `pii_map["[CANDIDATE_NAME]"]` (no migration, but ships a raw-PII blob to the client and depends on a possibly-failing UPDATE).
4. **RLS:** add a `candidates` UPDATE policy, or capture the name on the initial INSERT to avoid needing one.
5. **Card fallback:** when no name is available, keep showing `file_name` / `"Pasted CV"`, or show an explicit "Unknown candidate"?
