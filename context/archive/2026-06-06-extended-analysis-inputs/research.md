---
date: 2026-06-06T16:32:00+02:00
researcher: dczaj
git_commit: b781ab9373d77b9766eae7a401f857c0f05b6854
branch: main
repository: ai-recruitment-helper
topic: "Extended analysis inputs (S-02): custom job requirements + project context"
tags: [research, codebase, analysis-pipeline, prompt, form, schema, FR-003, FR-005]
status: complete
last_updated: 2026-06-06
last_updated_by: dczaj
---

# Research: Extended analysis inputs (S-02)

**Date**: 2026-06-06T16:32:00+02:00
**Researcher**: dczaj
**Git Commit**: b781ab9373d77b9766eae7a401f857c0f05b6854
**Branch**: main
**Repository**: ai-recruitment-helper

## Research Question

What does it take to implement roadmap slice **S-02 (`extended-analysis-inputs`)** — let the recruiter paste **custom job requirements** as free text (FR-003, an alternative to selecting a predefined profile) and optionally enter **project-specific context** (domain, methodology, tech requirements; FR-005) to calibrate the analysis? Where does the current S-01 pipeline (form → API → prompt → DB) need to change, and what is already in place?

## Summary

**The database schema is already S-02-ready.** The F-01 migration created `analyses.custom_requirements` (text, nullable), `analyses.project_context` (text, nullable), and a **nullable** `job_profile_id` FK. No new migration is required for the core feature — S-02 is **pure application-layer wiring** across three layers:

1. **Frontend** (`AnalysisForm.tsx`): add a custom-requirements text input (as an alternative to the profile selector) and an optional project-context textarea; relax the "profile required" client validation.
2. **API** (`src/pages/api/analysis/index.ts`): parse the two new form fields, replace the hard `job_profile_id` required-gate with a **profile-OR-custom-requirements** rule, persist the new columns on insert, and branch the background pipeline to build the prompt from either a profile row or the custom text.
3. **Prompt** (`src/lib/analysis/prompt.ts`): extend `buildAnalysisPrompt` to accept custom requirements and project context, with new template sections; keep the response schema (`schema.ts`) unchanged.

The single biggest structural decision is **how to model "profile vs. custom requirements"** — the API currently treats `job_profile_id` as a hard requirement (`index.ts:41-46`) even though the DB makes it optional. The cleanest approach is an **XOR-ish input contract**: at least one of {profile, custom requirements} must be present; both could even be allowed (profile as scaffold + custom text as override). Project context is purely additive and always optional.

A secondary decision: the results page currently renders `"Unknown profile"` when `job_profile_id` is null (`AnalysisResults.tsx:61`), and the **retry path** (`AnalysisView.tsx`) re-sends `job_profile_id` — both need to handle custom-only analyses. The `GET /api/analysis/[id]` response also omits `custom_requirements`/`project_context`, so they'd need surfacing for results display and retry.

## Detailed Findings

### Layer 1 — Frontend form (`src/components/analysis/`)

The form is a React island hydrated `client:only="react"` from `src/pages/dashboard/new.astro`, which loads profiles server-side from `job_profiles` (`new.astro:8-15`).

Current `AnalysisForm.tsx` state (`AnalysisForm.tsx:19-25`): `file`, `cvText`, `profileId`, `firstName`, `lastName`, `loading`, `error`. UI render order (`AnalysisForm.tsx:78-99`): `FileUpload` → first/last name grid → `ProfileSelector` → error banner → submit.

Client validation **hard-requires** a profile:

```31:38:src/components/analysis/AnalysisForm.tsx
    if (!profileId) {
      setError("Please select a job profile.");
      return;
    }
    if (!file && !cvText.trim()) {
      setError("Please upload a CV file or paste CV text.");
      return;
    }
```

FormData built today (`AnalysisForm.tsx:43-51`) sends only `job_profile_id`, optional `first_name`/`last_name`, and `file` XOR `cv_text`. **No** `custom_requirements`/`project_context` are sent.

**Reusable UI patterns (no shadcn form primitives exist):** `src/components/ui/` contains only `button.tsx` and `LibBadge.astro` — there is **no** shadcn `Input`/`Label`/`Textarea`. The closest existing multi-line pattern is the **collapsible paste-fallback textarea** in `FileUpload.tsx:104-123` (toggle button + conditional `<textarea rows>`), which is the natural template for the new optional inputs. `FormField.tsx` is single-line + left-icon-padded (auth styling), a poor fit for multi-line. Shared cosmic-glass input class string to match:

```116:121:src/components/analysis/FileUpload.tsx
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 backdrop-blur-md focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/30 focus:outline-none"
```

### Layer 2 — API route + background pipeline (`src/pages/api/analysis/index.ts`)

This single file (262 lines) holds both the synchronous front-half and the `waitUntil` background pipeline (no separate pipeline module).

Form fields parsed today (`index.ts:34-39`): `job_profile_id`, `candidate_id`, `first_name`, `last_name`, `file`, `cv_text`. The **hard gate** S-02 must relax:

```41:46:src/pages/api/analysis/index.ts
  if (!jobProfileId || typeof jobProfileId !== "string") {
    return jsonResponse({ error: "job_profile_id is required", code: "BAD_REQUEST" }, 400);
  }
  if (!isUuid(jobProfileId)) {
    return jsonResponse({ error: "Invalid job_profile_id format", code: "BAD_REQUEST" }, 400);
  }
```

Analysis insert sets only four columns (no new fields, no null-profile path):

```138:151:src/pages/api/analysis/index.ts
  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .insert({
      user_id: userId,
      candidate_id: candidateId,
      job_profile_id: jobProfileId,
      status: "parsing",
    })
    .select("id")
    .single();
```

The background pipeline (inside `cfCtx.waitUntil`, `index.ts:182-257`) **always** fetches a profile row and feeds it to the prompt builder:

```208:223:src/pages/api/analysis/index.ts
        const { data: profile } = await supabase
          .from("job_profiles")
          .select("name, description, expected_skills")
          .eq("id", capturedJobProfileId)
          .single();

        if (!profile) throw new Error("Job profile not found");

        const userPrompt = buildAnalysisPrompt(anonymizedText, profile);

        const { data: llmResult } = await completeLLM({
          model: llmModel,
          schema: AnalysisResponseSchema,
          prompt: userPrompt,
          systemPrompt: QA_ANALYSIS_SYSTEM_PROMPT,
        });
```

S-02 must branch this: when there is no `job_profile_id`, build the prompt from `custom_requirements` instead of fetching a profile. The closure captures `capturedJobProfileId` (`index.ts:166-169`); it'd similarly capture the custom requirements / project context.

**Response/retry surfacing.** `GET /api/analysis/[id]` selects `job_profile_id, candidate_id` but **omits** `custom_requirements`/`project_context` (`[id]/index.ts:25-30`), and conditionally fetches the profile (`null` when `job_profile_id` is null, already handled at `[id]/index.ts:44-50`). The results UI shows `"Unknown profile"` for null profiles (`AnalysisResults.tsx:61`) and the retry flow re-POSTs `job_profile_id` (`AnalysisView.tsx:73-82`) — both need a custom-requirements-aware path.

**API conventions:** `jsonResponse(body, status)` (`src/lib/api/response.ts:1-6`); errors are `{ error, code }` with codes like `UNAUTHORIZED`/`BAD_REQUEST`/`NOT_FOUND`/`DB_ERROR`/`SERVICE_UNAVAILABLE`. Auth via `context.locals.user`; Supabase via `createClient(headers, cookies)` (returns `null` → 503). Background work via `context.locals.cfContext.waitUntil` (typed in `src/env.d.ts:1-6`).

### Layer 3 — Prompt builder + schema (`src/lib/analysis/`)

`buildAnalysisPrompt` is profile-shaped only — no notion of custom requirements or project context:

```32:51:src/lib/analysis/prompt.ts
export function buildAnalysisPrompt(
  anonymizedText: string,
  profile: { name: string; description: string; expected_skills: unknown },
): string {
  const skillsJson =
    typeof profile.expected_skills === "string"
      ? profile.expected_skills
      : JSON.stringify(profile.expected_skills, null, 2);

  return `Analyze the following CV against the provided QA job profile. Generate interview questions following the system instructions.

JOB PROFILE: ${profile.name}
${profile.description}

EXPECTED SKILLS:
${skillsJson}

CV (anonymized):
${anonymizedText}`;
}
```

The system prompt (`QA_ANALYSIS_SYSTEM_PROMPT`, `prompt.ts:1-30`) frames the task as "CV against a specific QA job profile" — it would benefit from a sentence acknowledging custom requirements / project context when present. The response schema (`schema.ts:1-21`) — `match_summary` + `questions[]{category, question, rationale, suggested_answer}` — **does not need to change**; S-02 changes inputs, not outputs.

A grep confirms `custom_requirements`/`project_context` appear **only** in `src/db/database.types.ts` — nowhere in `prompt.ts`, `index.ts`, or any component.

### Layer 4 — Database (already S-02-ready, no migration needed)

`analyses` was created in F-01 with the S-02 columns already present and `job_profile_id` nullable:

```35:47:supabase/migrations/20260527185003_data_schema_and_rls.sql
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  job_profile_id uuid references public.job_profiles (id) on delete set null,
  custom_requirements text,
  project_context text,
  status text not null default 'pending',
  match_summary text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
```

Generated types already expose all three as `string | null` on Row/Insert/Update (`src/db/database.types.ts:13-54`). RLS on `analyses` covers full CRUD including UPDATE from day one (`20260527185003_data_schema_and_rls.sql:147-160`, DELETE in `20260530150600_analysis_delete_rls.sql:8-10`), so persisting the new columns needs no new policy.

**Optional schema hardening (decision for planning):** a DB `CHECK (job_profile_id IS NOT NULL OR custom_requirements IS NOT NULL)` would enforce the XOR at the data layer. It must be **additive/backward-compatible** per AGENTS.md; existing rows all have a `job_profile_id`, so the constraint would not break them. This is a judgment call — app-level validation may be sufficient for MVP.

### Tests that will need updating

- `tests/lib/analysis/prompt.test.ts` — 6 `buildAnalysisPrompt` assertions + 3 system-prompt assertions encode the current contract (sections `JOB PROFILE:`, `EXPECTED SKILLS:`, `CV (anonymized):`). Extending the signature requires updating these and adding custom-requirements/project-context cases.
- `tests/lib/anonymizer/boundary.test.ts` — calls `buildAnalysisPrompt` with a profile fixture; a signature change ripples here. **Critical**: this is the PII-leak boundary test — any new field interpolated into the prompt (custom requirements, project context) is recruiter-entered free text and must be covered by the no-raw-PII-leak assertion family.
- `tests/lib/analysis/schema.test.ts` — likely unchanged (output schema is stable).
- No component/API-route tests exist (S-01 scope note), so frontend changes won't have automated coverage unless that infra is added.

## Code References

- `src/components/analysis/AnalysisForm.tsx:19-25` — form state (no custom-requirements/project-context yet)
- `src/components/analysis/AnalysisForm.tsx:31-38` — client validation hard-requiring a profile
- `src/components/analysis/AnalysisForm.tsx:43-51` — FormData construction (fields sent today)
- `src/components/analysis/FileUpload.tsx:104-123` — collapsible textarea pattern to reuse
- `src/components/analysis/ProfileSelector.tsx:8-39` — profile `<select>` (required)
- `src/components/analysis/AnalysisResults.tsx:61` — `"Unknown profile"` fallback for null profile
- `src/components/analysis/AnalysisView.tsx:73-82` — retry path re-sends `job_profile_id`
- `src/pages/dashboard/new.astro:8-15` — server-side profile load + island props
- `src/pages/api/analysis/index.ts:34-39` — form field parsing
- `src/pages/api/analysis/index.ts:41-46` — `job_profile_id` hard-required gate (S-02 must relax)
- `src/pages/api/analysis/index.ts:138-151` — analyses insert (only 4 columns set)
- `src/pages/api/analysis/index.ts:208-223` — profile fetch → `buildAnalysisPrompt` → `completeLLM`
- `src/pages/api/analysis/[id]/index.ts:25-50` — results select (omits new columns; conditional profile fetch)
- `src/pages/api/profiles.ts:14-26` — profile list for dropdown
- `src/lib/analysis/prompt.ts:1-30` — system prompt
- `src/lib/analysis/prompt.ts:32-51` — `buildAnalysisPrompt` (profile-only)
- `src/lib/analysis/schema.ts:1-21` — response schema (stable, no input types)
- `src/lib/api/response.ts:1-6` — `jsonResponse` helper
- `src/db/database.types.ts:13-69` — `analyses` Row/Insert/Update + FK relationships
- `supabase/migrations/20260527185003_data_schema_and_rls.sql:35-47` — `analyses` CREATE (columns already present)
- `supabase/migrations/20260527185003_data_schema_and_rls.sql:147-160` — `analyses` SELECT/INSERT/UPDATE RLS
- `package.json:14` — `db:types` generation script

## Architecture Insights

- **The S-01 plan intentionally pre-provisioned S-02.** F-01 created `custom_requirements`/`project_context`/nullable `job_profile_id`; the S-01 plan's "What We're NOT Doing" explicitly deferred FR-003/FR-005 with the note "`analyses.project_context` stays null." So S-02 is the planned completion of an already-shaped data model — a low-risk, additive feature (matches the roadmap's "Low risk" rating).
- **Profile-as-scaffold, custom-as-escape-hatch.** Per PRD FR-002/FR-003 Socratic notes, predefined profiles are a starting scaffold and custom text is the escape hatch for non-standard positions. This supports allowing **both** a profile and custom requirements together (profile + override), not strictly one or the other — a planning decision worth making explicit.
- **Pipeline is monolithic.** The whole analysis pipeline lives inside one `waitUntil` IIFE in `index.ts`. Adding a profile-vs-custom branch increases this file's complexity; extracting prompt-input assembly into a small helper (e.g. resolve `{ profileRow | customRequirements } + projectContext` → prompt) would keep it testable and is consistent with S-01's "pure-logic modules" convention.
- **PII boundary discipline.** Custom requirements and project context are recruiter-entered (not candidate PII), but they get interpolated into the LLM prompt that crosses the org boundary. They should be treated as free text in the prompt; the existing `boundary.test.ts` family is the right place to assert no candidate PII leaks once the prompt builder changes.

## Historical Context (from prior changes)

- `context/archive/2026-05-27-first-gated-generation/plan.md:55-57` — S-01 explicitly scoped OUT FR-003 (custom requirements) and FR-005 (project context), stating `analyses.project_context` stays null. S-02 is the direct follow-up.
- `context/archive/2026-05-27-first-gated-generation/plan.md:34` — note that the `analyses` UPDATE RLS restricts rows (own only) but **not columns**; pipeline UPDATEs must target explicit columns to avoid clobbering `user_id`/`candidate_id`. Applies if S-02 adds any UPDATE writing the new fields.
- `context/foundation/lessons.md` (Supabase writes lesson) — every Supabase write needs a matching RLS policy for that exact op AND a destructured `{ error }` check. `analyses` INSERT/UPDATE policies already exist; the lesson still applies to any new write path persisting `custom_requirements`/`project_context`.
- `context/foundation/roadmap.md:105-115` — S-02 spec, "Low risk," prerequisite S-01 (now archived/done), parallel with S-03/S-04.

## Related Research

- `context/archive/2026-05-27-first-gated-generation/research.md` — the upstream S-01 research that shaped the pipeline, anonymizer, and prompt this change extends.

## Open Questions

1. **Profile vs. custom: XOR or both?** Should the recruiter pick exactly one of {predefined profile, custom requirements}, or be allowed to supply a profile AND custom override text? PRD framing leans toward "both allowed" (profile = scaffold, custom = escape hatch). Decide before planning the form UX and the API validation rule.
2. **DB CHECK constraint?** Add `CHECK (job_profile_id IS NOT NULL OR custom_requirements IS NOT NULL)` for data-layer enforcement, or rely on app-level validation only? (Constraint is backward-compatible with existing rows.)
3. **Custom-requirements prompt shape.** When no profile is selected, how should the prompt frame the custom requirements — as a free-text "JOB REQUIREMENTS" block replacing the `JOB PROFILE/EXPECTED SKILLS` sections? And does the system prompt need adjusting away from "specific QA job profile" wording?
4. **Project context placement.** Where in the prompt should project context (domain/methodology/tech) sit — a dedicated `PROJECT CONTEXT:` section that applies whether or not a profile is used? (FR-005 says it calibrates relevance regardless of profile vs. custom.)
5. **Results + retry surfacing.** Should `GET /api/analysis/[id]` return `custom_requirements`/`project_context` (for the results header and the retry flow), and how should `AnalysisResults`/`AnalysisView` display a custom-requirements analysis instead of `"Unknown profile"`?
6. **Input length limits.** `cv_text` has `MAX_CV_TEXT_CHARS`; should custom requirements / project context get their own caps (client + server) to bound prompt size?
