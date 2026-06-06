# LinkedIn Cross-Reference (S-03) — Plan Brief

> Full plan: `context/changes/linkedin-cross-reference/plan.md`
> Research: `context/changes/linkedin-cross-reference/research.md`

## What & Why

Let recruiters optionally add a candidate's LinkedIn profile — by **pasting text** or **providing a
profile link** — as a second source of truth, so the analysis surfaces contradictions between the CV
and LinkedIn (FR-004, roadmap S-03). Links are scraped server-side with Cloudflare Browser Run +
Playwright.

## Starting Point

The S-01/S-02 pipeline (form → API → anonymize CV → prompt → LLM → DB) is in place.
`candidates.linkedin_text` already exists (no migration), the form has a reusable collapsible-textarea
pattern, and `contradictions` is already a valid response category. No browser-automation capability
exists yet (no Browser Run binding, no `@cloudflare/playwright`, runtime `env` not exposed to app code).

## Desired End State

A recruiter can paste LinkedIn text or a profile URL. Text is used directly; a URL is scraped. The
LinkedIn content is stored on the candidate and fed to the LLM **alongside the CV**, producing
CV↔LinkedIn contradiction questions. Results show a "LinkedIn cross-referenced" badge; retry reuses
stored LinkedIn text. With no LinkedIn supplied, behavior is identical to today (CV anonymized).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Anonymize LinkedIn? | **No** — send CV **and** LinkedIn raw when LinkedIn present | Cross-reference only works when both sources share one representation; LinkedIn treated as public second source | Plan |
| LinkedIn-only entities | Left raw | Consistent with the no-anonymization decision | Plan |
| Ingestion | **Both** paste text **and** link → Playwright scrape | Recruiter chose to support links, not just paste | Plan |
| Scraping tech | Cloudflare **Browser Run + Playwright** (not the external MCP server) | The `linkedin-mcp-server` (Python/Chromium, single-account desktop tool) can't run in a Worker; Browser Run is the CF-native, in-Worker path | Plan |
| Length cap | `MAX_LINKEDIN_TEXT_CHARS` = CV cap | LinkedIn profiles are CV-comparable in length | Plan |
| Prompt shape | Un-fenced `LINKEDIN:` section after the CV; broaden contradictions clause only when present | Mirrors CV-last pattern; LinkedIn is candidate data, not fenced recruiter text | Plan |
| Results UI | Minimal "LinkedIn cross-referenced" badge | Tells the recruiter the comparison happened with a tiny diff | Plan |
| Pipeline refactor | Inline, minimal | Lowest risk; consistent with how S-02 landed | Plan |
| Delivery | All-in-one (paste + link scraping in one change) | Recruiter chose the full feature now, accepting the scraping risk | Plan |

## Scope

**In scope:** LinkedIn paste field + URL field; conditional raw-both anonymization; LinkedIn prompt
section + cross-source contradictions; Browser Run + Playwright scraper with graceful fallback;
results badge; retry reuse; unit tests.

**Out of scope:** schema/response changes; LinkedIn anonymization / shared-PII-map; DB migration;
bulk/multi-profile scraping; captcha/2FA automation; Durable-Object warm session (optional later);
per-question source attribution.

## Architecture / Approach

Phase 1 wires `linkedin_text` end-to-end for pasted text (mirror of S-02) plus the
**conditional-anonymization toggle** — when LinkedIn text is present, the pipeline sends both CV and
LinkedIn raw; otherwise it anonymizes the CV as today. Phase 2 adds a `linkedin_url` field and a
Browser Run + Playwright scraper that produces the **same `linkedin_text`** Phase 1 consumes, so scrape
failures degrade gracefully to the paste path. Phase 3 surfaces the cross-reference in the UI.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Text-paste core | Full cross-reference for pasted LinkedIn text + conditional anonymization | Getting the raw-both vs anonymized split unambiguous and tested |
| 2. Link scraping | URL → Browser Run + Playwright scrape into `linkedin_text`, graceful fallback | LinkedIn auth wall / captcha / ToS; new infra (binding, secret, paid plan) |
| 3. Results + retry | "Cross-referenced" badge, failure note, retry reuse | Surfacing the non-fatal scrape-failure state cleanly |

**Prerequisites:** Workers Paid plan (Browser Run); a seeded `LINKEDIN_SESSION_COOKIE` secret for the
scrape path; `@cloudflare/playwright` builds on the adapter.
**Estimated effort:** ~3 sessions — Phase 1 small (S-02 mirror), Phase 2 large/risky (scraper + infra),
Phase 3 small.

## Open Risks & Assumptions

- **Privacy posture flips with LinkedIn present:** CV + LinkedIn go to the LLM raw — safe only on the
  local provider; cloud OpenRouter would leak raw PII. CV-only path stays anonymized.
- **LinkedIn ToS / anti-bot / GDPR:** authenticated candidate-profile scraping is a gray area, risks
  the bot account, and raises consent questions; treated as best-effort with graceful degradation.
- **Session fragility:** the seeded cookie expires / can be challenged; no unattended re-login.
- **`@cloudflare/playwright` on `@astrojs/cloudflare`** assumed to build under `nodejs_compat` — verify early.

## Success Criteria (Summary)

- Pasted contradicting LinkedIn text produces a contradiction question referencing the mismatch.
- A valid URL is scraped into the prompt; a blocked/bad URL still completes the analysis from the CV.
- The no-LinkedIn path is unchanged (CV anonymized); results show a cross-referenced badge when used.
