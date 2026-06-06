-- Non-fatal marker when LinkedIn URL scrape was attempted but failed (S-03).
alter table public.analyses
  add column if not exists linkedin_scrape_note text;
