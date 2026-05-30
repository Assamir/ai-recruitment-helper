# Candidate Name on Analysis Card — Plan Brief

> Full plan: `context/changes/candidate-name-on-card/plan.md`
> Research: `context/changes/candidate-name-on-card/research.md`

## What & Why

Dashboard analysis cards are currently keyed by the uploaded CV filename, so analyses are hard to identify at a glance. This change shows the candidate's first and last name on each card (roadmap slice S-05), making analyses identifiable by person.

## Starting Point

No candidate name is persisted anywhere — `candidates` has only `file_name`, `cv_text`, `linkedin_text`, `pii_map`. A full-name string is captured heuristically into `pii_map["[CANDIDATE_NAME]"]` after upload, but it's never split, never exposed to the UI, and its write relies on a missing RLS UPDATE policy. The dashboard card is inline Astro labeled by filename.

## Desired End State

A recruiter can optionally type the candidate's first/last name when creating an analysis; if left blank, the server extracts it from the CV header. The name is stored in dedicated `candidates.first_name` / `last_name` columns and shown on the dashboard card, falling back to the filename when absent. The raw name never crosses into the anonymized text, LLM prompt, or any export.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Name source | Recruiter input + heuristic backfill | Recruiter value wins; server fills blanks from the existing CV-header heuristic — accuracy with no added friction | Plan |
| Persistence | Dedicated `first_name` / `last_name` columns | Keeps the displayed name independent of the sensitive `pii_map` blob and matches the roadmap's "persisted in the schema" wording | Plan |
| Write timing / RLS | Write at the candidate INSERT | Avoids the "null while parsing" timing hole and needs no new RLS UPDATE policy | Plan |
| First/last split | First token = first, remaining = last | Simple, predictable handling of the common "First Last" case | Plan |
| Card fallback | Fall back to filename / "Pasted CV" | No regression; smooth rollout for existing nameless rows | Plan |

## Scope

**In scope:**
- Migration adding nullable `first_name` / `last_name` to `candidates` + type regen
- Name-split/extraction helper
- Optional name fields on the upload form
- Persisting the name on `POST /api/analysis` (recruiter input or heuristic)
- Rendering the name on the dashboard card

**Out of scope:**
- Detail view (`AnalysisResults` header / `GET /api/analysis/[id]`)
- Any change to the anonymizer, LLM prompt, `pii_map`, or exports
- Two-step parse-preview upload flow
- Backfilling names for pre-existing analyses

## Architecture / Approach

Bottom-up vertical slice: schema → ingest/persistence → UI. The name resolves server-side (recruiter input wins, else `extractCandidateName(cvText)`), is written only into dedicated columns, and is read only by the recruiter-facing dashboard query — never joined into the prompt or export builders, preserving the existing two-layer PII boundary.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & types | `first_name` / `last_name` columns + synced types | Type regeneration drift if hand-edited |
| 2. Capture & persist | Helper + form fields + INSERT wiring | Accidentally leaking the name into the anonymize/LLM path |
| 3. Dashboard card | Name shown with filename fallback | Selecting `pii_map` by mistake / null-name layout |

**Prerequisites:** F-01 (candidates table) and S-01 (dashboard + analysis pipeline) are landed.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- The header heuristic misses mononyms, 3+ word names, and non-Latin scripts — those cards fall back to filename until a recruiter supplies a name.
- Assumes the recruiter-entered name is trustworthy (no validation beyond trimming).
- Local builds require `npx astro sync` before `npm run build`.

## Success Criteria (Summary)

- Dashboard cards show `"First Last"` when a name is available, filename otherwise.
- Recruiter-entered names override the heuristic; blank fields trigger extraction.
- No candidate name appears in the LLM request or any client payload beyond the dashboard name field.
