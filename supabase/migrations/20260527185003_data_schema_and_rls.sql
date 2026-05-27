-- =============================================================================
-- F-01: Data schema, RLS, and QA profile seeds
-- Single atomic migration: tables → trigger → backfill → RLS → indexes → seeds
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid not null references auth.users (id) on delete cascade primary key,
  email text,
  created_at timestamptz not null default now()
);

create table public.job_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  seniority_level text,
  description text not null,
  expected_skills jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint job_profiles_name_seniority_unique unique nulls not distinct (name, seniority_level)
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text,
  cv_text text,
  linkedin_text text,
  created_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  job_profile_id uuid references public.job_profiles (id) on delete set null,
  custom_requirements text,
  project_context text,
  status text not null default 'pending',
  match_summary text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.analysis_questions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  category text not null,
  question text not null,
  rationale text not null,
  suggested_answer text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. AUTH TRIGGER — auto-populate profiles on signup
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill profiles for any existing auth.users rows
insert into public.profiles (id, email)
select id, email from auth.users
where id not in (select id from public.profiles);

-- ---------------------------------------------------------------------------
-- 3. ENABLE RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.job_profiles enable row level security;
alter table public.candidates enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_questions enable row level security;

-- ---------------------------------------------------------------------------
-- 4. GRANTS
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

grant select, insert, update, delete on public.job_profiles to authenticated;
grant select, insert, update, delete on public.job_profiles to service_role;

grant select, insert, update, delete on public.candidates to authenticated;
grant select, insert, update, delete on public.candidates to service_role;

grant select, insert, update, delete on public.analyses to authenticated;
grant select, insert, update, delete on public.analyses to service_role;

grant select, insert, update, delete on public.analysis_questions to authenticated;
grant select, insert, update, delete on public.analysis_questions to service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS POLICIES
-- ---------------------------------------------------------------------------

-- profiles: SELECT own row
create policy "Users read own profile"
  on public.profiles for select to authenticated
  using ( (select auth.uid()) = id );

-- profiles: UPDATE own row (email, etc.)
create policy "Users update own profile"
  on public.profiles for update to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- job_profiles: authenticated read-only
create policy "Authenticated users read job profiles"
  on public.job_profiles for select to authenticated
  using ( true );

-- candidates: SELECT own rows
create policy "Users read own candidates"
  on public.candidates for select to authenticated
  using ( (select auth.uid()) = user_id );

-- candidates: INSERT own rows
create policy "Users insert own candidates"
  on public.candidates for insert to authenticated
  with check ( (select auth.uid()) = user_id );

-- analyses: SELECT own rows
create policy "Users read own analyses"
  on public.analyses for select to authenticated
  using ( (select auth.uid()) = user_id );

-- analyses: INSERT own rows
create policy "Users insert own analyses"
  on public.analyses for insert to authenticated
  with check ( (select auth.uid()) = user_id );

-- analyses: UPDATE own rows (status progression, match_summary, error_message, completed_at)
create policy "Users update own analyses"
  on public.analyses for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

-- analysis_questions: SELECT own rows (via analysis ownership)
create policy "Users read own analysis questions"
  on public.analysis_questions for select to authenticated
  using (
    analysis_id in (
      select id from public.analyses where user_id = (select auth.uid())
    )
  );

-- analysis_questions: INSERT own rows (via analysis ownership)
create policy "Users insert own analysis questions"
  on public.analysis_questions for insert to authenticated
  with check (
    analysis_id in (
      select id from public.analyses where user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 6. INDEXES on FK columns
-- ---------------------------------------------------------------------------

create index candidates_user_id_idx on public.candidates (user_id);
create index analyses_user_id_idx on public.analyses (user_id);
create index analyses_candidate_id_idx on public.analyses (candidate_id);
create index analyses_job_profile_id_idx on public.analyses (job_profile_id);
create index analysis_questions_analysis_id_idx on public.analysis_questions (analysis_id);
create index analysis_questions_category_idx on public.analysis_questions (category);

-- ---------------------------------------------------------------------------
-- 7. SEED DATA — Predefined QA job profiles
-- ---------------------------------------------------------------------------

insert into public.job_profiles (name, seniority_level, description, expected_skills)
values
  (
    'Manual QA',
    'junior',
    'Entry-level manual tester responsible for executing test cases, reporting bugs, and learning structured testing methodologies under senior guidance.',
    '[
      {"name": "Test case design", "category": "methodology"},
      {"name": "Bug reporting", "category": "methodology"},
      {"name": "Exploratory testing", "category": "methodology"},
      {"name": "Regression testing", "category": "methodology"},
      {"name": "Smoke testing", "category": "methodology"},
      {"name": "JIRA", "category": "tool"},
      {"name": "TestRail", "category": "tool"},
      {"name": "Chrome DevTools", "category": "tool"},
      {"name": "ISTQB Foundation knowledge", "category": "concept"},
      {"name": "Agile/Scrum basics", "category": "concept"}
    ]'::jsonb
  ),
  (
    'Manual QA',
    'mid',
    'Experienced manual tester who designs test strategies, mentors juniors, coordinates with developers on defect resolution, and owns quality for assigned features.',
    '[
      {"name": "Test strategy design", "category": "methodology"},
      {"name": "Risk-based testing", "category": "methodology"},
      {"name": "Acceptance testing", "category": "methodology"},
      {"name": "Cross-browser testing", "category": "methodology"},
      {"name": "Mobile testing", "category": "methodology"},
      {"name": "API testing basics", "category": "methodology"},
      {"name": "JIRA", "category": "tool"},
      {"name": "TestRail", "category": "tool"},
      {"name": "Postman", "category": "tool"},
      {"name": "Charles Proxy", "category": "tool"},
      {"name": "Test planning", "category": "concept"},
      {"name": "Defect lifecycle management", "category": "concept"}
    ]'::jsonb
  ),
  (
    'Manual QA',
    'senior',
    'Senior quality specialist who defines test processes, drives quality culture across teams, performs complex system and integration testing, and makes build/release quality decisions.',
    '[
      {"name": "Test process definition", "category": "methodology"},
      {"name": "Integration testing", "category": "methodology"},
      {"name": "System testing", "category": "methodology"},
      {"name": "Performance testing basics", "category": "methodology"},
      {"name": "Security testing basics", "category": "methodology"},
      {"name": "Test architecture", "category": "concept"},
      {"name": "Quality metrics and KPIs", "category": "concept"},
      {"name": "Release management", "category": "concept"},
      {"name": "CI/CD awareness", "category": "concept"},
      {"name": "JIRA", "category": "tool"},
      {"name": "Confluence", "category": "tool"},
      {"name": "TestRail", "category": "tool"},
      {"name": "Mentoring and leadership", "category": "concept"}
    ]'::jsonb
  ),
  (
    'Automation QA',
    'Python',
    'Test automation engineer specializing in Python-based frameworks, building and maintaining automated test suites for web applications and APIs.',
    '[
      {"name": "Python", "category": "language"},
      {"name": "pytest", "category": "framework"},
      {"name": "Selenium WebDriver", "category": "framework"},
      {"name": "requests library", "category": "framework"},
      {"name": "Page Object Model", "category": "concept"},
      {"name": "CI/CD integration", "category": "concept"},
      {"name": "API testing", "category": "methodology"},
      {"name": "Data-driven testing", "category": "methodology"},
      {"name": "Git", "category": "tool"},
      {"name": "Jenkins/GitHub Actions", "category": "tool"},
      {"name": "Docker basics", "category": "tool"},
      {"name": "BDD/Behave", "category": "framework"}
    ]'::jsonb
  ),
  (
    'Automation QA',
    'Java',
    'Test automation engineer specializing in Java-based frameworks, building robust automated test suites with strong OOP patterns and enterprise testing tools.',
    '[
      {"name": "Java", "category": "language"},
      {"name": "Selenium WebDriver", "category": "framework"},
      {"name": "TestNG", "category": "framework"},
      {"name": "JUnit", "category": "framework"},
      {"name": "Maven/Gradle", "category": "tool"},
      {"name": "Page Object Model", "category": "concept"},
      {"name": "REST Assured", "category": "framework"},
      {"name": "CI/CD integration", "category": "concept"},
      {"name": "Git", "category": "tool"},
      {"name": "Jenkins", "category": "tool"},
      {"name": "Cucumber/BDD", "category": "framework"},
      {"name": "Design patterns for testing", "category": "concept"}
    ]'::jsonb
  ),
  (
    'Automation QA',
    'Playwright',
    'Test automation engineer specializing in Playwright for modern web application testing with cross-browser support, network interception, and component testing.',
    '[
      {"name": "TypeScript", "category": "language"},
      {"name": "JavaScript", "category": "language"},
      {"name": "Playwright", "category": "framework"},
      {"name": "Playwright Test Runner", "category": "framework"},
      {"name": "Cross-browser testing", "category": "methodology"},
      {"name": "Network interception", "category": "concept"},
      {"name": "Visual regression testing", "category": "methodology"},
      {"name": "Component testing", "category": "methodology"},
      {"name": "CI/CD integration", "category": "concept"},
      {"name": "Git", "category": "tool"},
      {"name": "GitHub Actions", "category": "tool"},
      {"name": "API mocking", "category": "concept"},
      {"name": "Page Object Model", "category": "concept"}
    ]'::jsonb
  ),
  (
    'Automation QA',
    'Selenium',
    'Test automation engineer specializing in Selenium WebDriver for browser-based test automation with established patterns and grid-based parallel execution.',
    '[
      {"name": "Selenium WebDriver", "category": "framework"},
      {"name": "Selenium Grid", "category": "tool"},
      {"name": "Java", "category": "language"},
      {"name": "Python", "category": "language"},
      {"name": "XPath/CSS selectors", "category": "concept"},
      {"name": "Page Object Model", "category": "concept"},
      {"name": "Explicit/Implicit waits", "category": "concept"},
      {"name": "Cross-browser testing", "category": "methodology"},
      {"name": "TestNG/JUnit", "category": "framework"},
      {"name": "Maven", "category": "tool"},
      {"name": "CI/CD integration", "category": "concept"},
      {"name": "BrowserStack/SauceLabs", "category": "tool"}
    ]'::jsonb
  ),
  (
    'Performance Tester',
    null,
    'Performance testing specialist who designs and executes load, stress, and endurance tests, analyzes bottlenecks, and provides actionable optimization recommendations.',
    '[
      {"name": "JMeter", "category": "tool"},
      {"name": "Gatling", "category": "tool"},
      {"name": "k6", "category": "tool"},
      {"name": "Load testing", "category": "methodology"},
      {"name": "Stress testing", "category": "methodology"},
      {"name": "Endurance testing", "category": "methodology"},
      {"name": "Performance metrics analysis", "category": "concept"},
      {"name": "APM tools (Datadog/New Relic)", "category": "tool"},
      {"name": "Bottleneck identification", "category": "concept"},
      {"name": "HTTP protocol", "category": "concept"},
      {"name": "Database profiling", "category": "concept"},
      {"name": "Scripting (Python/JavaScript)", "category": "language"}
    ]'::jsonb
  ),
  (
    'API Tester',
    null,
    'API testing specialist focused on validating REST and GraphQL endpoints, contract testing, and ensuring backend service reliability and security.',
    '[
      {"name": "REST API testing", "category": "methodology"},
      {"name": "GraphQL testing", "category": "methodology"},
      {"name": "Postman", "category": "tool"},
      {"name": "Newman", "category": "tool"},
      {"name": "curl", "category": "tool"},
      {"name": "Swagger/OpenAPI", "category": "tool"},
      {"name": "Contract testing", "category": "methodology"},
      {"name": "JSON/XML validation", "category": "concept"},
      {"name": "Authentication testing (OAuth, JWT)", "category": "methodology"},
      {"name": "HTTP status codes", "category": "concept"},
      {"name": "Python/JavaScript", "category": "language"},
      {"name": "CI/CD integration", "category": "concept"},
      {"name": "API security testing", "category": "methodology"}
    ]'::jsonb
  )
on conflict (name, seniority_level) do nothing;
