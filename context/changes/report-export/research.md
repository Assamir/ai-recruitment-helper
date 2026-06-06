---
date: 2026-06-06T20:45:00+02:00
researcher: dczaj
git_commit: aa38af5f468ecdc642a0f79ce15da37006b96d06
branch: main
repository: ai-recruitment-helper
topic: "S-04 report-export — export analysis report as PDF or Markdown (anonymized only)"
tags: [research, codebase, report-export, export, anonymization, cloudflare-workers, pdf, markdown]
status: complete
last_updated: 2026-06-06
last_updated_by: dczaj
---

# Research: S-04 report-export — export analysis report as PDF or Markdown

**Date**: 2026-06-06T20:45:00+02:00
**Researcher**: dczaj
**Git Commit**: aa38af5f468ecdc642a0f79ce15da37006b96d06
**Branch**: main
**Repository**: ai-recruitment-helper

## Research Question

How should we implement roadmap slice **S-04 (report-export)**: "user can export the analysis report as PDF or Markdown, with anonymized content only and a confidentiality header — the deliverable the recruiter hands to the hiring manager" (`context/foundation/roadmap.md:130-141`, PRD FR-009)? Requested focus: **API & rendering** — existing API route conventions and workerd-compatible PDF/Markdown generation.

## Summary

- **No export endpoint or UI exists yet.** This is greenfield within an established pattern set. The clean way in is a new authenticated route `GET /api/analysis/:id/export?format=md|pdf` (mirror `status.ts`) plus a small client `ExportReportButton` in the completed-results view (mirror `DeleteAnalysisButton`).
- **The report content is already assembled** by `GET /api/analysis/:id` (`src/pages/api/analysis/[id]/index.ts:7-76`): `match_summary` + categorized `questions` (question / rationale / suggested_answer) + job profile + recruiter context + metadata. That query deliberately excludes `cv_text`, `pii_map`, and `raw_response`.
- **Anonymization is NOT uniform.** The CV-only path anonymizes the CV before the LLM and stores a `pii_map`. The **LinkedIn cross-reference path sends raw CV + raw LinkedIn to the LLM**, so stored `match_summary`/`questions` for those analyses can contain raw candidate PII. An export that simply serializes the GET response would leak PII for LinkedIn analyses. **Export needs an explicit redaction/guard step**, not just a re-serialization.
- **Markdown export = pure string templating, zero deps** — the safe, ship-first fallback the roadmap calls for.
- **PDF on workerd**: native-Node PDF libs are risky (AGENTS.md warning). The repo already declares a **`BROWSER` Browser Rendering binding** (`wrangler.jsonc:19-21`) and ships `@cloudflare/playwright` — render HTML → `page.pdf()` is the lowest-risk PDF path, but **requires the Workers Paid plan**. Client-side "print to PDF" from printable HTML is the no-cost fallback.

## Detailed Findings

### Area 1 — Report data model & the PII boundary (what is safe to export)

**Result payload schema** — `src/lib/analysis/schema.ts:3-21`:
- `AnalysisResponse = { match_summary: string, questions: AnalysisQuestion[] }`
- `AnalysisQuestion = { category, question, rationale, suggested_answer | null }`
- `category ∈ { missing_elements, contradictions, vague_claims, anomalies }`

**Persisted tables** (`supabase/migrations/20260527185003_data_schema_and_rls.sql`, plus additive migrations):
- `analyses` — `match_summary`, `raw_response` (full LLM JSON, never exposed via GET), `custom_requirements`, `project_context`, `linkedin_scrape_note`, `status`, timestamps.
- `analysis_questions` — `category, question, rationale, suggested_answer, sort_order`.
- `candidates` — `cv_text`, `linkedin_text`, `first_name`, `last_name`, `file_name`, `pii_map` (jsonb, placeholder→raw map). `pii_map` added in `20260529210000_s01_schema_extensions.sql:7-11`; name columns in `20260530120000_candidate_name_columns.sql:3-5`.

**Anonymization** — `src/lib/anonymizer/index.ts:41-132`: detects PII (email/phone/url/name/company), replaces with placeholders (`[CANDIDATE_NAME]`, `[EMAIL]`, `[PHONE]`, `[URL]`, `[COMPANY_n]`), and builds `pii_map` (placeholder → raw value).

**The critical branch** — `src/pages/api/analysis/index.ts:320-337`:

| Path | CV sent to LLM | LinkedIn sent | `pii_map` written | Stored output PII risk |
|------|----------------|---------------|-------------------|------------------------|
| CV-only (no LinkedIn) | **Anonymized** | — | **Yes** | Low (placeholders; residual = anonymizer miss / LLM invention) |
| LinkedIn present | **Raw** | **Raw** | **No** | **High — output can echo raw names/companies** |

Prompt labeling confirms the branch: `src/lib/analysis/prompt.ts:114-120` ("CV:" raw vs "CV (anonymized):"). Boundary tests: `tests/lib/anonymizer/boundary.test.ts:40-63`. Placeholder pattern used by faithfulness tests: `tests/lib/analysis/faithfulness.ts:6`.

**Export-safe vs must-NOT-export classification:**

- **Safe (with LinkedIn-path caveat):** `match_summary`, `questions[].{category,question,rationale,suggested_answer}`, `profile.{name,description}`, `custom_requirements`, `project_context`, `linkedin_scrape_note`, `has_linkedin`/"LinkedIn cross-referenced" badge, `created_at`, plus a required confidentiality header (FR-009).
- **Must NOT export:** `candidates.cv_text`, `candidates.linkedin_text`, `candidates.pii_map`, `candidates.first_name/last_name`, `candidate.file_name` (shown in UI at `AnalysisResults.tsx:97` but frequently contains the candidate name — replace with a generic label in exports), `analyses.raw_response`.

### Area 2 — API route conventions (how to add the export endpoint)

Existing routes (8 handlers under `src/pages/api/**`): `analysis/index.ts` (POST), `analysis/[id]/index.ts` (GET, DELETE), `analysis/[id]/status.ts` (GET), `profiles.ts` (GET), `llm/health.ts` (POST), and three auth routes (redirect-based).

**Canonical authenticated-route guard order** (from `analysis/[id]/index.ts:7-36` and `status.ts:6-43`):
1. `context.locals.user` missing → `401 UNAUTHORIZED` (auth is populated by `src/middleware.ts:6-16`, not per-route `getUser()`; middleware only *redirects* page routes, never `/api/*`).
2. `context.params.id` missing → `400 BAD_REQUEST`; `!isUuid(id)` → `400 BAD_REQUEST` (`src/lib/api/uuid.ts`).
3. `createClient(context.request.headers, context.cookies)` null → `503 SERVICE_UNAVAILABLE` (`src/lib/supabase.ts:9-35`; returns null when env missing or a service-role key is detected).
4. Query scoped with `.eq("user_id", context.locals.user.id)`; miss → `404 NOT_FOUND`.

**Response conventions:**
- Success/error JSON via `jsonResponse(body, status)` — `src/lib/api/response.ts:1-6`. Error shape is always `{ error: string, code: string }`.
- **No non-JSON / download response exists anywhere in `src/`** — no `Content-Disposition`, `application/pdf`, or `text/markdown` precedent. The export route introduces this pattern: keep error paths on `jsonResponse`, return `new Response(body, { headers: { "Content-Type": ..., "Content-Disposition": "attachment; filename=..." } })` on success. Consider a small `fileResponse` helper in `src/lib/api/` for symmetry.
- Dynamic params read from `context.params` in API routes (`status.ts:11`), vs `Astro.params` in `.astro` pages (`dashboard/[id].astro:6`).
- Contract is test-enforced: `tests/lib/api/analysis-isolation.test.ts:206-257` (401/400/503/404 codes), helper `tests/helpers/api-context.ts:20-42`.

**Placement:** `src/pages/api/analysis/[id]/export.ts` → `GET /api/analysis/:id/export`. Reuse the same joins as `GET /api/analysis/:id` (`index.ts:38-52`) as the report data source. Likely reject non-`completed` analyses (`400`/`409` — no precedent; closest is `NOT_FOUND`).

### Area 3 — Rendering options (Markdown + PDF) on workerd

**Repo facts** (`package.json`, `wrangler.jsonc`, `astro.config.mjs`):
- **No Markdown or PDF-generation library installed.**
- Present and relevant: `unpdf` ^1.6.2 (PDF *reading* only, used at `src/lib/cv-parser/pdf.ts`), `@cloudflare/playwright` ^1.3.0, `fflate` ^0.8.3.
- `wrangler.jsonc:5` `compatibility_date` 2026-05-08; `:8-10` `nodejs_compat`; **`:19-21` `BROWSER` Browser Rendering binding already declared**; `:6-7` note: CV analysis pipeline and Browser Run **require the Workers Paid plan**.
- AGENTS.md warns native-Node libs (`pdf-parse`, `mammoth`) may fail at runtime on workerd.

**Recommendation (reliability-first, given top blocker = time):**
1. **Markdown — primary/ship-first:** hand-rolled `toMarkdown(report)` string template from the analysis object. Zero deps, zero workerd risk. This is the roadmap's safe fallback and should land first.
2. **PDF — primary:** render the report as styled HTML, then `BROWSER` binding + `@cloudflare/playwright` `page.pdf()`. Reuses infra the repo already declares; avoids unproven native-Node deps. **Needs Workers Paid plan.**
3. **PDF — fallback:** serve printable HTML for client-side "Print to PDF". `pdf-lib` is the only solid pure-server alternative; `@react-pdf/renderer` and `jspdf` are both risky on workerd.

### Area 4 — UI hook point

- Per-analysis page: `src/pages/dashboard/[id].astro:34` mounts `<AnalysisView analysisId={id} client:load />` (no `src/pages/analysis/[id].astro` exists).
- `AnalysisView.tsx:44-54` fetches `GET /api/analysis/:id`; renders `AnalysisResults` only when `status === completed` (`AnalysisView.tsx:151-163`). Export is only meaningful in this completed state.
- **Best hook:** add `<ExportReportButton analysisId={analysisId} />` in `AnalysisView`'s completed return, or in the `AnalysisResults` meta row next to the "Completed" badge (`AnalysisResults.tsx:114-123` — would require adding `analysisId` to `AnalysisResultsProps`).
- **Pattern to mirror:** `DeleteAnalysisButton.tsx:7-31` — `{ analysisId }` prop, `fetch`, loading/error state. For download, replace `reload()` with a blob → `<a download>` trigger (or `window.open` for GET).
- Optional secondary: a download action on dashboard list rows (`dashboard/index.astro:119-121`), gated on `status === "completed"`.

## Code References

- `src/lib/analysis/schema.ts:3-21` — `AnalysisResponse` / `AnalysisQuestion` Zod schemas (report content shape).
- `src/pages/api/analysis/[id]/index.ts:7-76` — canonical authenticated GET; the report-data query (`:38-52`) to reuse.
- `src/pages/api/analysis/[id]/status.ts:6-43` — closest structural template for a new `[id]/export.ts`.
- `src/pages/api/analysis/index.ts:320-337` — the anonymize-vs-raw branch (the PII boundary risk).
- `src/lib/anonymizer/index.ts:41-132` + `types.ts:1-11` — anonymization + `pii_map` construction.
- `src/lib/api/response.ts:1-6` — `jsonResponse` (error convention; no file/download helper yet).
- `src/lib/supabase.ts:9-35` — `createClient` null-handling.
- `src/middleware.ts:6-16` — auth source (`context.locals.user`).
- `src/lib/api/uuid.ts` — `isUuid` param validation.
- `wrangler.jsonc:5-21` — `compatibility_date`, `nodejs_compat`, `BROWSER` binding; Paid-plan note.
- `package.json:29,42,50` — `@cloudflare/playwright`, `fflate`, `unpdf`.
- `src/components/analysis/AnalysisView.tsx:44-54,151-163` — fetch + completed-state render (UI hook).
- `src/components/analysis/AnalysisResults.tsx:94-155` — report presentation (meta row, summary, questions).
- `src/components/analysis/DeleteAnalysisButton.tsx:7-31` — client action pattern to mirror.
- `src/pages/dashboard/[id].astro:6,34` — route param + island mount.
- `tests/lib/api/analysis-isolation.test.ts:206-257` — API auth/isolation contract to extend.
- `tests/lib/anonymizer/boundary.test.ts:40-63` — confirms LinkedIn path sends raw text.

## Architecture Insights

- **Authentication is centralized in middleware, but enforcement is per-route for `/api/*`.** Any new export route must inline the same 401/503/404 guards — there is no `requireAuth` wrapper.
- **Ownership isolation is RLS + explicit `.eq("user_id", ...)`.** Mirror it; isolation tests will gate the change.
- **The recruiter-visible GET response is not equivalent to "export-safe content"** because of the LinkedIn raw-text path. The PII boundary is enforced at *prompt-build time*, not at *output-storage time*, so stored output for LinkedIn analyses is the leak surface. Export must add its own redaction guard (e.g. scan against `pii_map` values when present, or a denylist using stored candidate name; consider blocking/labeling PDF/MD export for LinkedIn analyses if redaction can't be guaranteed). This is the single most important design decision for the slice.
- **PDF generation should lean on declared platform infra (`BROWSER` binding) rather than a new native-Node dependency**, consistent with the AGENTS.md workerd warning. Markdown is the dependency-free guaranteed path.
- **New convention to establish:** non-JSON download responses (`Content-Disposition`). Worth a tiny `fileResponse` helper to keep `src/lib/api/` symmetric.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — "Supabase writes need a matching RLS policy AND an error check." Export is read-only, so less exposed, but if export ever records an audit/export-timestamp write, this lesson applies directly.
- `context/changes/testing-input-integrity-parsing-anonymization/research.md:169-173` — prior note confirming no export route exists; report-export is the planned change.
- `context/archive/2026-05-30-analysis-removal/` — the `DeleteAnalysisButton` + `[id]` API pattern this slice should mirror for both the client action and the route.

## Related Research

- `context/changes/testing-input-integrity-parsing-anonymization/research.md` — anonymization/parsing boundary (PII handling context).
- `context/changes/linkedin-cross-reference/research.md` — the LinkedIn path that creates the raw-output export risk.

## Open Questions

1. **PDF delivery decision (cost vs scope):** Adopt the `BROWSER` binding `page.pdf()` path (requires Workers Paid plan) for true server-side PDF, or ship Markdown + printable-HTML "Print to PDF" only and defer real PDF? Roadmap explicitly allows Markdown-only as the safe path (`roadmap.md:139-140`).
2. **LinkedIn-analysis redaction strategy:** For analyses created via the LinkedIn path (`pii_map` absent, output may contain raw PII), how do we guarantee anonymized-only export? Options: (a) run an export-time anonymizer pass over `match_summary`+questions, (b) reconstruct/store a `pii_map` for the LinkedIn path too, (c) block PDF/MD export for LinkedIn analyses, or (d) accept residual risk with a confidentiality header. Needs a decision in `/10x-plan`.
3. **Confidentiality header content (FR-009):** exact wording/placement and whether it includes export timestamp, "anonymized", and a no-redistribution notice.
4. **Filename scheme:** `file_name` is PII-risky; what neutral, non-identifying filename do exports use (e.g. `analysis-<id>.md`)?
5. **Format selection UX:** single button with format menu vs two buttons; `?format=md|pdf` query param vs separate routes.
