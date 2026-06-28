---
project: "Regression Report Drafter"
context_type: greenfield
created: 2026-06-27
updated: 2026-06-27
product_type: cli
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "coordination overhead + data trapped across Bitbucket/Jira/Confluence"
    - topic: "competitive insight"
      decision: "value is in JOINING sources (PR -> endpoints -> TC + ticket statuses), not any single source"
    - topic: "primary persona scope"
      decision: "specific role inside the company (QA / QA lead who owns the weekly regression report)"
    - topic: "auth strategy"
      decision: "no auth; single-user local script/CLI on the operator's machine; data from exports"
    - topic: "mvp scope"
      decision: "5-step export -> join -> markdown draft flow; ~3-week after-hours build accepted"
    - topic: "product type"
      decision: "cli / local script"
    - topic: "target scale"
      decision: "small (handful of users); domain rule is scale-independent"
  frs_drafted: 8
  quality_check_status: accepted
---

<!-- Seed: context/team/mom-test-validation.md — validated candidate "Regression Weekly Report Drafter" -->
<!-- Separate greenfield tool; unrelated to the AI-Recruiter product that owns context/foundation/. -->

# Shape Notes — Regression Weekly Report Drafter

## Vision & Problem Statement

Producing the weekly regression report is a manual coordination task: the QA owner
must stitch together at least three sources — merged pull requests (to see which
endpoints were touched and how many test cases were added or changed per service),
and QA board ticket statuses — then re-type the result into Confluence. The data is
trapped across Bitbucket, Jira, and Confluence, so the cost is the clicking,
copying, and reconciling, not the writing.

The insight: the value of this report is in the **join** across sources
(merged PR -> touched endpoints/services -> added/changed test cases, cross-referenced
with ticket statuses), not in any single source. No existing tool produces that joined
view for this team, which is why it is rebuilt by hand every week.

## User & Persona

Primary persona: the **QA engineer / QA lead** inside the company who owns the weekly
regression report. They reach for this tool every week when the report is due, currently
facing a multi-source manual gather across Bitbucket, Jira, and Confluence.

## Access Control

Single user; no auth. The first version runs as a local script/CLI on the QA owner's
own machine against exported files; there is no server, no account, and no role
separation. Data is mock / read-only export, so no access control or auditing is
required for v1.

## Success Criteria

### Primary
- From exported merged-PR and QA-board files, the tool produces a paste-ready weekly
  regression report draft (touched endpoints/services, count of added/changed test
  cases per service, cross-referenced ticket statuses) — replacing the manual
  multi-source gather. The report working = the product worked.

### Secondary
- The report includes a week-over-week diff (what is new or changed since the previous
  week's report). Nice to have, not required for v1.

### Guardrails
- The tool never invents or silently omits data: any missing input, unmatched PR, or
  unresolved mapping is flagged explicitly in the output rather than dropped.

## MVP flow (locked)

1. Operator exports merged PRs (Bitbucket) and QA board (Jira) to files.
2. Runs the tool pointing at those files.
3. Tool joins: PRs -> touched endpoints/services + added/changed test cases per service,
   plus ticket statuses.
4. Tool emits a markdown report draft.
5. Operator pastes the draft into Confluence.

Timeline: ~3 weeks of after-hours work, accepted as comfortable for this scope.

## Functional Requirements

### Data input
- FR-001: Operator can load exported merged-PR data from a file. Priority: must-have
  > Socratic: Counter-argument considered: "exports go stale and add a manual step;
  > a live Bitbucket API would be better." Resolution: kept for v1. Exports are a
  > deliberate choice to keep the tool local and auth-free; live API is deferred
  > (see Open Questions #2).
- FR-002: Operator can load exported QA-board ticket data from a file. Priority: must-have
  > Socratic: Counter-argument considered: "ticket statuses may not map to the report
  > week." Resolution: kept, but exposes a real gap — the reporting window must be
  > defined and used to scope both PRs and tickets (see Open Questions #1).

### Analysis / join
- FR-003: Tool can derive touched endpoints/services from merged PRs. Priority: must-have
  > Socratic: Challenge ("endpoint mapping needs domain knowledge not in PR data")
  > considered; stands as written — derivable from PR contents for this team.
- FR-004: Tool can count added/changed test cases per service from merged PRs. Priority: must-have
  > Socratic: Challenge ("TC changes may live outside PRs") considered; stands as
  > written — per-service counts are core to the report.
- FR-005: Tool can cross-reference ticket statuses with touched services. Priority: must-have
  > Socratic: Challenge ("no shared key / adds noise") considered; stands as written —
  > the cross-reference is part of the join's value.

### Output
- FR-006: Tool can produce a paste-ready markdown report draft. Priority: must-have
  > Socratic: Challenge ("Confluence wants storage/wiki markup") considered; stands as
  > written — markdown is sufficient for v1.
- FR-007: Tool flags missing/unmatched/unresolved data explicitly in the output. Priority: must-have
  > Socratic: Challenge ("too many flags = noise") considered; stands as written —
  > this is the trust guardrail; without it the report is untrustworthy.
- FR-008: Tool can include a week-over-week diff vs the previous report. Priority: nice-to-have
  > Socratic: Challenge ("needs persisting prior reports — scope creep") considered;
  > stands as written, explicitly out of MVP scope.

## User Stories

### US-01: QA owner generates the weekly regression report

- **Given** exported merged-PR and QA-board files for the reporting week
- **When** the operator runs the tool against those files
- **Then** they receive a markdown report draft listing touched endpoints/services,
  count of added/changed test cases per service, and ticket statuses, with any gaps
  flagged explicitly

#### Acceptance Criteria
- Every service touched by a merged PR appears in the report (no silent omission).
- Any PR that cannot be mapped to an endpoint/service is listed under an explicit
  "unmatched" section rather than dropped.
- The report is valid markdown that pastes into Confluence without manual reformatting.

## Open Questions

1. **How is the reporting window defined?** — The tool must scope merged PRs and ticket
   statuses to "this week" (or a chosen range). Owner: user. Surfaced by FR-002 Socratic.
2. **Exports vs live API.** — v1 uses file exports deliberately (local, no auth). A later
   version may pull live from Bitbucket/Jira API. Owner: user; decision deferred past v1.

## Business Logic

For a given time window, the tool maps each merged pull request to the services/endpoints
it touched, aggregates the count of added/changed test cases per service, and joins this
with ticket statuses to produce a per-service regression summary — flagging anything it
cannot confidently map.

The inputs the rule consumes are the week's merged pull requests and the QA-board tickets
for the same window. Its output is a per-service regression summary: for each service,
which endpoints were touched, how many test cases were added or changed, and the related
ticket statuses. The user encounters this as the report draft they paste into Confluence;
unmapped or missing data appears as explicit flags rather than being dropped.

## Non-Functional Requirements

- For one week of input data, the report is produced within a few seconds of running the
  tool (user-perceived completion under ~10 s).

## Non-Goals

- **No live API integration with Bitbucket/Jira.** v1 reads file exports only; pulling
  live from APIs is deferred (avoids auth/access scope, keeps the tool local). This is
  the binding scope lock for the first version.

## Quality cross-check

All required greenfield elements present; no gaps. `quality_check_status: accepted`.

- Access Control: present
- Business Logic (one-sentence rule): present
- Project artifacts: present
- Timeline-cost acknowledged: present (mvp_weeks 3)
- Non-Goals: present

## Forward: tech-stack

No framework, language, or platform chosen — left open for the tech-stack-selection step.
The only binding priors: cli/local-script product shape, single-user, reads file exports.

---

_Shape complete. Next: `/10x-prd context/team/regression-report-drafter/shape-notes.md`._
