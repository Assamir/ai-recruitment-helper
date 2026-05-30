-- =============================================================================
-- Analysis delete RLS policies
-- Adds per-user DELETE authorization on analyses and candidates so the
-- delete endpoint can remove rows. Additive-only; no table/column changes.
-- =============================================================================

-- analyses: DELETE own rows
create policy "Users delete own analyses"
  on public.analyses for delete to authenticated
  using ( (select auth.uid()) = user_id );

-- candidates: DELETE own rows (conditional cleanup when no analyses remain)
create policy "Users delete own candidates"
  on public.candidates for delete to authenticated
  using ( (select auth.uid()) = user_id );
