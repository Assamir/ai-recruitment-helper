# Data Schema, Migrations, RLS, and QA Profile Seeds — Implementation Plan

## Overview

Implement the Supabase database foundation (F-01) that every downstream slice depends on: tables for profiles, candidates, analyses, analysis questions, and predefined QA job profiles; row-level security policies enforcing per-user data isolation; a trigger auto-populating user profiles from `auth.users`; idempotent QA profile seed data; generated TypeScript types wired into the Supabase client. This is the first foundation slice — it unlocks S-01 through S-04.

## Current State Analysis

Supabase is wired for **auth only** via `@supabase/ssr` (`signIn`/`signUp`/`signOut`). The project has:

- `src/lib/supabase.ts` — `createServerClient()` (untyped, no `Database` generic)
- `src/middleware.ts` — `getUser()` on every request, protects `/dashboard`
- `src/pages/api/auth/{signin,signup,signout}.ts` — auth API routes
- `supabase/config.toml` — CLI config (Postgres 17, `project_id = "10x-astro-starter"`)
- No `.sql` files, no `supabase/migrations/`, no `seed.sql`, no `.from()` calls in app code
- No generated types (`database.types.ts`)

### Key Discoveries:

- `@supabase/supabase-js@^2.99.1` (resolved 2.105.3), `@supabase/ssr@0.10.3`, `supabase@^2.23.4` (resolved 2.98.2)
- `astro.config.mjs` declares `SUPABASE_URL` and `SUPABASE_KEY` as `optional: true` server secrets — build passes without them
- `env.d.ts` types `App.Locals.user` as `import("@supabase/supabase-js").User | null`
- AGENTS.md constraint: migrations must be backward-compatible (additive only, new columns with defaults, no renames/drops in same deploy)
- RLS best practice: wrap `auth.uid()` in `(select auth.uid())` for performance (~100× on large tables)
- All FK UUID columns must be explicitly indexed (Postgres does not auto-index foreign keys)

## Desired End State

After this plan is complete:

1. Five tables exist in `public` schema: `profiles`, `job_profiles`, `candidates`, `analyses`, `analysis_questions`
2. Every table has RLS enabled with per-operation policies — user-owned tables enforce `user_id = auth.uid()`, the `job_profiles` reference table is authenticated-read-only
3. A trigger on `auth.users` auto-creates a `profiles` row on signup
4. 8–10 QA job profiles are seeded with structured data (name, seniority_level, description, expected_skills JSONB)
5. `src/db/database.types.ts` contains generated types; `createClient<Database>()` is typed
6. An `npm run db:types` script regenerates types from the remote project

Verification: `supabase db push` applies the migration cleanly to the remote project; RLS policies reject cross-user access; seed profiles are queryable; `npm run build` passes with typed client.

## What We're NOT Doing

- **No application queries** — S-01 will write the first `.from()` calls
- **No UI changes** — no new pages or components in this slice
- **No local Supabase Docker setup** — testing against remote project per user decision
- **No admin roles or team features** — PRD explicitly excludes these from MVP
- **No S-04 export metadata columns** — only S-01/S-02/S-03 columns anticipated
- **No pgTAP or automated DB tests** — manual verification via SQL test queries

## Implementation Approach

Single atomic migration file with commented sections (tables → trigger → RLS → indexes → seed data). This ensures the schema, security policies, and reference data ship together or not at all. The migration uses `supabase migration new` for proper timestamp naming.

The schema anticipates Stream A columns (S-01 through S-03) to avoid column-adding migrations between slices, while keeping the structure minimal. Analysis output is normalized into `analyses` (metadata + summary) and `analysis_questions` (individual questions with category, rationale, suggested answer) for SQL-level queryability.

## Critical Implementation Details

### Timing & lifecycle

The `handle_new_user` trigger fires on `auth.users` INSERT. Existing users who signed up before this migration will NOT have a `profiles` row. The migration must backfill profiles for any existing `auth.users` rows, or S-01 queries joining on `profiles` will return empty results for early adopters.

## Phase 1: Schema & RLS Migration

### Overview

Create the migration file containing all five tables, the auth trigger, per-operation RLS policies, and FK indexes.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/<timestamp>_data_schema_and_rls.sql`

**Intent**: Define the complete public schema for the MVP data layer. Five tables implement the domain model: `profiles` (app-level user identity), `job_profiles` (predefined QA role reference data), `candidates` (uploaded CVs), `analyses` (analysis runs linking candidate to profile), and `analysis_questions` (normalized LLM-generated questions). Each user-owned table has a `user_id` FK to `auth.users` with `ON DELETE CASCADE`.

**Contract**:

Tables and their columns:

**`profiles`**:
- `id` uuid PK (references `auth.users(id)` on delete cascade) — NOT a separate user_id; the profile IS the user
- `email` text
- `created_at` timestamptz default now()

**`job_profiles`** (shared reference data):
- `id` uuid PK default `gen_random_uuid()`
- `name` text not null (e.g., "Automation QA")
- `seniority_level` text (nullable — not all profiles have seniority, e.g., "Performance Tester")
- `description` text not null (1-2 sentence role summary)
- `expected_skills` jsonb not null default '[]' (array of skill objects the LLM uses as context)
- `created_at` timestamptz default now()

**`candidates`** (one row per CV upload):
- `id` uuid PK default `gen_random_uuid()`
- `user_id` uuid not null references `auth.users(id)` on delete cascade
- `file_name` text (original upload filename)
- `cv_text` text (extracted text from CV)
- `linkedin_text` text (optional, for S-03)
- `created_at` timestamptz default now()

**`analyses`** (one row per analysis run):
- `id` uuid PK default `gen_random_uuid()`
- `user_id` uuid not null references `auth.users(id)` on delete cascade
- `candidate_id` uuid not null references `candidates(id)` on delete cascade
- `job_profile_id` uuid references `job_profiles(id)` on delete set null (nullable — custom requirements may skip predefined profile)
- `custom_requirements` text (optional, for S-02)
- `project_context` text (optional, for S-02)
- `status` text not null default 'pending' (pending → parsing → anonymizing → analyzing → generating → completed → failed)
- `match_summary` text (2-3 sentence overall fit assessment)
- `error_message` text (if status = failed)
- `created_at` timestamptz default now()
- `completed_at` timestamptz

**`analysis_questions`** (normalized LLM output):
- `id` uuid PK default `gen_random_uuid()`
- `analysis_id` uuid not null references `analyses(id)` on delete cascade
- `category` text not null (one of: 'missing_elements', 'contradictions', 'vague_claims', 'anomalies')
- `question` text not null
- `rationale` text not null (why this question was generated)
- `suggested_answer` text (what the candidate should ideally answer)
- `sort_order` integer not null default 0
- `created_at` timestamptz default now()

#### 2. Auth trigger

**File**: Same migration file

**Intent**: Auto-populate `profiles` when a new user signs up via Supabase Auth. Also backfill profiles for any existing `auth.users` rows created before this migration.

**Contract**: A `SECURITY DEFINER` function `public.handle_new_user()` with `set search_path = ''` that inserts into `public.profiles` on `AFTER INSERT ON auth.users`. A backfill `INSERT INTO public.profiles SELECT ... FROM auth.users WHERE id NOT IN (SELECT id FROM public.profiles)` runs once in the migration.

#### 3. RLS policies

**File**: Same migration file

**Intent**: Enforce per-user data isolation per PRD Access Control. Every table has RLS enabled. User-owned tables get per-operation policies (SELECT, INSERT only for MVP — no UPDATE/DELETE on candidates; SELECT, INSERT for analyses and analysis_questions). `job_profiles` gets authenticated-read-only. `profiles` gets SELECT on own row.

**Contract**: Per-operation policies using `(select auth.uid()) = user_id` pattern (subquery-wrapped for performance). All policies target `TO authenticated`. Grants: `SELECT, INSERT, UPDATE, DELETE` to `authenticated` and `service_role` on all tables (grants are broad; policies are the enforcement layer).

Policy summary:

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own row | (trigger only) | own row | — |
| `job_profiles` | all (authenticated) | — | — | — |
| `candidates` | own rows | own rows | — | — |
| `analyses` | own rows | own rows | own status | — |
| `analysis_questions` | own rows | own rows | — | — |

Note: `analyses` gets an UPDATE policy restricted to the `status`, `match_summary`, `error_message`, and `completed_at` columns — the analysis pipeline needs to update status as it progresses. The `WITH CHECK` ensures `user_id` cannot be reassigned.

#### 4. Indexes

**File**: Same migration file

**Intent**: Index all FK UUID columns used in RLS policies, JOINs, and CASCADE deletes.

**Contract**:
- `candidates_user_id_idx` on `candidates(user_id)`
- `analyses_user_id_idx` on `analyses(user_id)`
- `analyses_candidate_id_idx` on `analyses(candidate_id)`
- `analyses_job_profile_id_idx` on `analyses(job_profile_id)`
- `analysis_questions_analysis_id_idx` on `analysis_questions(analysis_id)`
- `analysis_questions_category_idx` on `analysis_questions(category)` — for filtering by anomaly type

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly to remote Supabase: `supabase db push`
- No advisor warnings: `supabase db advisors` (after local apply if available, otherwise manual review)
- Lint passes: `npm run lint`
- Build passes: `npm run build` (with env vars)

#### Manual Verification:

- Verify all 5 tables exist in Supabase dashboard (Table Editor)
- Verify RLS is enabled on every table (shield icon visible)
- Verify indexes exist via SQL: `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
- Sign up a new test user → verify `profiles` row auto-created
- Attempt cross-user data access via SQL Editor (service_role as User A inserts a candidate; User B's anon client cannot SELECT it)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Seed Data

### Overview

Author and insert idempotent QA job profile seed data as part of the migration. Each profile provides structured context the LLM will use in S-01 to generate targeted interview questions.

### Changes Required:

#### 1. QA profile seed inserts

**File**: Same migration file (appended after indexes)

**Intent**: Populate `job_profiles` with the 8-10 predefined QA roles listed in the PRD (FR-002) and roadmap. Each profile has a name, optional seniority level, description, and expected_skills JSONB array. Uses `INSERT ... ON CONFLICT DO NOTHING` for idempotency.

**Contract**: Seed profiles with deterministic UUIDs (using `gen_random_uuid()` is fine since `ON CONFLICT` uses the `name + seniority_level` unique constraint — add a unique constraint on `(name, seniority_level)` to support idempotent seeding). The profiles to seed:

1. Manual QA — Junior
2. Manual QA — Mid
3. Manual QA — Senior
4. Automation QA — Python
5. Automation QA — Java
6. Automation QA — Playwright
7. Automation QA — Selenium
8. Performance Tester (no seniority level)
9. API Tester (no seniority level)

Each profile's `expected_skills` is a JSONB array of objects with at minimum `{"name": "...", "category": "..."}` structure. Categories: "methodology", "tool", "language", "framework", "concept". The description and skills should be domain-accurate for QA recruitment.

#### 2. Unique constraint for idempotent seeding

**File**: Same migration file (before seed inserts)

**Intent**: Enable `ON CONFLICT DO NOTHING` for seed data re-runs.

**Contract**: `ALTER TABLE job_profiles ADD CONSTRAINT job_profiles_name_seniority_unique UNIQUE (name, seniority_level)` — or inline in the CREATE TABLE. Handles NULL seniority_level correctly (PostgreSQL treats NULLs as distinct in unique constraints, so add a `COALESCE` expression index or use `NULLS NOT DISTINCT` on PG 15+).

### Success Criteria:

#### Automated Verification:

- Migration still applies cleanly: `supabase db push` (or re-push)
- Query returns expected count: `SELECT count(*) FROM job_profiles` = 9

#### Manual Verification:

- Each profile has a meaningful description (not placeholder text)
- Each profile's `expected_skills` contains 5-15 relevant skills with appropriate categories
- Skills are domain-accurate for QA recruitment (e.g., Selenium profile lists browser automation, WebDriver, locators, not generic programming skills)
- Re-running the migration does not duplicate profiles (idempotency check)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Type Generation & Client Wiring

### Overview

Set up the `supabase gen types` workflow, generate TypeScript types from the deployed schema, and wire the typed `Database` generic into the Supabase client.

### Changes Required:

#### 1. Generated types file

**File**: `src/db/database.types.ts`

**Intent**: Auto-generated TypeScript definitions matching the public schema. This file is the output of `supabase gen types typescript` and should not be hand-edited.

**Contract**: Generated by running `npx supabase gen types typescript --project-id "<project-ref>" --schema public > src/db/database.types.ts`. Exports a `Database` type with `public.Tables` containing all five tables with `Row`, `Insert`, and `Update` shapes.

#### 2. Type the Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Pass the `Database` generic to `createServerClient` so all downstream `.from()` calls get compile-time type safety.

**Contract**: Import `Database` from `@/db/database.types` and change `createServerClient(...)` to `createServerClient<Database>(...)`. The return type changes from `SupabaseClient` to `SupabaseClient<Database>`.

#### 3. npm script for type regeneration

**File**: `package.json`

**Intent**: Add a `db:types` script so developers (and agents) can regenerate types after schema changes with a single command.

**Contract**: Add `"db:types": "npx supabase gen types typescript --project-id \"<project-ref>\" --schema public > src/db/database.types.ts"` to scripts. Replace `<project-ref>` with the actual Supabase project reference ID.

#### 4. Create `src/db/` directory

**File**: `src/db/` (new directory)

**Intent**: Namespace for database-related generated code, separate from hand-written `src/lib/` code.

**Contract**: Directory containing `database.types.ts`. The `@/*` path alias in `tsconfig.json` already maps to `./src/*`, so imports use `@/db/database.types`.

### Success Criteria:

#### Automated Verification:

- Type generation succeeds: `npm run db:types`
- TypeScript compiles: `npx astro sync && npm run build`
- Lint passes: `npm run lint`
- Generated file exports a `Database` type with all 5 tables

#### Manual Verification:

- Verify `createServerClient<Database>` in `src/lib/supabase.ts` — IDE shows table name autocompletion on `.from()`
- Verify `Tables<"candidates">` helper type resolves correctly in IDE

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Verification & Cleanup

### Overview

End-to-end verification that the complete data layer works: schema is deployed, RLS enforces isolation, seed data is present, types compile, and the existing auth flow still works.

### Changes Required:

#### 1. Update change.md status

**File**: `context/changes/data-schema-and-rls/change.md`

**Intent**: Record that planning is complete and implementation can proceed.

**Contract**: Set `status: planned`, update `updated:` to today's date.

#### 2. Update README database section

**File**: `README.md`

**Intent**: Replace the "No database tables or migrations are required" statement with accurate documentation of the new schema.

**Contract**: Update the database section to list the tables, mention RLS, and document the `npm run db:types` workflow.

### Success Criteria:

#### Automated Verification:

- Full build passes: `npx astro sync && npm run build`
- Lint passes: `npm run lint`
- Type generation is repeatable: `npm run db:types` produces identical output

#### Manual Verification:

- Sign up flow still works (trigger creates profile row)
- Sign in flow still works
- Dashboard loads for authenticated user
- Existing auth flow is unaffected by new tables/policies
- README accurately reflects the new database setup

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

No test framework is configured. Schema and RLS are verified via SQL queries (see manual verification steps).

### Integration Tests:

Not in scope for F-01. S-01 will be the first slice that exercises the schema through application code.

### Manual Testing Steps:

1. Apply migration to remote Supabase: `supabase db push`
2. Open Supabase dashboard → Table Editor → verify 5 tables with correct columns
3. Verify RLS enabled on all tables (shield icon)
4. Sign up a new user → check `profiles` table has a new row
5. As User A: insert a candidate row via SQL Editor (using User A's JWT)
6. As User B: attempt to SELECT User A's candidate → expect 0 rows returned
7. Query `job_profiles` as authenticated user → expect 9 rows
8. Query `job_profiles` as anonymous → expect denied (no anon policy)
9. Run `npm run db:types` → verify `src/db/database.types.ts` is generated
10. Run `npm run build` → verify no type errors

## Performance Considerations

- All RLS policies use `(select auth.uid())` subquery pattern for per-statement caching (~100× improvement on large tables vs. bare `auth.uid()`)
- All FK UUID columns are indexed — prevents sequential scans on JOINs and CASCADE deletes
- No JSONB indexes on `expected_skills` — MVP query volume doesn't justify them; add when S-01 reveals query patterns
- `analysis_questions.category` index supports filtered queries by anomaly type in the results UI

## Migration Notes

- This is the **first migration** — no existing data to preserve (auth-only today)
- Migration is additive-only (per AGENTS.md constraint)
- Existing `auth.users` rows are backfilled into `profiles` by the migration
- `supabase db push` applies to remote; no local Docker required
- Future schema changes (S-02/S-03 columns already included) should still use new migration files for any additions

## References

- PRD: `context/foundation/prd.md` — Access Control, FR-002
- Roadmap: `context/foundation/roadmap.md` — F-01 definition
- Infrastructure: `context/foundation/infrastructure.md` — deployment constraints
- Supabase RLS docs: use `(select auth.uid())` pattern, `TO authenticated`, per-operation policies
- Supabase trigger docs: `SECURITY DEFINER` + `set search_path = ''` for auth triggers
- AGENTS.md: backward-compatible migrations only

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & RLS Migration

#### Automated

- [x] 1.1 Migration applies cleanly to remote Supabase
- [x] 1.2 No advisor warnings
- [x] 1.3 Lint passes
- [x] 1.4 Build passes

#### Manual

- [x] 1.5 All 5 tables visible in Supabase dashboard
- [x] 1.6 RLS enabled on every table
- [x] 1.7 Indexes exist in pg_indexes
- [x] 1.8 New user signup creates profiles row
- [x] 1.9 Cross-user data access rejected by RLS

### Phase 2: Seed Data

#### Automated

- [x] 2.1 Migration applies cleanly
- [x] 2.2 job_profiles count = 9

#### Manual

- [x] 2.3 Profile descriptions are meaningful and domain-accurate
- [x] 2.4 expected_skills contain relevant QA skills per profile
- [x] 2.5 Re-running migration does not duplicate profiles

### Phase 3: Type Generation & Client Wiring

#### Automated

- [x] 3.1 Type generation succeeds via npm run db:types
- [x] 3.2 TypeScript compiles (astro sync + build)
- [x] 3.3 Lint passes
- [x] 3.4 Generated file exports Database type with all 5 tables

#### Manual

- [x] 3.5 IDE shows table name autocompletion on .from()
- [x] 3.6 Tables<"candidates"> helper type resolves in IDE

### Phase 4: Verification & Cleanup

#### Automated

- [x] 4.1 Full build passes
- [x] 4.2 Lint passes
- [x] 4.3 Type generation is repeatable

#### Manual

- [x] 4.4 Sign up flow still works (trigger creates profile)
- [x] 4.5 Sign in flow still works
- [x] 4.6 Dashboard loads for authenticated user
- [x] 4.7 README accurately reflects new database setup
