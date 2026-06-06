# Report Export (S-04) — Plan Brief

> Full plan: `context/changes/report-export/plan.md`
> Research: `context/changes/report-export/research.md`

## What & Why

Let a recruiter export a completed analysis as **Markdown** or **PDF** containing **anonymized content only** plus a **confidentiality header** (FR-009) — the deliverable handed to the hiring manager. No export path exists today, and a naïve "serialize the GET response" would leak raw candidate PII for LinkedIn-cross-referenced analyses.

## Starting Point

`GET /api/analysis/:id` already assembles the full report (summary, categorized questions, profile, requirements, dates). CV-only analyses store a `pii_map` and their stored output is already placeholder-anonymized; **LinkedIn-path analyses send raw text to the LLM, write no `pii_map`, and can store raw PII in the output** — the core risk this slice must contain.

## Desired End State

On a completed analysis page, "Export Markdown" downloads a `.md` file and "Export PDF" opens a print-optimized HTML page that auto-triggers save-as-PDF. Both start with a confidentiality header and contain only redacted content, verified even for LinkedIn-path analyses. The route is authenticated, ownership-scoped, and rejects non-completed analyses.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| LinkedIn-path redaction | Export-time anonymizer pass, seeded with `pii_map` values + stored candidate name, then email/phone/url pattern scrub | Uniform coverage of both paths, deterministic where seeds exist, no schema change | Plan |
| PDF delivery | Markdown + printable HTML "Print to PDF" | No Workers Paid-plan dependency, zero workerd risk, both formats usable now | Plan |
| Confidentiality header | Confidential + anonymized notice + no-redistribution + export timestamp | Full FR-009 coverage and provenance | Plan |
| Filename | `analysis-<id>-<YYYY-MM-DD>.md` | Neutral, no PII, sortable, collision-free | Plan |
| Format selection / route | Two actions on one route `?format=md\|pdf` | Mirrors research recommendation, simple to test | Research/Plan |
| Test scope | Auth/isolation contract + redaction unit tests + Markdown snapshot | Locks the two highest-risk areas (PII + contract) | Plan |

## Scope

**In scope:** export library (redaction + Markdown + printable HTML), authenticated `export.ts` route, `fileResponse` helper, `ExportReportButton` on the completed view, redaction + contract tests.

**Out of scope:** true server-side PDF (`BROWSER` `page.pdf()`, Paid plan), new PDF/MD npm deps, schema/migration changes, pipeline changes, dashboard-list export, export audit writes.

## Architecture / Approach

Pure `src/lib/export/` library (`redact.ts`, `markdown.ts`, `html.ts`, `types.ts`) → one authenticated route `GET /api/analysis/:id/export?format=md|pdf` (mirrors `status.ts` guards, reuses `index.ts` joins + candidate `pii_map`/name as redaction seeds) → `ExportReportButton` mounted in `AnalysisView`'s completed state. `md` returns an attachment download; `pdf` returns inline printable HTML that calls `window.print()`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Rendering & redaction core | Pure library + unit/snapshot tests | Redaction completeness on LinkedIn output (residual miss → mitigated by header) |
| 2. Export API route | Authenticated download/printable route + contract tests | Getting guard order + new download-response convention right |
| 3. Export UI | Two export actions on the completed view | Download/print trigger behavior across browsers |

**Prerequisites:** S-01 complete (analysis results exist) — done. No new dependencies or migrations.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Pattern + seed redaction can still miss a company/name not present in the seeds for LinkedIn-path output; the confidentiality header is the explicit mitigation (residual risk accepted).
- "Print to PDF" UX depends on the browser print dialog rather than a guaranteed server file.

## Success Criteria (Summary)

- Recruiter can export a completed analysis as Markdown and PDF, each with a confidentiality header.
- No raw candidate PII appears in either format, including LinkedIn-path analyses (test-verified).
- Route enforces auth, ownership, completed-state, and valid `format`.
