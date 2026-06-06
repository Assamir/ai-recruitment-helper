# LinkedIn Cross-Reference (S-03) Implementation Plan

## Overview

Add an optional LinkedIn input to the analysis flow so recruiters can supply a candidate's
LinkedIn profile as a **second source of truth**, letting the LLM detect contradictions between
the CV and LinkedIn (FR-004, roadmap S-03). The recruiter may either **paste profile text** or
**provide a profile link**; links are scraped server-side using **Cloudflare Browser Run +
Playwright** (authenticated session, navigate, expand all sections, extract text).

**Key product decision (locked):** LinkedIn is treated as a public, candidate-supplied second
source. When LinkedIn is present, **both the CV and LinkedIn are sent to the LLM un-anonymized**
so the model can compare real entities directly (cross-referencing requires both sources to share
the same representation). The existing **CV-only path keeps its anonymization unchanged.**

## Current State Analysis

The S-01/S-02 pipeline is: form → `POST /api/analysis` → (sync front-half: parse CV, create
`candidates` + `analyses` rows) → background `waitUntil` IIFE (anonymize CV → build prompt →
LLM → persist questions + summary). LinkedIn slots into this with **no migration**:

- `candidates.linkedin_text text` (nullable) already exists from F-01 (`database.types.ts:121,132,143`).
- The candidate **UPDATE** RLS policy exists; persisting `linkedin_text` on the candidate **INSERT**
  (`index.ts:157-167`) sidesteps the RLS/error-check lesson entirely.
- The form has a proven collapsible-textarea pattern (`AnalysisForm.tsx:122-176`) and `limits.ts` caps.
- `buildAnalysisPrompt` renders only non-empty sections, CV last (`prompt.ts:45-90`); `contradictions`
  is already a valid `AnalysisCategory` (`schema.ts:3`) — **response schema unchanged**.
- The retry path re-reads stored CV from the candidate (`index.ts:94-111`).
- `anonymizeCV` is **CV-layout-tuned** — but under the "both raw when LinkedIn present" decision we do
  **not** run LinkedIn through it, so the anonymizer's LinkedIn-format weakness is moot.

**What does not exist yet:** any browser-automation capability. There is no Browser Run binding in
`wrangler.jsonc`, no `@cloudflare/playwright` dependency, no Durable Object, and `App.Locals`
(`src/env.d.ts`) exposes only `cfContext.waitUntil` — not the Cloudflare runtime `env` needed to reach
a `BROWSER` binding. `@playwright/test` is a dev-only E2E dependency (not the Workers Playwright client).

### Key Discoveries

- `src/pages/api/analysis/index.ts:36-83` — field parse/trim/cap precedent (mirror for `linkedin_text` + `linkedin_url`).
- `src/pages/api/analysis/index.ts:206-236` — background-closure captures + the single point where CV is anonymized; conditional-anonymization toggle lands here.
- `src/lib/analysis/prompt.ts:41-90` — `FENCE_OPEN/CLOSE` is for **recruiter** text only; LinkedIn is candidate data → **not fenced**, parallel to the CV.
- `src/lib/analysis/prompt.ts:7` — `contradictions` category sentence is currently CV-internal; broaden to cross-source when LinkedIn present.
- `wrangler.jsonc:6-9` — Free-tier note; the analysis pipeline already requires the **Workers Paid plan**, and Browser Run also requires Paid.
- `src/env.d.ts:1-6` — `App.Locals` must gain typed access to `runtime.env` (the `@astrojs/cloudflare` adapter populates `locals.runtime`).
- Browser Run supports the **Playwright** binding (`@cloudflare/playwright`, `env.BROWSER`) with optional Durable-Object session reuse (Cloudflare docs, "Browser Run / Playwright").

## Desired End State

A recruiter submitting an analysis can optionally (a) paste LinkedIn text, or (b) paste a LinkedIn
profile URL. When text is provided it is used directly; when only a URL is provided the pipeline
scrapes the profile via Browser Run. Either way, the LinkedIn content is stored on the candidate and
fed to the LLM **alongside the un-anonymized CV**, and the resulting analysis surfaces CV↔LinkedIn
contradictions. The results view shows a "LinkedIn cross-referenced" badge. Retry re-uses the stored
LinkedIn text (no re-paste, no re-scrape). When LinkedIn is **absent**, behavior is byte-for-byte the
current S-02 behavior (CV anonymized).

**Verification:** submit with pasted LinkedIn text → contradictions question references the mismatch;
submit with a LinkedIn URL → scrape succeeds and content reaches the prompt; submit a bad/blocked URL
→ analysis still completes from the CV (graceful degradation) with a visible note; submit with no
LinkedIn → CV is still anonymized (boundary test green).

## What We're NOT Doing

- **No schema/response change.** `contradictions` already exists; we change inputs, not outputs. No per-question source attribution (which finding came from LinkedIn vs CV).
- **No LinkedIn anonymization** and **no shared-PII-map reconciliation.** Explicitly out, per the "both raw" decision.
- **No migration.** `candidates.linkedin_text` already exists.
- **No bulk / multi-profile scraping**, no LinkedIn search, messaging, or connection features.
- **No Durable-Object session warm-pool as a hard requirement** (noted as an optional optimization; MVP uses a seeded session cookie + per-request browser session).
- **No automated captcha/2FA solving.** A challenged or expired session degrades to "paste the text instead."

## Implementation Approach

Phase 1 delivers the entire cross-reference value for **pasted text** with zero new infrastructure —
it is a near-mechanical mirror of the archived S-02 wiring, plus a conditional-anonymization toggle.
Phase 2 adds the **link → Browser Run scrape** capability (the heavy, higher-risk part) behind the
same `linkedin_text` data contract, so the scraper simply produces the text Phase 1 already consumes;
any scrape failure degrades gracefully to the Phase 1 (paste) behavior. Phase 3 surfaces the
cross-reference in the UI and confirms retry coherence.

## Critical Implementation Details

- **Conditional anonymization is the load-bearing behavioral change.** In the background pipeline,
  when resolved LinkedIn text is non-empty, send the **raw** CV (skip `anonymizeCV`) and the raw
  LinkedIn text to the prompt; when LinkedIn is empty, keep calling `anonymizeCV(capturedCvText)`
  exactly as today. `pii_map` is only written on the anonymized (LinkedIn-absent) path. This split
  must be unmistakable in code and covered by tests, because it changes the privacy posture.
- **Scraping runs inside the `waitUntil` background closure**, not the synchronous front-half — the
  60s pipeline budget already lives there, and the client polls for status. The "anonymizing" stage
  becomes a "fetching LinkedIn" + "preparing sources" step when a URL is present.
- **Browser Run needs the runtime `env`, not `cfContext`.** `context.locals.cfContext` only exposes
  `waitUntil`. Reaching `env.BROWSER` requires exposing `locals.runtime.env` (adapter-provided) and
  extending `App.Locals`. Treat `env.BROWSER` as possibly-undefined (mirror the `createClient()`/
  `getLLMConfig()` null-handling convention) so non-CF/dev runtimes fail gracefully.
- **LinkedIn anti-bot reality.** Authenticated scraping from Cloudflare egress IPs is frequently
  challenged (captcha/redirect to login). The scraper must classify outcomes (success, auth-wall,
  not-found, timeout) and the pipeline must never hard-fail the analysis on a scrape miss.

## Phase 1: Text-paste cross-reference core

### Overview

Wire `linkedin_text` end-to-end for the pasted-text case, including the conditional-anonymization
toggle and the prompt section, with full unit coverage. Ships standalone value.

### Changes Required:

#### 1. LinkedIn length cap

**File**: `src/lib/analysis/limits.ts`

**Intent**: Add a client+server cap for LinkedIn text, sized to match the CV cap (LinkedIn profiles
are CV-comparable in length).

**Contract**: Export `MAX_LINKEDIN_TEXT_CHARS` set to the same value as `MAX_CV_TEXT_CHARS`
(`src/lib/cv-parser/index`). Reference that constant rather than duplicating the number.

#### 2. Prompt builder — LinkedIn section + cross-source contradictions

**File**: `src/lib/analysis/prompt.ts`

**Intent**: Accept an optional `linkedinText` and render an **un-fenced** `LINKEDIN:` section
immediately after the `CV (anonymized):` block (both are candidate sources). Broaden the
`contradictions` system-prompt clause to include CV↔LinkedIn mismatches **only when LinkedIn is
present** (passed as a flag or inferred from the section being rendered).

**Contract**: `buildAnalysisPrompt` input gains `linkedinText?: string | null`. LinkedIn section is
NOT wrapped in `FENCE_OPEN/CLOSE`. The CV header label may change when LinkedIn is present (e.g.
`CV:` raw vs `CV (anonymized):`) — keep both sources' labels honest about their anonymization state.
The cross-source instruction text is appended to the user prompt (or conditionally to the system
prompt) and must not appear when `linkedinText` is empty.

#### 3. API route — parse, persist, capture, conditional anonymize, retry

**File**: `src/pages/api/analysis/index.ts`

**Intent**: Parse/trim/cap a `linkedin_text` form field (mirror the `custom_requirements` precedent);
persist it on the candidate INSERT next to `cv_text`; add it to the retry-path candidate SELECT;
capture it for the background closure; and apply the conditional-anonymization toggle before building
the prompt.

**Contract**:
- New field read: `formData.get("linkedin_text")` → trimmed/null, capped by `MAX_LINKEDIN_TEXT_CHARS` (400 on overflow, `{ error, code: "BAD_REQUEST" }`).
- Candidate INSERT (`:159-165`) gains `linkedin_text`.
- Retry SELECT (`:98`) becomes `"cv_text, file_name, linkedin_text"`; resolved LinkedIn text carried forward.
- Background closure: add `capturedLinkedinText`. In the `waitUntil` block, branch:
  - LinkedIn present → `const cvForPrompt = capturedCvText` (raw), `linkedinForPrompt = capturedLinkedinText` (raw); **skip** `anonymizeCV` and the `pii_map` write.
  - LinkedIn absent → existing `anonymizeCV(capturedCvText)` + `pii_map` write unchanged.
- `buildAnalysisPrompt({ anonymizedText: cvForPrompt, ..., linkedinText: linkedinForPrompt })`.

#### 4. Form — LinkedIn textarea + inverted PII copy

**File**: `src/components/analysis/AnalysisForm.tsx`

**Intent**: Add an optional collapsible LinkedIn textarea (copy the Custom Requirements pattern) with
a client-side cap, appending `linkedin_text` to `FormData` when non-empty. Copy must state the
**opposite** of the S-02 fields: this IS candidate data and, when provided, the CV and LinkedIn are
sent to the AI **un-anonymized** for comparison.

**Contract**: New `linkedin` + `linkedinOpen` state; `body.append("linkedin_text", …)` when non-empty;
client validation against `MAX_LINKEDIN_TEXT_CHARS`. LinkedIn is purely optional/additive — it does
not touch the profile-OR-custom-requirements gate (`:41-44`).

#### 5. Tests

**File**: `tests/lib/analysis/prompt.test.ts`, `tests/lib/anonymizer/boundary.test.ts`

**Intent**: Cover the new prompt section and lock the conditional-anonymization contract.

**Contract**:
- prompt.test.ts: `LINKEDIN:` section appears only when `linkedinText` passed; CV stays present; LinkedIn is **not** fenced (fence count unchanged when only LinkedIn added); cross-source contradictions wording present only when LinkedIn passed; section ordering holds.
- boundary.test.ts: the existing CV-only path still anonymizes (stays green). Add a case asserting that the prompt-building contract for "LinkedIn present" intentionally passes raw text (documents the privacy posture so it can't regress silently).

### Success Criteria:

#### Automated Verification:
- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:
- Pasting LinkedIn text that contradicts the CV (e.g. different employment dates/title) yields a `contradictions` question referencing the mismatch.
- With no LinkedIn provided, the prompt still shows `CV (anonymized):` and placeholders (no behavior change).
- Form copy clearly states LinkedIn will be sent un-anonymized when used.

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Link scraping via Browser Run + Playwright

### Overview

Add the ability to supply a LinkedIn **profile URL** that the pipeline scrapes server-side (Browser
Run + Playwright, authenticated session) into the same `linkedin_text` the prompt already consumes.
Any scrape failure degrades gracefully to the paste behavior.

### Changes Required:

#### 1. Browser Run binding + dependency + plan note

**File**: `wrangler.jsonc`, `package.json`

**Intent**: Declare the Browser Run binding and add the Workers Playwright client.

**Contract**: Add `"browser": { "binding": "BROWSER" }` to `wrangler.jsonc`; add `@cloudflare/playwright`
to dependencies. Document (comment near `wrangler.jsonc:6-9`) that Browser Run requires the Workers
Paid plan. Verify `nodejs_compat` + `@cloudflare/playwright` build on the adapter (`npm run build`).

#### 2. Runtime env exposure

**File**: `src/env.d.ts` (+ wherever `cfContext` is assembled)

**Intent**: Expose the Cloudflare runtime `env` so the pipeline can reach `env.BROWSER`.

**Contract**: Extend `App.Locals` with a typed `runtime.env` (including `BROWSER: Fetcher` and the
new LinkedIn session secret). Access defensively — `BROWSER` may be undefined in dev/non-CF runtimes;
when absent, the URL path degrades to "paste the text instead" rather than throwing.

#### 3. LinkedIn session secret

**File**: `.env.example`, deployment secrets, `astro.config.mjs` env schema

**Intent**: Provide an authenticated LinkedIn session for the scraper.

**Contract**: Add `LINKEDIN_SESSION_COOKIE` (the `li_at` cookie value, operator-seeded from a logged-in
browser) as an optional `server`/`secret` env field in `astro.config.mjs`, documented in `.env.example`,
set in prod via `npx wrangler secret put LINKEDIN_SESSION_COOKIE`. Treat missing cookie like missing
LLM config: the URL path is unavailable, paste still works.

#### 4. Scraper module

**File**: `src/lib/linkedin/scrape.ts` (+ `errors.ts`, `types.ts`)

**Intent**: Given a LinkedIn profile URL and the `BROWSER` binding + session cookie, launch a
Playwright session, authenticate via the seeded cookie, navigate to the profile, expand collapsible
sections ("see more" / "show all experience"), and extract readable profile text capped at
`MAX_LINKEDIN_TEXT_CHARS`.

**Contract**: Export `scrapeLinkedinProfile({ browser, url, sessionCookie }): Promise<{ text: string }>`.
Validate the URL is a `linkedin.com/in/...` profile. Classify failures with a typed error hierarchy:
`LinkedInAuthError` (login wall / challenge), `LinkedInNotFoundError`, `LinkedInTimeoutError`,
`LinkedInScrapeError` (generic). Pure DOM-extraction logic (HTML/text → cleaned profile text) lives in
a separately unit-testable function that does not depend on the live browser.

#### 5. Pipeline wiring with graceful fallback

**File**: `src/pages/api/analysis/index.ts`

**Intent**: Accept an optional `linkedin_url`; resolve LinkedIn text by preferring pasted text, else
scraping the URL inside the background closure; never hard-fail the analysis on a scrape miss.

**Contract**:
- Parse `linkedin_url` (validate format; reject non-LinkedIn hosts with `BAD_REQUEST`).
- In `waitUntil`, before prompt assembly: if `capturedLinkedinText` empty and a URL is present and `env.BROWSER` + cookie available → set a "fetching LinkedIn" status, call `scrapeLinkedinProfile`, and on success use the scraped text (and persist it to `candidates.linkedin_text` so retry needs no re-scrape).
- On any scraper error: log, record a non-fatal note (e.g. `analyses.error_message` is reserved for failures, so use a dedicated marker — see Phase 3), and continue with whatever LinkedIn text exists (possibly none → CV-only anonymized path).
- The conditional-anonymization toggle from Phase 1 keys off the **resolved** LinkedIn text (post-scrape).

#### 6. Form — link input

**File**: `src/components/analysis/AnalysisForm.tsx`

**Intent**: Offer a LinkedIn **URL** input alongside the textarea (either/or), appended as
`linkedin_url` when non-empty.

**Contract**: Add `linkedinUrl` state + input within the LinkedIn collapsible; client-validate it
looks like a LinkedIn profile URL; append `linkedin_url` to `FormData`. Copy notes that scraping is
best-effort and may ask the recruiter to paste text if it fails.

#### 7. Scraper tests

**File**: `tests/lib/linkedin/scrape.test.ts`

**Intent**: Unit-cover URL validation, the pure DOM/text-extraction function (fixture HTML →
expected cleaned text, length cap), and error classification — without a live browser.

**Contract**: Feed representative profile-HTML fixtures to the extraction function; assert section
expansion handling and the cap; assert each failure mode maps to the right typed error.

### Success Criteria:

#### Automated Verification:
- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes (with `@cloudflare/playwright` + browser binding): `npm run build`

#### Manual Verification:
- With `LINKEDIN_SESSION_COOKIE` set and a valid profile URL, the scrape returns profile text that reaches the prompt (verify via `wrangler dev --remote` and logs).
- A blocked/expired session or bad URL leaves the analysis completing from the CV alone, with a visible "LinkedIn unavailable" note — no failed analysis.
- Scraped text is persisted so a subsequent retry does not re-scrape.

**Implementation Note**: After Phase 2 automated verification passes, pause for manual confirmation (including a real `wrangler dev --remote` scrape attempt) before Phase 3.

---

## Phase 3: Results surfacing + retry coherence

### Overview

Surface that LinkedIn was cross-referenced, expose any "LinkedIn unavailable" note, and confirm
retry reuses stored LinkedIn text.

### Changes Required:

#### 1. GET response — LinkedIn presence + note

**File**: `src/pages/api/analysis/[id]/index.ts`

**Intent**: Tell the client whether LinkedIn was used and whether a scrape was attempted-but-failed.

**Contract**: Add LinkedIn presence to the candidate select (`:44` → include `linkedin_text`, or a
derived `has_linkedin` boolean) and include it in the response `candidate`. Surface the non-fatal
scrape note recorded in Phase 2 (a dedicated column/flag, not `error_message`).

#### 2. Results badge

**File**: `src/components/analysis/AnalysisView.tsx`, `src/components/analysis/AnalysisResults.tsx`

**Intent**: Show a "LinkedIn cross-referenced" badge when LinkedIn was used, and a subtle "LinkedIn
could not be fetched — paste text to include it" note when a scrape failed.

**Contract**: Thread `has_linkedin` (+ note) from `ResultData` into `AnalysisResults`; render a small
header badge. No schema/question changes.

#### 3. Retry coherence

**File**: `src/components/analysis/AnalysisView.tsx`

**Intent**: Confirm retry reuses stored LinkedIn text (Phase 1 already re-reads it server-side via the
candidate). No re-paste, no re-scrape.

**Contract**: Retry continues to POST `candidate_id`; the API retry path reads stored `linkedin_text`.
Verify no `linkedin_url` is needed on retry.

### Success Criteria:

#### Automated Verification:
- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:
- Results header shows the "LinkedIn cross-referenced" badge when LinkedIn was used.
- A failed scrape shows the "paste text" note and no badge.
- Retrying a LinkedIn-backed analysis reproduces the cross-reference with no re-paste/re-scrape.

**Implementation Note**: After Phase 3 automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests:
- `prompt.test.ts`: LinkedIn section presence/ordering, un-fenced, conditional cross-source wording.
- `boundary.test.ts`: CV-only path still anonymizes; "LinkedIn present → raw" contract documented.
- `scrape.test.ts`: URL validation, pure extraction (fixtures → cleaned text, length cap), error classification.

### Integration Tests:
- None automated for the API route/form (matches the S-01/S-02 scope note — manually verified).

### Manual Testing Steps:
1. Paste contradicting LinkedIn text → expect a `contradictions` question referencing it; confirm prompt shows raw CV + `LINKEDIN:`.
2. No LinkedIn → confirm CV anonymized (unchanged behavior), no badge.
3. Valid URL + seeded session (`wrangler dev --remote`) → scrape succeeds, text reaches prompt, persisted for retry.
4. Blocked/expired session or bad URL → analysis completes from CV; "LinkedIn unavailable" note shown.
5. Retry a LinkedIn-backed analysis → cross-reference reproduced without re-paste/re-scrape.

## Performance Considerations

Scraping runs inside the existing background `waitUntil` budget. Browser Run cold-start + page-load +
section expansion can add several seconds; keep a bounded per-scrape timeout well under the pipeline
budget and fall back to CV-only on timeout. Browser Run concurrency/rate limits apply per account
(Paid plan); high volume would need Queues/Workflows (out of scope for MVP).

## Migration Notes

No DB migration — `candidates.linkedin_text` already exists. If a non-fatal "scrape failed" marker
needs storage (Phase 2/3), prefer a nullable additive column or reuse an existing nullable field; any
new column must be additive/backward-compatible per the deploy rules in `AGENTS.md`.

## Open Risks & Assumptions

- **Privacy posture flips when LinkedIn is present.** CV + LinkedIn go to the LLM **raw**. This is
  safe only while `LLM_PROVIDER=lmstudio` (local/in-house). With `openrouter` (cloud), raw candidate
  PII leaves to a third party — **assumption: production runs the local provider**, or this leak is
  explicitly accepted. The CV-only path remains anonymized.
- **LinkedIn ToS / anti-bot / GDPR.** Automated authenticated scraping of candidate profiles is a
  LinkedIn ToS gray area, risks the seeded account being challenged/banned, and raises candidate-consent
  questions. Treated as best-effort with graceful degradation; not a guaranteed-reliable path.
- **Session fragility.** The seeded `li_at` cookie expires and can be captcha-challenged; there is no
  unattended re-login. Operator must periodically refresh the secret. A Durable-Object warm session
  could reduce cold-starts but is an optimization, not in scope.
- **Workers Paid plan required** for Browser Run (the pipeline already requires it).
- **`@cloudflare/playwright` on the `@astrojs/cloudflare` adapter** is assumed to build under
  `nodejs_compat`; verify early in Phase 2 (`npm run build` + `wrangler dev --remote`).

## References

- Research: `context/changes/linkedin-cross-reference/research.md`
- S-02 template: `context/archive/2026-06-06-extended-analysis-inputs/plan.md`
- Pipeline: `src/pages/api/analysis/index.ts:206-309`
- Prompt: `src/lib/analysis/prompt.ts:41-90`
- Cloudflare Browser Run / Playwright + session reuse (docs)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Text-paste cross-reference core

#### Automated
- [x] 1.1 Unit tests pass: `npm run test`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 Linting passes: `npm run lint`
- [x] 1.4 Build passes: `npm run build`

#### Manual
- [x] 1.5 Contradicting LinkedIn text yields a contradictions question referencing the mismatch
- [x] 1.6 No-LinkedIn path still anonymizes the CV (unchanged behavior)
- [x] 1.7 Form copy states LinkedIn is sent un-anonymized when used

### Phase 2: Link scraping via Browser Run + Playwright

#### Automated
- [x] 2.1 Unit tests pass: `npm run test`
- [x] 2.2 Type checking passes: `npm run typecheck`
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Build passes (with `@cloudflare/playwright` + browser binding): `npm run build`

#### Manual
- [x] 2.5 Valid URL + seeded session scrapes profile text into the prompt (verified on PROD)
- [ ] 2.6 Blocked/expired session or bad URL → analysis completes from CV with "LinkedIn unavailable" note
- [ ] 2.7 Scraped text persisted; retry does not re-scrape

### Phase 3: Results surfacing + retry coherence

#### Automated
- [x] 3.1 Unit tests pass: `npm run test`
- [x] 3.2 Type checking passes: `npm run typecheck`
- [x] 3.3 Linting passes: `npm run lint`
- [x] 3.4 Build passes: `npm run build`

#### Manual
- [x] 3.5 Results header shows "LinkedIn cross-referenced" badge when used
- [ ] 3.6 Failed scrape shows the "paste text" note and no badge
- [ ] 3.7 Retry reproduces the cross-reference with no re-paste/re-scrape
