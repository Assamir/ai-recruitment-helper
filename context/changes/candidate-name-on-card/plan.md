# Candidate Name on Analysis Card Implementation Plan

## Overview

Surface the candidate's first and last name on the dashboard analysis card. Today every card is keyed by the uploaded CV filename. This change adds first/last name as first-class `candidates` columns, populates them at analysis-creation time (recruiter-entered value wins, otherwise a heuristic backfill from the CV header), and renders them on the dashboard card with a filename fallback — while keeping the raw name out of the anonymization/LLM path.

## Current State Analysis

(Grounded in `context/changes/candidate-name-on-card/research.md`.)

- **No name is persisted.** `candidates` has `file_name`, `cv_text`, `linkedin_text`, `pii_map` only (`supabase/migrations/20260527185003_data_schema_and_rls.sql:26-33`; types at `src/db/database.types.ts:118-145`). The roadmap's F-01 prerequisite ("name persisted in the schema") is unmet.
- The only name in the system is a single full-name string in `candidates.pii_map["[CANDIDATE_NAME]"]`, captured by `findCandidateName()` (`src/lib/anonymizer/section-rules.ts:6-39`) and written **after** upload during the `anonymizing` stage via an `UPDATE` that has **no RLS UPDATE policy** (`src/pages/api/analysis/index.ts:129-134`).
- The candidate INSERT writes only `user_id, cv_text, file_name` (`src/pages/api/analysis/index.ts:80-84`). `candidates` RLS is SELECT + INSERT only (`supabase/migrations/20260527185003_data_schema_and_rls.sql:136-144`).
- The dashboard card is inline Astro (not a component); primary label is `file_name` or `"Pasted CV"` (`src/pages/dashboard/index.astro:87-115`, insertion point line 108), fed by the select on line 20.
- The PII boundary is `anonymizeCV()` → `buildAnalysisPrompt()` (`src/pages/api/analysis/index.ts:132-147`); only `anonymizedText` leaves the org boundary.
- Upload form `AnalysisForm.tsx` has no name input today; it uses the `FormField` pattern (`src/components/auth/FormField.tsx`).

## Desired End State

A recruiter creating an analysis can optionally type the candidate's first/last name; if they don't, the server extracts it from the CV header. The name is stored in dedicated `candidates.first_name` / `last_name` columns at INSERT time. The dashboard card shows `"First Last"` when available and falls back to the filename otherwise. The name never enters the anonymized text, the LLM prompt, `pii_map`-based client payloads, or any export path.

### Key Discoveries:

- Writing the name at INSERT (not at the anonymize stage) avoids both the "null while parsing" timing hole and the missing RLS UPDATE policy — the existing INSERT policy already authorizes the write (`supabase/migrations/20260527185003_data_schema_and_rls.sql:140-144`).
- `findCandidateName(text)` returns `PiiMatch[]` whose `.match` is the full name string — reusable read-only for display extraction (`src/lib/anonymizer/section-rules.ts:6-39`).
- Migrations must be additive/backward-compatible (`AGENTS.md`): nullable columns with no default satisfy this.
- `npx astro sync` must run before `npm run build` (`AGENTS.md`).

## What We're NOT Doing

- **Not** touching the detail view (`AnalysisResults` header / `GET /api/analysis/[id]`) — scope is the dashboard card only. (Noted as a follow-up; the detail header still shows filename.)
- **Not** changing the anonymizer, the LLM prompt, or `pii_map`. The displayed name is independent of anonymization.
- **Not** exposing `pii_map` to the client.
- **Not** adding name to any export (S-04 doesn't exist yet) or to the LLM output schema.
- **Not** building a two-step parse-preview upload flow — name fields are a simple optional input with server-side backfill.
- **Not** adding a `candidates` UPDATE RLS policy (unneeded; we write at INSERT).
- **Not** backfilling names for pre-existing analyses (columns stay null for old rows; card falls back to filename).

## Implementation Approach

Bottom-up vertical slice: schema → ingest/persistence → UI. The recruiter-entered value takes precedence; when blank, the server runs the header heuristic on the raw CV text and splits the result (first token = first name, remaining tokens = last name). Extraction and the recruiter input are the only two name sources, and both are write-only into dedicated columns read exclusively by recruiter-facing dashboard queries.

## Critical Implementation Details

- **PII boundary invariant:** the new name fields must be set on the `candidates` INSERT object and read only by the dashboard select. They must never be concatenated into `capturedCvText`, passed to `anonymizeCV()` / `buildAnalysisPrompt()`, or added to the `GET /api/analysis/[id]` response. (`src/pages/api/analysis/index.ts:122-147`.)
- **Split rule:** trim and collapse whitespace; split on spaces. `["Jane","Smith"] → first="Jane", last="Smith"`; `["Anna","Maria","Kowalska"] → first="Anna", last="Maria Kowalska"`; single token → first set, last `null`; empty/whitespace → both `null`.

## Phase 1: Schema & types

### Overview

Add nullable `first_name` / `last_name` columns to `candidates` and reflect them in the generated Supabase types.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<timestamp>_candidate_name_columns.sql` (14-digit timestamp matching the existing convention, e.g. `20260530xxxxxx`)

**Intent**: Add the two nullable name columns so a candidate's identity can be persisted at INSERT. Additive-only for backward compatibility.

**Contract**: `alter table public.candidates add column if not exists first_name text; add column if not exists last_name text;` — both nullable, no default. No RLS change (existing SELECT/INSERT policies cover read/write).

#### 2. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Keep the TypeScript types in sync so the INSERT and dashboard select type-check.

**Contract**: Add `first_name: string | null` and `last_name: string | null` to the `candidates` `Row`, and `first_name?: string | null` / `last_name?: string | null` to `Insert` and `Update` (`src/db/database.types.ts:118-145`). Prefer regenerating via the Supabase CLI; hand-edit if regeneration isn't available locally.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against local Supabase (e.g. `supabase db reset` or migration up)
- `npx astro sync && npm run build` passes (types compile)
- `npm run lint` passes

#### Manual Verification:

- `first_name` / `last_name` exist on `candidates`, nullable, default null (verify in Supabase SQL)
- Existing `candidates` rows are unaffected (no errors on read)

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before starting Phase 2.

---

## Phase 2: Capture & persist name at ingest

### Overview

Add a name-split/extraction helper, optional name fields on the upload form, and wire `POST /api/analysis` to persist the name (recruiter input wins, heuristic backfill otherwise) into the candidate INSERT.

### Changes Required:

#### 1. Name helper

**File**: `src/lib/candidate/name.ts` (new)

**Intent**: Provide a display-name helper, kept out of the anonymizer module to preserve the PII boundary while reusing the existing header heuristic.

**Contract**: Export `splitFullName(full: string | null | undefined): { firstName: string | null; lastName: string | null }` implementing the split rule from Critical Implementation Details, and `extractCandidateName(cvText: string): { firstName: string | null; lastName: string | null }` that calls `findCandidateName()` (`src/lib/anonymizer/section-rules.ts`) and passes the first match through `splitFullName`. Returns both `null` when no name is found.

#### 2. Upload form name inputs

**File**: `src/components/analysis/AnalysisForm.tsx`

**Intent**: Let the recruiter optionally provide the candidate's first/last name; blank is allowed (server backfills).

**Contract**: Two optional text inputs (first name, last name) following the existing `FormField` pattern; their values are included in the request payload sent to `POST /api/analysis` alongside the existing fields. No client-side requiredness.

#### 3. Persist on analysis creation

**File**: `src/pages/api/analysis/index.ts`

**Intent**: Resolve the candidate name (recruiter input if non-blank, else heuristic from raw CV) and store it on the candidate INSERT, without touching the anonymize/LLM path.

**Contract**: Read optional `first_name` / `last_name` from the request. Compute the final pair: trimmed recruiter values when present, otherwise `extractCandidateName(cvText)`. Add `first_name` / `last_name` to the `.insert({...})` candidate object (`src/pages/api/analysis/index.ts:80-84`). The retry path (`:44-61`) reuses the existing candidate and is left unchanged. Do not add the name to `capturedCvText`, `anonymizeCV`, or the prompt.

### Success Criteria:

#### Automated Verification:

- Unit tests for `splitFullName` cover two-token, three+-token, single-token, and empty/whitespace inputs (`npm run test`)
- Unit test for `extractCandidateName` extracts + splits a header name and returns nulls when none found
- `npm run lint` passes
- `npx astro sync && npm run build` passes

#### Manual Verification:

- Upload a CV with a header name, leave the form fields blank → new `candidates` row has the extracted `first_name` / `last_name`
- Provide explicit first/last on the form → those values override the heuristic
- CV with no detectable header name and blank fields → both columns null
- Confirm the name does not appear in the anonymized text / LLM request (boundary intact)

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before starting Phase 3.

---

## Phase 3: Show name on the dashboard card

### Overview

Fetch the new columns in the dashboard list query and render the candidate name on the card with a filename fallback.

### Changes Required:

#### 1. Dashboard query + card render

**File**: `src/pages/dashboard/index.astro`

**Intent**: Display `"First Last"` as the card's primary label when available, otherwise keep today's filename behavior.

**Contract**: Extend the `AnalysisRow` candidates type (`:8-15`) with `first_name: string | null; last_name: string | null`, and the select (`:20`) to `candidates(file_name, first_name, last_name)`. In the `.map()` (`:87-100`), derive `displayName = [first_name, last_name].filter(Boolean).join(" ")` and use `displayName || fileName` as the primary label at line 108. `pii_map` is NOT selected.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run build` passes (dashboard query/types compile)
- `npm run lint` passes

#### Manual Verification:

- A card for an analysis with a stored name shows `"First Last"`
- A card with no name falls back to the filename / `"Pasted CV"`
- Page source / network shows no `pii_map` or other raw PII beyond the displayed name

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks.

---

## Testing Strategy

### Unit Tests:

- `splitFullName`: `"Jane Smith"` → `{first:"Jane", last:"Smith"}`; `"Anna Maria Kowalska"` → `{first:"Anna", last:"Maria Kowalska"}`; `"Jane"` → `{first:"Jane", last:null}`; `""` / whitespace → `{first:null, last:null}`.
- `extractCandidateName`: a CV header with `"Jane Smith"` → split pair; a CV with no name line → both null.

### Integration Tests:

- Not adding new integration harness; the analysis-creation path is exercised via the manual verification steps (recruiter-provided vs heuristic vs none).

### Manual Testing Steps:

1. Create an analysis, leave name fields blank, with a CV whose header is `"Jane Smith"` → dashboard card shows `Jane Smith`.
2. Create an analysis with explicit form name `"John Doe"` over a CV header `"Jane Smith"` → card shows `John Doe`.
3. Create an analysis from pasted CV text with no header name and blank fields → card shows `pasted-cv.txt` / `"Pasted CV"`.
4. Confirm in the analyzing stage that the LLM request payload contains no candidate name.

## Performance Considerations

The heuristic runs a small regex over the first ~10 lines of the CV synchronously in the request path before the background pipeline — negligible cost.

## Migration Notes

Additive nullable columns only — backward-compatible per `AGENTS.md`. `wrangler rollback` of the Worker remains safe against the forward-migrated schema (new columns are simply unused). Existing rows keep null names and fall back to filename on the card.

## References

- Related research: `context/changes/candidate-name-on-card/research.md`
- Name heuristic: `src/lib/anonymizer/section-rules.ts:6-39`
- Candidate INSERT: `src/pages/api/analysis/index.ts:80-84`
- Dashboard card: `src/pages/dashboard/index.astro:87-115`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & types

#### Automated

- [x] 1.1 Migration applies cleanly against local Supabase
- [x] 1.2 `npx astro sync && npm run build` passes (types compile)
- [x] 1.3 `npm run lint` passes

#### Manual

- [x] 1.4 `first_name` / `last_name` exist on `candidates`, nullable, default null
- [x] 1.5 Existing `candidates` rows unaffected

### Phase 2: Capture & persist name at ingest

#### Automated

- [ ] 2.1 Unit tests for `splitFullName` cover two/three+/single/empty inputs
- [ ] 2.2 Unit test for `extractCandidateName` extract+split and null cases
- [ ] 2.3 `npm run lint` passes
- [ ] 2.4 `npx astro sync && npm run build` passes

#### Manual

- [ ] 2.5 Blank fields + CV header name → extracted first/last persisted
- [ ] 2.6 Explicit form name overrides the heuristic
- [ ] 2.7 No detectable name + blank fields → both columns null
- [ ] 2.8 Name absent from anonymized text / LLM request

### Phase 3: Show name on the dashboard card

#### Automated

- [ ] 3.1 `npx astro sync && npm run build` passes
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 Card shows `"First Last"` when a name is stored
- [ ] 3.4 Card falls back to filename / `"Pasted CV"` when no name
- [ ] 3.5 No `pii_map` / extra raw PII exposed on the page
