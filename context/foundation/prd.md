---
project: "AI-Recruiter"
version: 1
status: draft
created: 2026-05-23
context_type: greenfield
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 6
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Internal IT recruiters preparing for QA candidate interviews face a double pain: decision paralysis (data overload — they can't efficiently decide which CV claims to probe) and workflow friction (the manual process of cross-referencing CV timelines, skill claims, and job requirements is too slow per candidate). The result: generic interview questions, missed red flags, and wasted interview time on candidates whose CVs masked critical gaps.

The insight: existing ATS tools and generic AI summarize CVs — they don't audit them. They can't detect that "3 years of automation testing" is contradicted by a timeline showing 2.5 years of manual testing with only 3 months of Cypress. Generic AI doesn't understand QA-specific career patterns. And enterprise tools that could approach this depth expose raw PII to external services — a GDPR blocker for European companies. A privacy-preserving approach delivers deep, QA-aware anomaly detection without exposing raw candidate data beyond the organization's boundary — solving all three gaps simultaneously.

## User & Persona

**Primary persona:** Internal IT recruiter at a mid-to-large company, responsible for screening QA/tester candidates. They receive 10–30 CVs per open position, conduct initial phone screens, and prepare interview question sets for hiring managers. They understand QA terminology at a surface level but rely on hiring managers for deep technical validation. Their pain moment: sitting with a CV and a job description, trying to figure out what's real and what's inflated — before the interview happens.

## Success Criteria

### Primary
- Recruiter uploads a CV (.pdf/.docx) + selects a QA job profile (or pastes custom requirements) → receives a structured interview question set categorized by anomaly type (missing elements, contradictions, vague claims, red flags), with context explaining why each question was generated and suggested expected answers.

### Secondary
- Generated questions consistently surface issues (gaps, contradictions, inflated claims) that the recruiter would not have caught through manual CV review alone.

### Guardrails
- PII safety: candidate personal data (names, emails, phones, company names) must never be exposed beyond the organization's boundary in identifiable form.
- No hallucination: every generated question must reference only content actually present in the CV or job requirements — never fabricated claims or invented timeline details.
- Response time: full analysis must complete within 60 seconds, not hang indefinitely.
- Data isolation: recruiter A must never see recruiter B's candidates or analyses under any circumstances.

## User Stories

### US-01: Recruiter generates interview questions from a QA candidate's CV

- **Given** a logged-in recruiter with a QA candidate's CV file and a job profile selected
- **When** they submit the analysis
- **Then** they see a categorized interview question set (organized by: missing elements, contradictions, vague claims, anomalies), where each question includes context explaining why it was generated and a suggested expected answer

#### Acceptance Criteria
- Each question category contains at least one question if the CV has relevant anomalies
- Questions reference only content present in the CV and job requirements
- The match summary appears above the question set
- Analysis completes within 60 seconds

## Functional Requirements

### Input & Upload
- FR-001: Recruiter can upload a CV file (.pdf or .docx). Priority: must-have
  > Socrates: Counter-argument considered: "PDF/DOCX parsing is notoriously fragile — bad parses silently corrupt the analysis and erode trust faster than missing a feature." Resolution: kept; file upload is the natural recruiter workflow and parsing quality is a solvable engineering problem (validation + fallback to paste).
- FR-002: Recruiter can select a predefined QA job profile from a list (Manual QA Junior/Mid/Senior, Automation QA Python, Automation QA Java/Playwright/Selenium, Performance Tester, API Tester). Priority: must-have
  > Socrates: Counter-argument considered: "Predefined profiles give false precision — real requirements are always custom; the list becomes a lazy crutch that produces generic questions." Resolution: kept; profiles serve as a starting scaffold that still passes domain-specific context; custom text (FR-003) exists as the escape hatch.
- FR-003: Recruiter can paste custom job requirements as free text instead of selecting a predefined profile. Priority: must-have
  > Socrates: Counter-argument considered: "Free text means garbage-in-garbage-out — poorly written requirements produce poor questions, and the recruiter blames the tool." Resolution: kept; the custom field is essential for non-standard positions; prompt engineering can partially compensate for vague input.
- FR-004: Recruiter can optionally paste LinkedIn profile text or link for cross-reference. Priority: must-have
  > Socrates: Counter-argument considered: "LinkedIn data is unstructured and varies wildly — parsing it reliably doubles the input complexity for marginal gain in MVP." Resolution: kept; cross-referencing CV vs. LinkedIn is a core auditing signal (contradictions between sources); marked optional to reduce friction.
- FR-005: Recruiter can optionally enter project-specific context (domain, methodology, tech requirements). Priority: must-have
  > Socrates: Counter-argument considered: "Project context makes questions too specific — the interview becomes an interrogation about one project rather than a broad skill assessment." Resolution: kept; project context calibrates relevance (testing in FinTech vs. e-commerce is different); the analysis must balance specificity with breadth.

### Analysis & Processing
- FR-006: Recruiter can submit the input and see analysis progress with stage indicators (parsing, anonymizing, analyzing, generating). Priority: must-have
  > Socrates: Counter-argument considered: "Fake progress bars erode trust when actual time is unpredictable — a simple spinner with 'analyzing...' is more honest." Resolution: kept; stages map to real processing steps (each has measurable start/end); implementation must use actual stage transitions, not animation timers.

### Output & Reporting
- FR-007: Recruiter can view a generated interview question set categorized by anomaly type (missing elements, contradictions, vague claims, anomalies), where each question includes context/rationale and a suggested expected answer. Priority: must-have
  > Socrates: Counter-argument considered: "Forced categorization (4 buckets) makes the output rigid — some CVs only have vague claims, producing empty categories that look broken." Resolution: kept; categories are shown only when populated (empty categories are hidden, not displayed as "0 findings").
- FR-008: Recruiter can view a match summary (2-3 sentence overall fit assessment). Priority: must-have
  > Socrates: Counter-argument considered: "A summary 'score' makes the recruiter decide before reading the details — it becomes a shortcut that replaces the deeper analysis." Resolution: kept; the summary is qualitative (no numeric score), positioned as an orientation aid, not a decision — detailed questions remain the primary deliverable.
- FR-009: Recruiter can export the report as PDF or Markdown. Priority: must-have
  > Socrates: Counter-argument considered: "Exported PDFs with candidate analysis circulate outside the system — a data-leak vector that contradicts the PII safety guardrail." Resolution: kept; exports will contain only anonymized analysis (no raw PII) and include a confidentiality header; the export is the recruiter's deliverable to the hiring manager.

## Non-Functional Requirements

- User-perceived response: full analysis (from submission to rendered results) completes within 60 seconds. The user receives continuous visible feedback during the wait.
- Privacy (GDPR): no raw PII (names, emails, phone numbers, company names, addresses) is exposed beyond the organization's boundary during analysis. All personal identifiers are stripped before any data crosses the organizational perimeter.

## Business Logic

The system cross-references a candidate's CV claims against job requirements, timeline logic, and optional external data to surface gaps, contradictions, and vague claims — then generates targeted interview questions that probe each anomaly.

The rule consumes four user-facing inputs: CV text (extracted from an uploaded file), job requirements (a predefined QA profile or custom text), optionally LinkedIn profile text as a cross-reference source, and optionally project context as a domain calibrator.

The rule produces a structured audit across four anomaly categories: (1) missing elements — skills/technologies required but absent or superficially mentioned in the CV; (2) contradictions — logical conflicts between timelines, claimed experience levels, and described responsibilities; (3) vague claims — buzzwords and generalities that mask lack of practical experience; (4) anomalies — non-standard career patterns, role regressions, or technology claims unsupported by project history.

The recruiter encounters the output as a panel of categorized interview questions, each with a rationale explaining why it was generated and a suggested expected answer. Categories with no findings are hidden. A 2-3 sentence match summary orients the recruiter before they dive into specifics.

## Access Control

Login via email/password or third-party identity provider. Flat user model — all recruiters are equal peers. Each user sees only their own uploaded CVs and generated analyses. No admin role, no team hierarchy, no shared workspace in MVP. Unauthenticated users see a login/register page only.

## Non-Goals

- No support for non-QA roles in MVP. The system is optimized exclusively for QA/tester recruitment (Manual QA, Automation QA, Performance Testing, API Testing). Frontend, Backend, DevOps, and other IT specializations are explicitly out of scope — they require different domain expertise in anomaly detection and question generation. Rationale: domain depth over breadth; a shallow multi-role tool is worse than a deep single-role one.

## Open Questions

No unresolved questions identified during shaping. All quality gate elements passed (quality_check_status: accepted). The input was fully shaped through all 6 discovery phases with Socratic challenge rounds completed for all 9 FRs.
