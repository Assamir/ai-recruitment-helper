# Unit Tests for Export Formatting Helpers — Implementation Plan

## Overview

Add focused unit-test coverage for the two pure helpers in
`src/lib/export/format.ts` that currently have no dedicated test:
`exportFilenameStem` and `formatCreatedDate`. Both are deterministic,
UTC-based string formatters used when building export filenames and report
dates. This is a test-only change — no production code is modified.

## Current State Analysis

`src/lib/export/format.ts` exports:

- `exportFilenameStem(analysisId, createdAt)` → `analysis-<id>-<YYYY-MM-DD>`
- `formatCreatedDate(createdAt)` → `YYYY-MM-DD` (UTC, via `toISOString`)
- `formatRequirementsLabel(...)` — thin re-export of the shared helper
- `CATEGORY_ORDER`, `CATEGORY_LABELS` — constants

The `tests/lib/export/` folder already covers `markdown.ts` and `redact.ts`,
but there is no `format.test.ts`. The two date/filename helpers are untested.

### Key Discoveries

- Tests use Vitest with the `@/` path alias (see `tests/lib/export/markdown.test.ts`).
- `formatCreatedDate` and `exportFilenameStem` derive the date from
  `new Date(createdAt).toISOString().slice(0, 10)`, so output is timezone
  independent (always UTC) — no need to freeze the local clock.

## Desired End State

A new `tests/lib/export/format.test.ts` file exercises both helpers, and
`npm run test` passes with the added cases.

## What We're NOT Doing

- **No production code changes** — `src/lib/export/format.ts` is not modified.
- **No tests for `formatRequirementsLabel`** — it only delegates to the shared
  helper, which is covered elsewhere.
- **No new constants tests** — `CATEGORY_ORDER` / `CATEGORY_LABELS` are static.

## Phase 1: Add format helper tests

### Changes Required

#### 1. `tests/lib/export/format.test.ts` (new file)

Cover:

- `exportFilenameStem` builds `analysis-<id>-<YYYY-MM-DD>` from an id + ISO timestamp.
- `exportFilenameStem` derives the date in UTC (an ISO string with a
  non-UTC offset resolves to the correct UTC calendar day).
- `formatCreatedDate` returns the `YYYY-MM-DD` UTC slice of an ISO timestamp.

### Success Criteria

#### Automated Verification

- [ ] `npm run test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.

#### Manual Verification

- [ ] The new test file lives at `tests/lib/export/format.test.ts` and imports
      the helpers from `@/lib/export/format`.
