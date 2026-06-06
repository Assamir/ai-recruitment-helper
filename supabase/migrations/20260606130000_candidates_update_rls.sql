-- =============================================================================
-- Candidates update RLS policy
-- Adds the missing per-user UPDATE authorization on candidates so the
-- background analysis pipeline can persist `pii_map` (and other owner-writable
-- columns) instead of silently no-opping under RLS. Additive-only; no
-- table/column changes. The UPDATE grant to `authenticated` already exists.
-- =============================================================================

-- candidates: UPDATE own rows (e.g. pii_map persistence by the owning pipeline)
create policy "Users update own candidates"
  on public.candidates for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );
