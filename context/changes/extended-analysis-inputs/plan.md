# Extended Analysis Inputs (S-02) Implementation Plan

## Overview

Let the recruiter calibrate an analysis with two new inputs: **custom job requirements** (free text, FR-003) as an alternative or supplement to a predefined QA profile, and optional **project context** (domain/methodology/tech, FR-005). At least one of {profile, custom requirements} must be present; both may coexist (profile = scaffold, custom = override). Project context is always optional and additive. The analysis output (schema, questions, categories) does not change — S-02 changes inputs only.

This is pure application-layer wiring across the existing S-01 pipeline: prompt builder → API route + background pipeline → form → results/retry surfacing. The database already provisions the columns and RLS, so no migration is required.

## Current State Analysis

- **DB is already S-02-ready.** `analyses.custom_requirements` and `analyses.project_context` (both `text` nullable) plus a nullable `job_profile_id` FK already exist (`supabase/migrations/20260527185003_data_schema_and_rls.sql:35-47`). INSERT/UPDATE RLS already covers `analyses` (`:147-160`). Generated types expose all three as `string | null` (`src/db/database.types.ts:13-54`). **No migration needed.**
- **Prompt builder is profile-only.** `buildAnalysisPrompt(anonymizedText, profile)` renders `JOB PROFILE` / `EXPECTED SKILLS` / `CV (anonymized)` (`src/lib/analysis/prompt.ts:32-51`). The system prompt frames the task as "CV against a specific QA job profile" (`prompt.ts:1`). No notion of custom requirements or project context anywhere outside `database.types.ts`.
- **API hard-requires a profile.** `src/pages/api/analysis/index.ts:41-46` rejects any request without a `job_profile_id`; the insert sets only 4 columns (`:138-151`); the background pipeline always fetches a profile row and feeds it to the prompt (`:208-223`), throwing "Job profile not found" if absent.
- **Surfacing gaps.** `GET /api/analysis/[id]` selects `job_profile_id, candidate_id` but omits the new columns (`src/pages/api/analysis/[id]/index.ts:25-30`); it already null-guards the profile fetch (`:43-50`). The results header shows `"Unknown profile"` when `profile` is null (`src/components/analysis/AnalysisResults.tsx:61`). The retry path re-POSTs `job_profile_id` and gates `canRetry` on `profile?.id` (`src/components/analysis/AnalysisView.tsx:73-82, 105`) — both break for custom-only analyses.
- **Reusable UI pattern.** No shadcn form primitives exist; the collapsible paste-fallback textarea in `FileUpload.tsx:104-123` (toggle + conditional `<textarea>` with a shared cosmic-glass class) is the template for the new optional inputs.
- **Length cap precedent.** `cv_text` is capped by `MAX_CV_TEXT_CHARS` and validated with a `400` `BAD_REQUEST` (`index.ts:85-95`).

## Desired End State

A recruiter on `/dashboard/new` can: select a profile, paste custom requirements, do both, and optionally add project context — then submit. The API accepts profile-only, custom-only, or both; rejects neither-present and over-cap inputs with clear `400`s; persists all three columns; and the background pipeline builds a prompt with the present sections. The results page labels a custom analysis correctly (not "Unknown profile") and shows the recruiter what drove it; retry works for any input combination. `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all pass.

### Key Discoveries:

- DB columns + RLS already exist — `supabase/migrations/20260527185003_data_schema_and_rls.sql:35-47`, `:147-160`.
- Prompt builder signature is the contract other layers depend on — `src/lib/analysis/prompt.ts:32-51`.
- Hard profile gate to relax — `src/pages/api/analysis/index.ts:41-46`.
- Pipeline profile fetch to branch — `index.ts:208-223`.
- PII boundary test must cover the new free-text fields — `tests/lib/anonymizer/boundary.test.ts`.
- Retry + results breakage for null profile — `AnalysisView.tsx:73-82`, `AnalysisResults.tsx:61`.

## What We're NOT Doing

- **No DB migration and no `CHECK` constraint.** The profile-OR-custom invariant is enforced at the API layer only (single entry point). DB columns already exist.
- **No response-schema change.** `src/lib/analysis/schema.ts` and `analysis_questions` are untouched — output stays `match_summary` + `questions[]`.
- **No LinkedIn cross-reference (S-03) or any other roadmap slice.**
- **No structured project-context fields.** Project context is a single free-text field, not separate domain/methodology/tech inputs.
- **No component/API-route test infrastructure.** S-01 established none; this change adds unit coverage only for the pure prompt logic and reuses the existing boundary test.

## Implementation Approach

Work bottom-up so each layer rests on a tested foundation: (1) extend the pure prompt builder and its tests first; (2) relax + extend the API route and background pipeline against the new builder; (3) add the form inputs and relax client validation; (4) surface the new fields in the GET response, results header, and retry. The profile-OR-custom invariant lives in one place (the API route); the form mirrors it client-side as UX, not as the authority. Length caps live in a small shared constants module so the form and the route validate against the same numbers.

## Critical Implementation Details

- **Prompt section ordering & emptiness.** The builder must render only the sections whose inputs are present, in this order: requirements (`JOB PROFILE`/`EXPECTED SKILLS` when a profile exists, and/or `CUSTOM JOB REQUIREMENTS` when custom text exists) → `PROJECT CONTEXT` (when present) → `CV (anonymized)` (always last). The CV must always be the final block so the model sees instructions before data, matching the current shape.
- **PII boundary.** Custom requirements and project context are recruiter-entered free text interpolated into the cross-org prompt. Any new interpolation must be exercised by the `boundary.test.ts` no-raw-PII family — the candidate PII assertions must still hold when these fields are populated.
- **Background pipeline branch.** Only fetch a `job_profiles` row when a `job_profile_id` was captured. The existing `if (!profile) throw "Job profile not found"` must apply only when a profile id was supplied but its row is missing — never when the analysis is intentionally custom-only.
- **Column-scoped writes.** The analyses INSERT must set the new columns explicitly (not spread), consistent with the `lessons.md` rule that RLS restricts rows not columns and writes must be explicit + error-checked.

## Phase 1: Prompt builder (pure logic) + tests

### Overview

Extend `buildAnalysisPrompt` to accept optional custom requirements and project context, render them as conditional named sections, and acknowledge them in the system prompt. Update the two tests that encode the prompt contract.

### Changes Required:

#### 1. Prompt builder

**File**: `src/lib/analysis/prompt.ts`

**Intent**: Replace the profile-only positional signature with an options object so the builder can render any combination of {profile, custom requirements} plus optional project context. Render only non-empty sections; keep `CV (anonymized)` last. Add one sentence to `QA_ANALYSIS_SYSTEM_PROMPT` stating requirements may come as a predefined profile, custom free text, or both, and may include project context that calibrates relevance.

**Contract**: New signature the API and tests depend on —

```ts
export function buildAnalysisPrompt(input: {
  anonymizedText: string;
  profile?: { name: string; description: string; expected_skills: unknown } | null;
  customRequirements?: string | null;
  projectContext?: string | null;
}): string
```

Invariant (caller-guaranteed): at least one of `profile` / `customRequirements` is non-empty. Section labels are exactly `JOB PROFILE:`, `EXPECTED SKILLS:`, `CUSTOM JOB REQUIREMENTS:`, `PROJECT CONTEXT:`, `CV (anonymized):`. The existing system-prompt substrings (`missing_elements`, `match_summary`, `only`, etc.) must remain intact.

#### 2. Prompt builder unit tests

**File**: `tests/lib/analysis/prompt.test.ts`

**Intent**: Migrate existing assertions to the new options-object call shape, and add cases for: custom-only (no profile), profile + custom together, project-context section presence, and omission of absent sections. Keep the `[CANDIDATE_NAME]` / no-real-name assertion.

**Contract**: All calls use the object form. New cases assert `CUSTOM JOB REQUIREMENTS:` / `PROJECT CONTEXT:` appear only when their inputs are passed, and that the CV block remains present and last.

#### 3. PII boundary test

**File**: `tests/lib/anonymizer/boundary.test.ts`

**Intent**: Update the `buildAnalysisPrompt` call to the new signature and add custom-requirements + project-context values to at least one fixture run, asserting the no-raw-candidate-PII family still passes with the new fields populated.

**Contract**: The existing `expectedPlaceholders` present + `piiValues` absent assertions hold while `customRequirements`/`projectContext` are interpolated.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Spot-read a generated prompt string for each combination (profile-only, custom-only, both, + context) and confirm sections render in the right order with no empty headings.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: API route + background pipeline

### Overview

Relax the hard profile gate to profile-OR-custom, parse/validate/cap the two new fields, persist all three columns on insert, and branch the background pipeline to build the prompt from whatever inputs are present.

### Changes Required:

#### 1. Shared length caps

**File**: `src/lib/analysis/limits.ts` (new)

**Intent**: Export `MAX_CUSTOM_REQUIREMENTS_CHARS` and `MAX_PROJECT_CONTEXT_CHARS` so the route and the form validate against identical numbers, mirroring the `MAX_CV_TEXT_CHARS` precedent.

**Contract**: Two exported numeric constants. Choose sane bounds that keep prompt size reasonable (custom requirements larger than project context).

#### 2. API route — parse, validate, persist

**File**: `src/pages/api/analysis/index.ts`

**Intent**: Make `job_profile_id` optional (validate UUID format only when present). Parse `custom_requirements` and `project_context` from the form, trim them, and treat empty as absent. Replace the hard profile gate with a profile-OR-custom rule: if neither a valid profile id nor non-empty custom requirements is present, return `400 BAD_REQUEST`. Enforce the two caps with `400` responses mirroring the `cv_text` cap. Set `job_profile_id` (or null), `custom_requirements`, and `project_context` explicitly on the analyses insert. Capture the custom requirements and project context for the background closure alongside the existing captures.

**Contract**: New gate replaces `index.ts:41-46`. Error bodies use the existing `{ error, code }` shape via `jsonResponse`. Insert at `index.ts:138-151` gains the three columns (profile id nullable). Reuse `isUuid` for the conditional profile-id check.

#### 3. Background pipeline branch

**File**: `src/pages/api/analysis/index.ts`

**Intent**: Fetch the `job_profiles` row only when a profile id was captured; otherwise skip the fetch. Call `buildAnalysisPrompt` with the options object passing the resolved profile (or null), captured custom requirements, and captured project context. Preserve the "Job profile not found" throw only for the case where a profile id was given but no row returned.

**Contract**: Edits the block at `index.ts:208-223`. The `completeLLM` call, status writes, and question persistence are unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`

#### Manual Verification:

- `POST /api/analysis` with custom-only (no profile) → `201`, analysis completes, questions generated.
- `POST` with profile + custom + context → `201`, prompt reflects all sections (verify via `npx wrangler tail` or logged prompt).
- `POST` with neither profile nor custom → `400` with a clear message.
- `POST` with over-cap custom requirements / project context → `400` with the cap message.
- `analyses` row shows the persisted `custom_requirements` / `project_context` values.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Frontend form

### Overview

Add a custom-requirements textarea and a project-context textarea to the analysis form, relax client validation to profile-OR-custom, and send the new fields (with client-side caps mirroring the server).

### Changes Required:

#### 1. Analysis form inputs + validation

**File**: `src/components/analysis/AnalysisForm.tsx`

**Intent**: Add `customRequirements` and `projectContext` state and two new inputs using the `FileUpload` collapsible-textarea visual pattern (shared cosmic-glass class). Relax the client check at `:31-38` so submission requires a profile OR non-empty custom requirements (not a profile unconditionally); show a clear message when neither is set. Enforce client-side caps from `src/lib/analysis/limits.ts`. Append `custom_requirements` / `project_context` to the `FormData` when non-empty. Make the profile selector visually optional now that it isn't strictly required.

**Contract**: New `FormData` keys `custom_requirements`, `project_context`. Validation mirrors the API gate (UX only — the API remains authoritative). Reuse the textarea class string from `FileUpload.tsx:116-121`.

#### 2. Profile selector optionality

**File**: `src/components/analysis/ProfileSelector.tsx`

**Intent**: Reflect that a profile is no longer mandatory — drop/adjust the required asterisk and label so the UI doesn't imply a hard requirement.

**Contract**: Label/marker copy change only; the `select` + onChange contract is unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Submit with custom requirements and no profile → analysis starts and navigates to the result.
- Submit with profile + custom + context → all sent and persisted.
- Submit with neither profile nor custom → inline client error, no request fired.
- Over-cap text → inline client error.
- New textareas match the existing cosmic-glass styling.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 4.

---

## Phase 4: Results + retry surfacing

### Overview

Return the new columns from the GET endpoint, label custom analyses correctly in the results header, and make retry re-send whichever inputs the analysis used.

### Changes Required:

#### 1. GET endpoint payload

**File**: `src/pages/api/analysis/[id]/index.ts`

**Intent**: Add `custom_requirements` and `project_context` to the analyses select (`:25-30`) and to the `analysis` object in the response body (`:52-61`). The conditional profile fetch already handles null profiles.

**Contract**: Response `analysis` object gains `custom_requirements: string | null` and `project_context: string | null`.

#### 2. Results header label

**File**: `src/components/analysis/AnalysisResults.tsx`

**Intent**: Accept `customRequirements` (and optionally `projectContext`) props. When `profile` is null, show a "Custom requirements" label instead of `"Unknown profile"` (`:61`), and surface the custom requirements text/snippet so the recruiter sees what drove the analysis.

**Contract**: `AnalysisResultsProps` gains the new optional string fields; the meta-row rendering branches on profile-vs-custom.

#### 3. Retry path

**File**: `src/components/analysis/AnalysisView.tsx`

**Intent**: Add `custom_requirements` / `project_context` to the `ResultData.analysis` type. In `handleRetry` (`:71-95`), re-POST `job_profile_id` only when present and include `custom_requirements` / `project_context` when present. Update the `canRetry` gate (`:105`) so a candidate with custom requirements (and no profile) is retryable. Pass the new fields down to `AnalysisResults`.

**Contract**: Retry `FormData` includes `candidate_id` plus whichever of `job_profile_id` / `custom_requirements` / `project_context` the analysis used. `canRetry = candidate.id && (profile?.id || custom_requirements)`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Open a completed custom-only analysis → header shows "Custom requirements" (not "Unknown profile") and the requirements text.
- Retry a failed custom-only analysis → re-runs successfully without a re-upload.
- Retry a profile-based analysis → still works unchanged.
- A profile + custom + context analysis displays and retries correctly.

**Implementation Note**: After automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `buildAnalysisPrompt`: profile-only, custom-only, profile+custom, with/without project context, section omission, CV-last ordering, pre-serialized vs object `expected_skills`.
- PII boundary: no raw candidate PII leaks when custom requirements + project context are interpolated.

### Integration Tests:

- None added (no API-route test infra in this codebase). Covered by manual verification per phase.

### Manual Testing Steps:

1. Custom-only submission → completes, questions generated.
2. Profile + custom + context → all sections in prompt, all columns persisted.
3. Neither profile nor custom → `400` (API) and inline error (form).
4. Over-cap inputs → `400` (API) and inline error (form).
5. Results header + retry for custom-only and profile-based analyses.

## Performance Considerations

Caps on custom requirements and project context bound prompt/token size and cost. No new DB round-trips beyond the conditional profile fetch that already exists (it's now skipped for custom-only analyses, a net reduction).

## Migration Notes

None. All columns and RLS already exist; existing rows (all with a `job_profile_id`) remain valid under the API-level profile-OR-custom rule.

## References

- Research: `context/changes/extended-analysis-inputs/research.md`
- Roadmap S-02: `context/foundation/roadmap.md:105-115`
- PRD FR-003 / FR-005: `context/foundation/prd.md:61-66`
- Lessons (Supabase writes): `context/foundation/lessons.md`
- Prompt builder: `src/lib/analysis/prompt.ts:32-51`
- API route: `src/pages/api/analysis/index.ts:41-46`, `:138-151`, `:208-223`
- GET endpoint: `src/pages/api/analysis/[id]/index.ts:25-50`
- Form: `src/components/analysis/AnalysisForm.tsx:31-51`
- Reusable textarea: `src/components/analysis/FileUpload.tsx:104-123`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Prompt builder (pure logic) + tests

#### Automated

- [x] 1.1 Unit tests pass: `npm run test`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 Linting passes: `npm run lint`

#### Manual

- [x] 1.4 Spot-read generated prompt for each combination — correct section order, no empty headings

### Phase 2: API route + background pipeline

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Unit tests pass: `npm run test`

#### Manual

- [x] 2.4 Custom-only POST → 201, completes with questions
- [x] 2.5 Profile + custom + context POST → 201, all sections in prompt
- [x] 2.6 Neither profile nor custom → 400 with clear message
- [x] 2.7 Over-cap custom requirements / project context → 400 cap message
- [x] 2.8 `analyses` row persists `custom_requirements` / `project_context`

### Phase 3: Frontend form

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Build passes: `npm run build`

#### Manual

- [x] 3.4 Custom-only submission starts analysis and navigates to result
- [x] 3.5 Profile + custom + context all sent and persisted
- [x] 3.6 Neither set → inline client error, no request fired
- [x] 3.7 Over-cap text → inline client error
- [x] 3.8 New textareas match existing cosmic-glass styling

### Phase 4: Results + retry surfacing

#### Automated

- [x] 4.1 Type checking passes: `npm run typecheck`
- [x] 4.2 Linting passes: `npm run lint`
- [x] 4.3 Build passes: `npm run build`

#### Manual

- [x] 4.4 Custom-only analysis header shows "Custom requirements" + requirements text
- [x] 4.5 Retry of failed custom-only analysis re-runs without re-upload
- [x] 4.6 Retry of profile-based analysis still works
- [x] 4.7 Profile + custom + context analysis displays and retries correctly
