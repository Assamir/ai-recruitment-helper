# First Gated Generation (S-01) — Plan Brief

> Full plan: `context/changes/first-gated-generation/plan.md`
> Research: `context/changes/first-gated-generation/research.md`

## What & Why

Build the north-star end-to-end pipeline: upload a QA candidate's CV, select a job profile, and receive categorized interview questions (missing elements, contradictions, vague claims, anomalies) with rationale and match summary. This is sequenced first because everything else in the roadmap only matters if recruiters find these questions valuable — it proves the core product hypothesis that QA-specific CV auditing outperforms generic AI summarization.

## Starting Point

Foundations F-01 (5 DB tables with RLS, 9 seeded QA profiles) and F-02 (LLM client with `completeLLM()`, viability confirmed at ~12.8s) are deployed. The dashboard is a placeholder. No file upload, dropdown, or results UI exists. Auth, middleware, and the JSON API pattern (from the health endpoint) are established.

## Desired End State

A recruiter uploads a PDF/DOCX or pastes CV text, picks a QA profile, sees a 4-stage progress stepper updating in real-time, and views categorized interview questions with rationale and suggested answers — all within 60 seconds. PII is stripped before the CV crosses the organizational boundary. Results are stored per-user with full data isolation.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Frontend routing | Separate Astro pages (`/dashboard`, `/new`, `/[id]`) | Aligns with Astro's file-based routing, simpler than client-side SPA routing | Plan |
| Upload vs paste prominence | File upload primary, collapsible paste fallback | File upload is the natural recruiter workflow; paste is a safety net for parsing failures | Plan |
| File format scope | Ship PDF + DOCX together | Both formats are common in recruitment; `unpdf` + `office-oxide-wasm` cover both with WASM | Plan |
| PII map storage | JSONB column on `candidates` table | Enables optional future PII rehydration for the recruiter's own view | Plan |
| Raw LLM response storage | TEXT column on `analyses` table | Near-zero cost insurance against lost LLM output if downstream INSERT fails | Plan |
| PDF library | `unpdf` (~700KB) | Most battle-tested in serverless AI apps, simplest API, explicitly designed as `pdf-parse` replacement | Research |
| Error UX | Inline error on analysis page + retry button | Keeps the user in context; retry doesn't require re-uploading the file | Plan |
| Structured output mode | Text+JSON extraction (default) | Proven in F-02 viability test; switch to structured output only if failures are frequent | Research |
| Testing depth | Unit tests for anonymizer + schema + prompt builder only | No DOM/component test infrastructure exists; pure-logic modules are the highest-value test targets | Plan |
| Dashboard landing | Analysis history list + "New Analysis" CTA | Recruiter needs both quick access to past results and a clear path to start new analysis | Plan |
| Progress stages | 4 visible stages, skip "generating" DB write | Save a Supabase round-trip; "generating" shown client-side after "analyzing" | Research |

## Scope

**In scope:** Schema migration (2 new columns), CV text extraction (PDF + DOCX), PII anonymization (regex + section rules), analysis API pipeline (3 routes + profiles route), system prompt + prompt builder, dashboard list page, new analysis form (file upload + paste + profile dropdown), results page (progress stepper + categorized questions + error handling), unit tests for pure-logic modules.

**Out of scope:** Custom requirements (S-02), LinkedIn cross-reference (S-03), report export (S-04), component/E2E tests, PII rehydration UI, SSE progress, R2 file storage.

## Architecture / Approach

The pipeline splits into a synchronous front-half (file parsing + DB record creation, ~1.5s) and an asynchronous back-half (anonymization + LLM call + result storage, ~12-27s) using Workers' `ctx.waitUntil()`. The client receives the `analysis_id` immediately, navigates to the results page, and polls `GET /api/analysis/[id]/status` every 2-3s. Three new pure-logic modules (`cv-parser`, `anonymizer`, `analysis`) are independently testable. The frontend adds three Astro pages with React islands.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema migration + CV text extraction | New DB columns + PDF/DOCX parser module with tests | WASM libraries may have unexpected cold start cost on Workers |
| 2. PII anonymization module | Regex + section-aware PII stripping with tests | Section-aware name/company detection is heuristic — will miss edge cases |
| 3. Analysis pipeline (API + LLM prompt) | 3 API routes + schema + system prompt wiring everything together | Complex schema may cause LLM JSON extraction failures |
| 4. Frontend — dashboard + form | Analysis list, file upload, paste fallback, profile dropdown | First greenfield React UI — no existing patterns to follow for forms beyond auth |
| 5. Frontend — progress + results | Real-time progress stepper, categorized question display, error/retry | Polling timing and "generating" client-side state logic need careful UX tuning |

**Prerequisites:** F-01 (deployed), F-02 (deployed), migration deployed before code.
**Estimated effort:** ~5 sessions across 5 phases (1 session per phase).

## Open Risks & Assumptions

- `unpdf` and `office-oxide-wasm` work on workerd — vetted in research but not yet tested with real files on `wrangler dev --remote`
- The `ctx.waitUntil()` closure retains a valid Supabase client for the ~25s pipeline duration — JWT expiry is not a concern at this timescale, but cookie-writing in background will silently no-op
- Section-aware PII detection is best-effort — body-text company names and first-name-only references may leak through (accepted MVP trade-off per research)
- The analysis response schema is more complex than the viability test's — JSON extraction may need tuning if failure rate is high

## Success Criteria (Summary)

- Upload a real QA CV (PDF or DOCX) → categorized questions with rationale appear within 60s
- PII (emails, phones, names) is absent from the text sent to the LLM (check `raw_response` in DB)
- Different users cannot see each other's analyses (RLS enforcement)
