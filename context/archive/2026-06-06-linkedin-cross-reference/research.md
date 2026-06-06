---
date: 2026-06-06T17:55:00+02:00
researcher: dczaj
git_commit: 1f24c03e074a217ffe37e9e8ec31bb8fd0a5b7ee
branch: main
repository: ai-recruitment-helper
topic: "LinkedIn cross-reference (S-03): paste LinkedIn profile to detect CV↔LinkedIn contradictions"
tags: [research, codebase, analysis-pipeline, prompt, anonymizer, schema, FR-004]
status: complete
last_updated: 2026-06-06
last_updated_by: dczaj
---

# Research: LinkedIn cross-reference (S-03)

**Date**: 2026-06-06T17:55:00+02:00
**Researcher**: dczaj
**Git Commit**: 1f24c03e074a217ffe37e9e8ec31bb8fd0a5b7ee
**Branch**: main
**Repository**: ai-recruitment-helper

## Research Question

What does it take to implement roadmap slice **S-03 (`linkedin-cross-reference`, FR-004)** — let the recruiter optionally paste a LinkedIn profile (text or link) so the analysis surfaces **contradictions between the CV and LinkedIn** (a second source of truth)? Where does the current S-01/S-02 pipeline (form → API → anonymize → prompt → DB) need to change, and what is already in place?

## Summary

**The database is already S-03-ready, but the privacy boundary is not.** The F-01 migration created `candidates.linkedin_text text` (nullable) on day one — LinkedIn lives on the **candidate** (next to `cv_text`), not on `analyses`. So, like S-02, the persistence layer needs **no migration**. S-03 is application-layer wiring across four layers:

1. **Frontend** (`AnalysisForm.tsx`): add an optional collapsible LinkedIn textarea (the same toggle pattern as Custom Requirements / Project Context), with a client cap.
2. **API + pipeline** (`src/pages/api/analysis/index.ts`): parse/trim/cap a `linkedin_text` form field, persist it on the **candidate** insert, capture it for the background closure, and feed it to the prompt.
3. **Anonymization** (`src/lib/anonymizer/`): **the critical decision.** LinkedIn text is **candidate PII** (unlike S-02's recruiter-supplied role text). It must cross the org boundary anonymized. But the current anonymizer is **CV-format-tuned** and will under-anonymize LinkedIn text (see below).
4. **Prompt** (`src/lib/analysis/prompt.ts`): add an anonymized `LINKEDIN (anonymized)` section and instruct the model to cross-reference it against the CV for contradictions. The response schema (`schema.ts`) already has a `contradictions` category — **no schema change**.

**The single biggest structural difference from S-02:** S-02's new inputs (`custom_requirements`, `project_context`) are *recruiter-supplied role descriptions* — treated as untrusted instruction-data and **never anonymized**. LinkedIn text is the **opposite**: it is *candidate personal data* that must be anonymized exactly like the CV before it reaches the LLM. The form copy for the S-02 fields even says "do not paste candidate personal data here" — LinkedIn is precisely candidate personal data, so it must travel a different path (through `anonymizeCV`, not through the recruiter-text fence).

**The central risk (matches the roadmap's "Medium" rating):** the anonymizer is tuned to CV layout. `findCandidateName` scans the first 10 lines for a Title-Case name (LinkedIn export usually does have the name near the top — partial coverage), and `findCompanyNames` only detects companies from pipe-delimited `Title | Company | Dates` lines (`section-rules.ts:48-73`) — a format **LinkedIn text does not use**. Emails/phones/URLs are format-agnostic and work. Net effect: running raw LinkedIn text through `anonymizeCV` as-is will likely **leak company names and possibly the candidate name**, breaking the privacy-preserving guarantee that is the product's core differentiator. The PII-boundary test (`tests/lib/anonymizer/boundary.test.ts`) must be extended to cover a LinkedIn fixture, and the anonymizer likely needs LinkedIn-aware extraction (or a shared-PII-map strategy keyed off the CV).

## Detailed Findings

### Database — already provisioned (no migration needed)

`candidates.linkedin_text` exists from F-01:

```26:33:supabase/migrations/20260527185003_data_schema_and_rls.sql
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text,
  cv_text text,
  linkedin_text text,
  created_at timestamptz not null default now()
);
```

- Generated types already expose it as `string | null` on Row/Insert/Update (`src/db/database.types.ts:121,132,143`).
- The **candidate UPDATE RLS policy already exists** (`20260606130000_candidates_update_rls.sql:10-13`) — added so the pipeline could persist `pii_map`. The same policy authorizes persisting `linkedin_text` if written on UPDATE, though the natural place is the **INSERT** at `index.ts:157-167` (next to `cv_text`).
- **Modeling implication:** because `linkedin_text` is on `candidates`, it is a property of the candidate (re-used across analyses and on retry) — exactly like `cv_text`. The retry path reads stored CV from the candidate (`index.ts:94-111`); LinkedIn would come along for free if stored there.

### Layer 1 — Frontend form (`src/components/analysis/AnalysisForm.tsx`)

The form already has the exact UI pattern to copy. S-02 added two collapsible textareas with a shared `TEXTAREA_CLASS`, toggle state, and a client-side cap:

```122:148:src/components/analysis/AnalysisForm.tsx
      <div className="space-y-3">
        <label className="block text-sm font-medium text-blue-100/80">Custom Job Requirements</label>
        <button
          type="button"
          onClick={() => {
            setCustomRequirementsOpen((o) => !o);
          }}
          className="text-xs text-blue-100/50 transition-colors hover:text-blue-100/80"
        >
          {customRequirementsOpen ? "▲ Hide" : "▼ Add custom job requirements"}
        </button>
        {customRequirementsOpen && (
          <textarea
            rows={6}
            ...
```

- Add `linkedin` state + `linkedinOpen` toggle, a new textarea, and append `linkedin_text` to `FormData` when non-empty (`AnalysisForm.tsx:62-72`).
- **Copy must differ from the S-02 fields.** The S-02 fields warn "do not paste candidate personal data here (it is sent to the AI without anonymization)" (`:144-147`, `:172-175`). The LinkedIn field is the *opposite* — it is candidate data and **will** be anonymized; the copy should say so.
- LinkedIn is **purely optional and additive** — it does not interact with the profile-OR-custom-requirements gate (`:41-44`). No validation-gate change needed beyond an optional length cap.

### Layer 2 — API route + background pipeline (`src/pages/api/analysis/index.ts`)

Field-parse / trim / cap follows the S-02 precedent exactly (`index.ts:36-83`). Then:

- **Persist on candidate INSERT** (not on analyses), next to `cv_text`:

```157:167:src/pages/api/analysis/index.ts
    const { data: candidate, error: candidateError } = await supabase
      .from("candidates")
      .insert({
        user_id: userId,
        cv_text: cvText,
        file_name: fileName,
        first_name: resolvedFirst,
        last_name: resolvedLast,
      })
      .select("id")
      .single();
```

- **Retry path** reads stored CV from the candidate (`index.ts:94-111`); it must also read stored `linkedin_text` so a retry re-cross-references without re-paste. Add `linkedin_text` to the `.select("cv_text, file_name")` at `:98`.
- **Capture for the background closure** alongside the existing captures (`index.ts:206-209`).
- **Anonymize + feed to prompt** in the `waitUntil` block. The pipeline currently anonymizes only the CV (`index.ts:236`) and builds the prompt at `:262-267`. S-03 must anonymize the LinkedIn text too and pass it into `buildAnalysisPrompt`.

```232:267:src/pages/api/analysis/index.ts
        // Stage: anonymizing
        await setStatus({ status: "anonymizing" });

        const { anonymizedText, piiMap } = anonymizeCV(capturedCvText);
        ...
        const userPrompt = buildAnalysisPrompt({
          anonymizedText,
          profile,
          customRequirements: capturedCustomRequirements,
          projectContext: capturedProjectContext,
        });
```

- **API conventions** (unchanged, reuse): `jsonResponse(body, status)` (`src/lib/api/response.ts`), `{ error, code }` error bodies, `MAX_*` caps in `src/lib/analysis/limits.ts`, background work via `cfContext.waitUntil`.

### Layer 3 — Anonymization (the load-bearing decision) (`src/lib/anonymizer/`)

`anonymizeCV(text)` (`index.ts:41-132`) composes format-agnostic matchers (emails, phones, URLs — `patterns.ts`) with **CV-layout-specific** ones (`section-rules.ts`):

- `findCandidateName` scans the **first 10 lines** for a 2–4 Title-Case-word line (`section-rules.ts:10-40`). LinkedIn pasted text often leads with the name → **partial** coverage, but fragile.
- `findCompanyNames` only matches **pipe-delimited** `Title | Company | Dates` experience lines (`section-rules.ts:48-73`). LinkedIn text is **not** pipe-delimited → companies in LinkedIn text will **not** be detected → **PII leak**.
- The URL matcher already targets `linkedin.com` URLs (`patterns.ts:50`), so a pasted LinkedIn profile URL is anonymized.

**Design options for planning (pick one):**
1. **Shared PII map from the CV.** Anonymize the CV first, then replace the *same* detected names/companies/emails/phones inside the LinkedIn text using the CV-derived `piiMap` (find-and-replace known values). Pro: consistent placeholders across both sources (so the LLM sees `[COMPANY_1]` in both and can actually detect a contradiction); catches anything already found in the CV. Con: misses entities that appear **only** in LinkedIn (e.g. a company on LinkedIn but omitted from the CV — which is itself a contradiction signal).
2. **LinkedIn-aware extraction.** Add LinkedIn-format section rules (its own name/company/title heuristics). More robust but more code and more fragile to LinkedIn's varied paste formats.
3. **Hybrid.** Shared-map pass (option 1) + a generic capitalized-entity sweep over LinkedIn to catch leftover proper nouns. Safest for the privacy boundary; risks over-redaction.

The "shared PII map" angle matters for *function*, not just privacy: cross-referencing only works if the **same** real-world entity maps to the **same** placeholder in both texts. Two independent anonymization passes would assign `[COMPANY_1]` to different companies in each source and destroy the model's ability to compare them. **This is the key architectural insight for the plan.**

### Layer 4 — Prompt builder + schema (`src/lib/analysis/`)

`buildAnalysisPrompt` is an options object that renders only non-empty sections, CV always last (`prompt.ts:45-90`). S-03 adds an optional `linkedinText` field and a `LINKEDIN (anonymized):` section. Placement: after `CV (anonymized):` (both are candidate data; keep them adjacent), or a combined "candidate sources" block.

- The system prompt already names **`contradictions`** as an anomaly category — currently scoped to *internal* CV inconsistencies (`prompt.ts:7`). S-03 should broaden that sentence to include **cross-source** contradictions (CV vs. LinkedIn) when LinkedIn is present.
- **Do NOT fence LinkedIn like the recruiter fields.** The `FENCE_OPEN/CLOSE` wrapper (`prompt.ts:41-43`) exists to neutralize prompt-injection in *recruiter-supplied* text. LinkedIn is candidate data presented as content to analyze, parallel to the CV (which is not fenced). Treat it like the CV.
- **Response schema unchanged.** `AnalysisResponseSchema` (`schema.ts:16-19`) = `match_summary` + `questions[]`, and `contradictions` is already a valid `AnalysisCategory` (`schema.ts:3`). S-03 changes inputs, not outputs.

### Layer 5 — Results + retry surfacing (`src/components/analysis/`)

- `GET /api/analysis/[id]` returns analysis fields + candidate `{ id, file_name }` (`[id]/index.ts:44,67`). To show "LinkedIn cross-referenced" in the results header, either add `linkedin_text` (or a boolean `has_linkedin`) to the candidate select at `:44` and surface it in `AnalysisResults`. Surfacing is **optional polish**, not required for the core loop.
- **Retry** (`AnalysisView.tsx:73-101`) re-POSTs `candidate_id` + the requirement fields. Because LinkedIn is stored on the candidate, retry needs no new field in the POST **iff** the API retry path re-reads `linkedin_text` from the candidate (see Layer 2). This keeps retry "no re-upload, no re-paste."

### Tests that will need updating

- **`tests/lib/anonymizer/boundary.test.ts`** — the PII-leak gate. Must gain a LinkedIn fixture asserting no raw candidate PII (name, companies, email, phone) survives into the prompt when `linkedinText` is populated. This is the **most important** new test.
- **`tests/lib/analysis/prompt.test.ts`** — add cases: `LINKEDIN (anonymized):` appears only when passed; CV stays present; section ordering holds.
- **`tests/lib/anonymizer/index.test.ts`** / **`patterns.test.ts`** — already reference `linkedin` (URL anonymization). New LinkedIn-aware anonymization (if chosen) needs direct unit coverage here.
- No component/API-route test infra exists (S-01/S-02 scope note) — form/route changes are manually verified.

## Code References

- `supabase/migrations/20260527185003_data_schema_and_rls.sql:26-33` — `candidates` CREATE (`linkedin_text` already present)
- `supabase/migrations/20260606130000_candidates_update_rls.sql:10-13` — candidate UPDATE RLS (authorizes pipeline writes)
- `src/db/database.types.ts:121,132,143` — `linkedin_text: string | null` on Row/Insert/Update
- `src/components/analysis/AnalysisForm.tsx:122-176` — collapsible-textarea pattern to copy; S-02 PII-warning copy to invert
- `src/components/analysis/AnalysisForm.tsx:62-72` — FormData construction
- `src/pages/api/analysis/index.ts:36-83` — field parse/trim/cap precedent (S-02)
- `src/pages/api/analysis/index.ts:94-111` — retry path (reads stored CV; add `linkedin_text`)
- `src/pages/api/analysis/index.ts:157-167` — candidate INSERT (persist `linkedin_text` here)
- `src/pages/api/analysis/index.ts:206-209` — background-closure captures
- `src/pages/api/analysis/index.ts:232-267` — anonymize → buildAnalysisPrompt (anonymize LinkedIn here)
- `src/lib/anonymizer/index.ts:41-132` — `anonymizeCV` (CV-tuned); returns `piiMap` reusable for LinkedIn
- `src/lib/anonymizer/section-rules.ts:10-40` — `findCandidateName` (first-10-lines heuristic)
- `src/lib/anonymizer/section-rules.ts:48-73` — `findCompanyNames` (pipe-delimited only — fails on LinkedIn)
- `src/lib/anonymizer/patterns.ts:48-51` — URL matcher (already targets `linkedin.com`)
- `src/lib/analysis/prompt.ts:1-33` — system prompt (`contradictions` category at `:7`)
- `src/lib/analysis/prompt.ts:41-90` — `buildAnalysisPrompt` options object + recruiter-text fence
- `src/lib/analysis/schema.ts:3,16-19` — `contradictions` category + response schema (unchanged)
- `src/lib/analysis/limits.ts:1-2` — `MAX_*` cap pattern (add `MAX_LINKEDIN_TEXT_CHARS`)
- `src/pages/api/analysis/[id]/index.ts:44,67` — candidate select + response (for optional surfacing)
- `src/components/analysis/AnalysisView.tsx:73-101` — retry path
- `tests/lib/anonymizer/boundary.test.ts:15-35` — PII boundary test (extend for LinkedIn)

## Architecture Insights

- **F-01 pre-provisioned S-03, just like S-02.** `candidates.linkedin_text` was created up front; the S-01 plan deferred FR-004. S-03 is the planned completion of an already-shaped data model → **no migration**, low persistence risk.
- **LinkedIn is candidate data, not recruiter data — this flips the privacy model vs. S-02.** S-02's `custom_requirements`/`project_context` are recruiter-supplied, fenced, never anonymized. LinkedIn must be anonymized like the CV. Conflating the two paths would leak candidate PII across the org boundary — the exact failure the product is built to prevent.
- **Cross-referencing requires a shared placeholder space.** The same real-world company/person must map to the same placeholder in both CV and LinkedIn, or the LLM cannot detect contradictions. This argues for anonymizing LinkedIn **using the CV's `piiMap`** rather than as an independent pass. This is both a correctness and a privacy requirement.
- **The anonymizer is the load-bearing, highest-risk component.** It is intentionally CV-layout-specific (`section-rules.ts`). Feeding differently-structured LinkedIn text through it without adaptation silently under-redacts (companies especially). The boundary test is the safety net and must be extended before this ships.
- **Pipeline is monolithic** (one `waitUntil` IIFE in `index.ts`). Adding a second anonymization + a prompt section grows the file; extracting a small "assemble candidate sources → anonymized prompt inputs" helper would keep it testable, consistent with the codebase's pure-logic-module convention.

## Historical Context (from prior changes)

- `context/archive/2026-06-06-extended-analysis-inputs/plan.md` — S-02 plan; the direct template for S-03's layered wiring (prompt → API → form → results/retry). Its "What We're NOT Doing" explicitly excluded "LinkedIn cross-reference (S-03)".
- `context/archive/2026-06-06-extended-analysis-inputs/plan-brief.md` — established the fence pattern for recruiter-supplied text and the `limits.ts` caps module S-03 extends.
- `context/archive/2026-05-27-first-gated-generation/research.md` — upstream S-01 research on the anonymizer + pipeline this change extends.
- `context/foundation/lessons.md` — "Supabase writes need a matching RLS policy AND an error check." The candidate UPDATE policy now exists; if S-03 persists `linkedin_text` via UPDATE (not INSERT), confirm the policy covers it and destructure `{ error }`. Persisting on INSERT (recommended) sidesteps this.
- `context/foundation/roadmap.md:117-128` — S-03 spec, **Medium** risk ("second source of truth", unstructured LinkedIn data), prerequisite S-01 (done), parallel with S-02/S-04/S-05/S-06.
- `context/foundation/prd.md:63-64` — FR-004 (must-have, optional input; Socratic note flags unstructured-LinkedIn parsing risk).

## Related Research

- `context/changes/extended-analysis-inputs/research.md` — sibling S-02 research; same pipeline, mirror structure.
- `context/archive/2026-05-27-first-gated-generation/research.md` — S-01 anonymizer + pipeline foundation.

## Open Questions

1. **Anonymization strategy (the decision).** Shared-CV-piiMap replacement, LinkedIn-aware extraction, or hybrid? (See Layer 3.) This drives correctness (cross-reference works only with shared placeholders) *and* the privacy guarantee. Recommend shared-map-first + a generic proper-noun sweep for LinkedIn-only entities.
2. **Entities present only in LinkedIn.** A company on LinkedIn but absent from the CV is both (a) a contradiction signal worth surfacing and (b) un-anonymizable via the CV's map. How to redact it without losing the contradiction signal? (Generic placeholder like `[LINKEDIN_COMPANY_n]` that still preserves "an extra employer exists"?)
3. **Text vs. link.** FR-004 says "text **or link**." Do we accept only pasted text in MVP (a URL can't be fetched server-side reliably / ToS concerns), or also a URL that we just store/display without scraping? Recommend text-only ingestion for MVP; treat a pasted URL as plain text (the URL matcher anonymizes it anyway).
4. **Prompt placement & framing.** `LINKEDIN (anonymized):` as its own section after the CV, or a merged "candidate sources" block? And exactly how to broaden the `contradictions` category sentence in the system prompt to cover cross-source mismatches only when LinkedIn is present.
5. **Length cap.** Add `MAX_LINKEDIN_TEXT_CHARS` to `limits.ts` (client + server) to bound prompt/token size, mirroring `MAX_CV_TEXT_CHARS`. What value? (LinkedIn exports can be long; pick a CV-comparable bound.)
6. **Results surfacing scope.** Is showing "LinkedIn cross-referenced" (and/or contradiction emphasis) in `AnalysisResults` in-scope for S-03, or deferred polish? The core loop works without it.
