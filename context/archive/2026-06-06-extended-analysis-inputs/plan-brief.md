# Extended Analysis Inputs (S-02) — Plan Brief

> Full plan: `context/changes/extended-analysis-inputs/plan.md`
> Research: `context/changes/extended-analysis-inputs/research.md`

## What & Why

Let the recruiter calibrate a CV analysis with two new inputs: **custom job requirements** as free text (FR-003) — an alternative or supplement to a predefined QA profile — and optional **project context** (domain/methodology/tech, FR-005). Predefined profiles are a scaffold; custom text is the escape hatch for non-standard roles. The analysis output is unchanged; only the inputs that shape the prompt change.

## Starting Point

S-01 already ships the full form → API → prompt → results pipeline, and F-01 pre-provisioned the DB: `analyses.custom_requirements`, `analyses.project_context`, and a nullable `job_profile_id` already exist with RLS. Today the API hard-requires a profile, the prompt builder is profile-only, and custom-only analyses would break the results header ("Unknown profile") and the retry path.

## Desired End State

A recruiter can submit with a profile, custom requirements, both, plus optional project context. The API accepts any valid combination, rejects "neither" and over-cap inputs with clear errors, persists all three columns, and the pipeline builds a prompt from whatever sections are present. Results label custom analyses correctly and show what drove them; retry works for every input combination.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Profile vs custom contract | At least one required; both allowed together | Matches PRD framing (profile = scaffold, custom = override) and never blocks a valid workflow | Plan |
| Data-layer enforcement | App-level validation only, no migration/CHECK | DB columns already exist; single API entry point makes a constraint redundant churn | Plan |
| Length limits | Dedicated caps for custom requirements + project context (client + server) | Bounds prompt size/cost and fails cleanly, consistent with `cv_text` | Plan |
| Custom-requirements prompt shape | Conditional named sections; profile + custom both render when present | Supports the "both allowed" contract and keeps inputs clearly labeled for the LLM | Plan |
| Project-context placement | Dedicated `PROJECT CONTEXT:` section whenever present, regardless of mode | FR-005 calibrates relevance independent of profile-vs-custom | Plan |
| Surfacing | Full: GET returns columns, results label, retry re-sends used inputs | Closes the research-flagged custom-only display + retry breakage | Plan |

## Scope

**In scope:** form inputs + relaxed client validation; API profile-OR-custom gate, parsing, caps, persistence; pipeline prompt branch; prompt builder + tests; GET payload, results label, retry path.

**Out of scope:** DB migration / CHECK constraint; response-schema changes; LinkedIn (S-03); structured project-context sub-fields; component/API-route test infra.

## Architecture / Approach

Bottom-up across four layers so each rests on a tested foundation: **prompt builder (pure, unit-tested)** → **API route + background pipeline** → **form** → **results/retry surfacing**. The profile-OR-custom invariant is enforced once, in the API route; the form mirrors it as UX only. Length caps live in a shared `src/lib/analysis/limits.ts` so form and route agree. The prompt renders only non-empty sections, CV always last.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Prompt builder + tests | Options-object `buildAnalysisPrompt` with conditional sections; updated prompt + PII boundary tests | Signature change ripples to callers/tests; PII assertions must cover new free text |
| 2. API + pipeline | Profile-OR-custom gate, caps, column persistence, prompt branch | Mis-gating could let "neither" through or break profile-only flow |
| 3. Form | Two new textareas, relaxed validation, client caps | UX must match server rule without becoming the authority |
| 4. Surfacing | GET columns, "Custom requirements" label, working retry | Retry must re-send the right inputs per analysis type |

**Prerequisites:** S-01 (done/archived); local LLM provider configured for manual verification.
**Estimated effort:** ~1 focused session across 4 small phases.

## Open Risks & Assumptions

- Poorly written custom requirements may yield weaker questions (FR-003 Socratic note); prompt section labeling partially compensates.
- No DB constraint means the API route is the sole guardian of the profile-OR-custom invariant — acceptable given the single entry point.
- No automated coverage for form/API; phases rely on manual verification as S-01 did.

## Success Criteria (Summary)

- Recruiter can run an analysis from custom requirements alone, a profile alone, or both, with optional project context.
- Invalid inputs (neither present, over-cap) are rejected with clear errors at both layers.
- Custom-only analyses display correctly and retry without a re-upload.
