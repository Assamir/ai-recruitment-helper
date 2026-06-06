# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Supabase writes need a matching RLS policy AND an error check

- **Context**: src/pages/api/analysis/index.ts:169 — background pipeline UPDATE on `candidates` to persist `pii_map`.
- **Problem**: The `candidates` table had only SELECT/INSERT/DELETE RLS policies — no UPDATE policy. The UPDATE silently affected 0 rows (`pii_map` stayed NULL), and because the result was never destructured/checked, the pipeline reported success while the audit trail was never persisted. RLS denials surface as empty result sets, not thrown errors.
- **Rule**: For every Supabase write, confirm a matching RLS policy exists for that exact operation (a table with INSERT but no UPDATE policy will silently no-op updates under RLS), AND destructure `{ error }` (or check affected rows) on the response — never fire-and-forget a write whose success you depend on.
- **Applies to**: All Supabase `.insert()/.update()/.delete()` calls in `src/pages/api/**` and any `waitUntil()` background pipeline; especially writes that aren't immediately re-read.
