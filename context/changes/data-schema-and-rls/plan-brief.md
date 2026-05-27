# Data Schema, Migrations, RLS, and QA Profile Seeds — Plan Brief

> Full plan: `context/changes/data-schema-and-rls/plan.md`

## What & Why

Build the Supabase database foundation (F-01) that every downstream feature slice depends on. The app currently has auth-only Supabase integration — no tables, no migrations, no schema. This slice lands the complete data layer: domain tables, row-level security enforcing per-user isolation (PRD guardrail: "recruiter A must never see recruiter B's data"), predefined QA job profiles for the interview question generator, and TypeScript types for compile-time query safety.

## Starting Point

Supabase is wired for authentication only via `@supabase/ssr`. The project has sign-in/up/out API routes, middleware that resolves `user` from JWT cookies, and a protected `/dashboard` route. There are zero `.sql` files, no `supabase/migrations/` directory, no seed data, and no generated database types. The `supabase/` folder contains only CLI config (`config.toml`).

## Desired End State

Five tables exist in the public schema (`profiles`, `job_profiles`, `candidates`, `analyses`, `analysis_questions`) with RLS policies enforcing per-user data isolation on every table. A trigger auto-creates profile rows on signup. Nine QA job profiles are seeded with structured skill data. The Supabase client is typed with `createServerClient<Database>(...)`, and `npm run db:types` regenerates types from the remote project. S-01 can immediately start writing `.from()` queries with full type safety.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Candidate model | Single table (one row per CV upload) | Simplest model for MVP; no use case for multi-CV candidates yet |
| Analysis output | Normalized (analyses + analysis_questions) | SQL-level queryability enables per-question rating/editing in future slices |
| Job profiles | DB table with seed data | Queryable, FK-referenceable, extensible without code deploys |
| User profiles | public.profiles with auth trigger | Standard Supabase pattern; keeps app data in public schema with RLS |
| RLS granularity | Per-operation policies | Principle of least privilege; only MVP-needed operations are allowed |
| Reference data RLS | Authenticated SELECT only | Protects from anonymous access while readable by any logged-in user |
| Service role usage | Migrations/seeds only | Clean separation; app runtime is always RLS-bound |
| Schema scope | S-01 + S-02 + S-03 ready | Avoids column-adding migrations between slices in the 6-week timeline |
| Profile fields | Name + seniority + description + expected_skills JSONB | Gives LLM enough structured signal for targeted question generation |
| Seed strategy | Idempotent INSERT in migration | Atomic with schema; works in every environment |
| Type generation | Yes — gen types + typed client | Compile-time safety on all DB queries from S-01 onward |
| Migration files | Single file with sections | Atomic deployment; everything ships together or nothing does |
| Testing | Manual SQL verification | No test framework; verify RLS via cross-user access test queries |
| Local dev | Remote Supabase only | No Docker dependency; test against cloud project |

## Scope

**In scope:**
- Five tables: profiles, job_profiles, candidates, analyses, analysis_questions
- RLS policies (per-operation) on all tables
- Auth trigger + existing-user backfill for profiles
- FK indexes on all UUID columns
- 9 QA job profile seeds with structured skill data
- Type generation workflow (npm script + typed client)
- README update

**Out of scope:**
- Application queries (S-01's job)
- UI changes
- Local Docker Supabase setup
- Admin roles / team features
- S-04 export metadata columns
- Automated DB tests (pgTAP)

## Architecture / Approach

Single atomic migration file with commented sections: tables → trigger → backfill → RLS policies → indexes → unique constraint → seed data. The normalized schema separates analysis metadata (status, summary) from individual questions (category, rationale, answer) for future queryability. All user-owned tables chain `ON DELETE CASCADE` from `auth.users`. Type generation runs against the remote Supabase project and outputs to `src/db/database.types.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema & RLS Migration | 5 tables, RLS policies, trigger, indexes | Auth trigger failure blocks signups — must test thoroughly |
| 2. Seed Data | 9 QA profiles with structured skills | Domain accuracy of skill lists — needs manual review |
| 3. Type Generation & Client Wiring | Typed Supabase client, npm script | Requires Supabase project-ref — may need login setup |
| 4. Verification & Cleanup | End-to-end validation, README update | Existing auth flow regression |

**Prerequisites:** A Supabase project with the project reference ID available for type generation and `supabase db push`.
**Estimated effort:** ~1 session across 4 phases (schema is straightforward; seed data authoring is the main time investment).

## Open Risks & Assumptions

- Assumes the remote Supabase project is accessible and `supabase db push` is configured (login + project link)
- The `handle_new_user` trigger uses `SECURITY DEFINER` — if it fails, user signup is blocked. The function must be minimal and tested.
- Schema anticipates S-02/S-03 columns; if those slices are descoped, unused columns remain (low cost, easily dropped later)
- No automated RLS tests — policy correctness relies on manual verification until a test framework is introduced

## Success Criteria (Summary)

- Migration deploys to remote Supabase without errors and all 5 tables + 9 seed profiles are present
- RLS correctly isolates per-user data (verified by cross-user access test)
- Typed Supabase client compiles and `npm run build` passes — S-01 can immediately use `.from()` with autocompletion
