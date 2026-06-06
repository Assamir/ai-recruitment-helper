---
project: "AI-Recruiter"
version: 1
status: draft
created: 2026-05-26
updated: 2026-06-06
prd_version: 1
main_goal: market-feedback
top_blocker: time
---

# Roadmap: AI-Recruiter

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Internal IT recruiters need more than CV summaries — they need audits. The product cross-references a QA candidate's CV against job requirements, timeline logic, and optional external sources to surface gaps, contradictions, and vague claims, then generates targeted interview questions that probe each anomaly. Generic AI and ATS tools summarize; this tool audits — with privacy-preserving anonymization so raw candidate PII never crosses the organizational boundary.

## North star

**S-01: Upload CV + pick QA profile → see categorized interview questions with rationale and match summary** — the smallest end-to-end flow that proves QA-specific anomaly detection outperforms generic AI summarization, placed first because everything else only matters if recruiters find these questions valuable.

> "North star" here means the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — that QA-specific CV auditing surfaces interview-worthy anomalies better than generic AI summarization. It's placed as early as Prerequisites allow because the rest of the roadmap only matters if this works.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | data-schema-and-rls | (foundation) Supabase tables, migrations, RLS, and QA profile seeds landed | — | Access Control, FR-002 | ready |
| F-02 | llm-integration-scaffold | (foundation) LLM client configured; 60s analysis viability verified on Workers | — | NFR (60s response), Business Logic | ready |
| S-01 | first-gated-generation | upload CV + pick QA profile → see categorized questions + match summary | F-01, F-02 | US-01, FR-001, FR-002, FR-006, FR-007, FR-008 | done |
| S-02 | extended-analysis-inputs | paste custom job requirements and project context to enrich analysis | S-01 | FR-003, FR-005 | proposed |
| S-03 | linkedin-cross-reference | paste LinkedIn profile to detect contradictions between CV and LinkedIn | S-01 | FR-004 | proposed |
| S-04 | report-export | export analysis report as PDF or Markdown | S-01 | FR-009 | proposed |
| S-05 | candidate-name-on-card | see the candidate's first and last name on the analysis card | F-01, S-01 | US-01, FR-001 | done |
| S-06 | analysis-removal | delete a candidate's analysis from the dashboard | F-01, S-01 | US-01, FR-002 | done |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme | Chain | Note |
|---|---|---|---|
| A | Core analysis | `F-01` → `S-01` → `S-02` / `S-03` | Main value chain — data schema through enriched analysis; sequenced first to maximize recruiter signal. |
| B | LLM scaffold | `F-02` | Joins Stream A at `S-01`; validates whether the LLM round-trip fits within the Workers 60s window, in parallel with data work. |
| C | Report delivery | `S-04` | Branches from `S-01`; gets the analysis into hiring managers' hands. |

## Baseline

What's already in place in the codebase as of 2026-05-26 (auto-researched + user-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4; components in `src/components/`, file-based routing in `src/pages/`, styles in `src/styles/global.css`
- **Backend / API:** partial — Astro SSR with `@astrojs/cloudflare` adapter; auth API routes (`signin`, `signup`, `signout`) exist; no domain business logic
- **Data:** partial — Supabase client SDK (`@supabase/ssr`) wired for auth only; no schema, no migrations, no SQL files, no seeds
- **Auth:** partial — Supabase Auth via `@supabase/ssr`; sign-in/up/out API routes; middleware guards `/dashboard` only
- **Deploy / infra:** partial — Cloudflare Workers (`wrangler.jsonc`) + GitHub Actions CI/CD (lint/build/deploy on `master`, PR previews); no IaC
- **Observability:** partial — Cloudflare Workers `observability.enabled` flag in `wrangler.jsonc`; no app-level logging, error tracking, or metrics

## Foundations

### F-01: Data schema, migrations, RLS, and QA profile seeds

- **Outcome:** (foundation) Supabase tables for candidates/CVs, analyses, and predefined QA job profiles landed; row-level security policies enforce per-user data isolation; predefined QA profiles (Manual QA Junior/Mid/Senior, Automation QA Python/Java/Playwright/Selenium, Performance Tester, API Tester) seeded.
- **Change ID:** data-schema-and-rls
- **PRD refs:** Access Control, FR-002
- **Unlocks:** S-01, S-02, S-03, S-04 — every domain slice reads/writes these tables
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because every domain slice needs tables. The risk is over-designing the schema before the analysis pipeline shapes the actual data flow — keep columns minimal and extend in later slices.
- **Status:** ready

### F-02: LLM integration scaffold and Workers viability check

- **Outcome:** (foundation) LLM API client (OpenRouter or equivalent) configured with API key management; basic prompt → response → parse pattern verified; confirmed that the round-trip completes within the 60-second Workers execution window for typical CV-length prompts.
- **Change ID:** llm-integration-scaffold
- **PRD refs:** NFR (60s response), Business Logic
- **Unlocks:** S-01 — the analysis pipeline cannot generate questions without a verified LLM integration; also reduces the key technical unknown: whether the LLM round-trip fits within the Workers 60s execution window
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced parallel with F-01 to validate the riskiest technical assumption early — that the LLM round-trip fits within the Workers 60s execution window. If it doesn't, the architecture needs a fundamental change (chunked processing, external compute, or client-side polling with deferred results).
- **Status:** ready

## Slices

### S-01: First gated generation

- **Outcome:** user can upload a CV (.pdf/.docx), select a predefined QA job profile, submit the analysis, see real-time progress through stages (parsing, anonymizing, analyzing, generating), and view a categorized interview question set (missing elements, contradictions, vague claims, anomalies) with context/rationale per question, suggested expected answers, and a match summary.
- **Change ID:** first-gated-generation
- **PRD refs:** US-01, FR-001, FR-002, FR-006, FR-007, FR-008
- **Prerequisites:** F-01 (tables + RLS + seeded profiles), F-02 (LLM client + viability)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Can PDF/DOCX parsing libraries (`pdf-parse`, `mammoth`) run on the workerd runtime? — Owner: TBD. Block: no (paste-CV-text fallback exists per FR-001 Socratic resolution).
- **Risk:** Largest slice — spans file upload, text extraction, PII anonymization, LLM prompting, response parsing, and results UI. Sequenced immediately after foundations because it is the north star: if recruiters don't find these questions valuable, the rest of the roadmap doesn't matter. The workerd parsing concern has a known mitigation (paste fallback).
- **Status:** done

### S-02: Extended analysis inputs

- **Outcome:** user can paste custom job requirements as free text (instead of selecting a predefined profile) and optionally enter project-specific context (domain, methodology, tech requirements) to calibrate the analysis.
- **Change ID:** extended-analysis-inputs
- **PRD refs:** FR-003, FR-005
- **Prerequisites:** S-01 (extends the analysis form and prompt pipeline that S-01 builds)
- **Parallel with:** S-03, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low — adds text input fields and enriches the existing LLM prompt. The risk is that poorly written custom requirements produce poor questions (FR-003 Socratic note); prompt engineering can partially compensate.
- **Status:** proposed

### S-03: LinkedIn cross-reference

- **Outcome:** user can paste LinkedIn profile text or link to enable cross-source contradiction detection — the analysis surfaces discrepancies between CV claims and LinkedIn history.
- **Change ID:** linkedin-cross-reference
- **PRD refs:** FR-004
- **Prerequisites:** S-01 (extends the analysis pipeline and adds a cross-reference dimension)
- **Parallel with:** S-02, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - How reliably can unstructured LinkedIn text be parsed and cross-referenced against structured CV claims? — Owner: TBD. Block: no (input is optional; degraded parsing doesn't break the core loop).
- **Risk:** Medium — LinkedIn data is unstructured and varies wildly (FR-004 Socratic note). Cross-referencing is harder than adding text fields because it introduces a second source of truth. Sequenced after S-01 to keep the core loop simple first.
- **Status:** proposed

### S-04: Report export

- **Outcome:** user can export the analysis report as PDF or Markdown, with anonymized content only and a confidentiality header — the deliverable the recruiter hands to the hiring manager.
- **Change ID:** report-export
- **PRD refs:** FR-009
- **Prerequisites:** S-01 (needs analysis results to export)
- **Parallel with:** S-02, S-03, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Can PDF generation libraries run on the workerd runtime? — Owner: TBD. Block: no (Markdown export is a safe fallback).
- **Risk:** PDF generation on workerd may hit the same runtime compatibility concerns as PDF parsing. Markdown export is reliable regardless. Sequenced after S-01 because export only matters once there are results to export.
- **Status:** proposed

### S-05: UX Candidate information

- **Outcome:** user can see the candidate's first and last name displayed on the analysis card in the dashboard view, so each analysis is identifiable at a glance instead of being shown anonymously.
- **Change ID:** candidate-name-on-card
- **PRD refs:** US-01, FR-001
- **Prerequisites:** F-01 (candidate name persisted in the schema), S-01 (analysis card and dashboard view exist)
- **Parallel with:** S-02, S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low — surfaces an already-captured field on an existing card. The only sensitivity is that the name is raw PII; it stays on the recruiter-facing dashboard and must never cross into anonymized/exported content (see S-04 confidentiality boundary).
- **Status:** done

### S-06: UX Candidate analysis removal

- **Outcome:** user can delete a candidate's analysis from the dashboard view, removing it from the list and from persistent storage so stale or mistaken analyses can be cleaned up.
- **Change ID:** analysis-removal
- **PRD refs:** US-01, FR-002
- **Prerequisites:** F-01 (analyses table + RLS to authorize deletion), S-01 (analyses exist and are listed on the dashboard)
- **Parallel with:** S-02, S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Low — a scoped delete on an existing table. The risk is accidental data loss; a confirmation step and RLS-enforced per-user authorization mitigate it.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| F-01 | data-schema-and-rls | Design Supabase schema, migrations, RLS, and seed QA profiles | yes | Run `/10x-plan data-schema-and-rls` |
| F-02 | llm-integration-scaffold | Configure LLM client and verify 60s viability on Workers | yes | Run `/10x-plan llm-integration-scaffold` |
| S-01 | first-gated-generation | Build CV upload → QA profile → categorized questions pipeline | no | Depends on F-01, F-02 |
| S-02 | extended-analysis-inputs | Add custom requirements and project context inputs | no | Depends on S-01 |
| S-03 | linkedin-cross-reference | Add LinkedIn input and cross-source contradiction detection | no | Depends on S-01 |
| S-04 | report-export | Add PDF and Markdown report export | no | Depends on S-01 |
| S-05 | candidate-name-on-card | Show candidate first and last name on the analysis card | no | Depends on F-01, S-01 |
| S-06 | analysis-removal | Add delete action for a candidate analysis on the dashboard | no | Depends on F-01, S-01 |

## Open Roadmap Questions

1. **Cloudflare Workers workerd runtime compatibility for native-Node libraries** — Owner: TBD. Block: S-01 (PDF/DOCX parsing), S-04 (PDF generation). AGENTS.md warns that `pdf-parse` and `mammoth` may rely on unsupported Node.js internals. Both slices have fallbacks (paste input for S-01, Markdown for S-04), but the primary file-upload workflow depends on the answer. Test early with `wrangler dev --remote`.

## Parked

- **Non-QA role support** — Why parked: PRD §Non-Goals. The system is QA/tester-only in MVP; other IT specializations require different domain expertise in anomaly detection and question generation.

## Done

- **S-05: user can see the candidate's first and last name displayed on the analysis card in the dashboard view, so each analysis is identifiable at a glance instead of being shown anonymously.** — Archived 2026-05-30 → `context/archive/2026-05-30-candidate-name-on-card/`. Lesson: —.
- **S-06: user can delete a candidate's analysis from the dashboard view, removing it from the list and from persistent storage so stale or mistaken analyses can be cleaned up.** — Archived 2026-05-30 → `context/archive/2026-05-30-analysis-removal/`. Lesson: —.
- **S-01: upload CV + pick QA profile → see categorized questions + match summary** — Archived 2026-06-06 → `context/archive/2026-05-27-first-gated-generation/`. Lesson: —.
