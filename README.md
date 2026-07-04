# AI Recruitment Helper

A privacy-preserving web app that helps internal IT recruiters prepare for QA candidate interviews. Recruiters upload a CV (`.pdf`/`.docx`) and select a QA job profile (or paste custom requirements); the app anonymizes the candidate's PII, runs an LLM-based audit of the CV against the requirements, and returns a structured interview question set categorized by anomaly type (missing elements, contradictions, vague claims, red flags) — each with context and a suggested expected answer.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and Postgres backend
- [Vercel AI SDK](https://ai-sdk.dev/) - LLM integration (LM Studio local or OpenRouter cloud)
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/Assamir/ai-recruitment-helper.git
cd ai-recruitment-helper
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run typecheck` - Run `astro sync && astro check`
- `npm run format` - Run Prettier
- `npm run test` - Run Vitest unit tests
- `npm run test:watch` - Run Vitest in watch mode
- `npm run test:e2e` - Run Playwright end-to-end tests
- `npm run test:e2e:ui` - Run Playwright tests in UI mode
- `npm run db:types` - Regenerate Supabase TypeScript types
- `npm run deploy` - Build and deploy to Cloudflare Workers
- `npm run rollback` - Revert to the previous Worker version

## Project Structure

```md
.
├── src/
│ ├── components/ # UI components (Astro & React), incl. auth/, ui/, analysis/
│ ├── db/ # Generated database types
│ ├── layouts/ # Astro layouts
│ ├── lib/ # Domain logic: llm/, analysis/, anonymizer/, cv-parser/, export/, linkedin/, supabase.ts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── styles/ # Global styles
│ └── middleware.ts # Auth route guard
├── supabase/
│ └── migrations/ # Supabase SQL migrations
├── tests/ # Vitest unit tests and Playwright e2e tests
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## LLM Configuration

The LLM client lives in `src/lib/llm/` and supports two providers, switchable via the `LLM_PROVIDER` env var:

- `lmstudio` (default) — local [LM Studio](https://lmstudio.ai/) at `http://localhost:1234/v1`, no API key needed
- `openrouter` — cloud provider, requires `OPENROUTER_API_KEY`

| Variable             | Description                                                        |
| -------------------- | ----------------------------------------------------------------- |
| `LLM_PROVIDER`       | `lmstudio` (default) or `openrouter`                              |
| `LLM_MODEL`          | Model identifier for the selected provider                        |
| `OPENROUTER_API_KEY` | Required only when `LLM_PROVIDER=openrouter`                      |

`getLLMConfig()` returns `null` when the selected provider's credentials are missing, so every call site must handle `null`. For production Workers, set secrets via `npx wrangler secret put <KEY>`.

The viability test endpoint at `POST /api/llm/health` sends a synthetic CV through the LLM and returns timing metrics. It requires authentication (returns 401 JSON without it).

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication and its Postgres database. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

### Database schema

The project uses five tables in the `public` schema, managed via Supabase migrations in `supabase/migrations/`:

| Table                | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `profiles`           | App-level user data, auto-populated on signup via trigger |
| `job_profiles`       | Predefined QA role reference data (9 seeded profiles)    |
| `candidates`         | Uploaded CVs (one row per upload)                        |
| `analyses`           | Analysis runs linking candidate to job profile           |
| `analysis_questions` | Individual generated interview questions per analysis    |

Row-Level Security (RLS) is enabled on all tables. User-owned tables enforce per-user data isolation (`user_id = auth.uid()`). `job_profiles` is read-only for authenticated users.

To apply migrations to a remote project:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

To regenerate TypeScript types after schema changes:

```bash
npm run db:types
```

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth & app routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Protected list of analyses (redirects to `/auth/signin` if unauthenticated) |
| `/dashboard/new`      | Upload a CV and start a new analysis                                    |
| `/dashboard/[id]`     | View a single analysis and its generated question set                  |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

Build and deploy in one step:

```bash
npm run deploy
```

To revert to the previous Worker version:

```bash
npm run rollback
```

Set `SUPABASE_URL`, `SUPABASE_KEY`, and any LLM secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions runs `lint → typecheck → test → build` on every push and PR to `master`. On push to `master`, a deploy job runs `wrangler deploy` to production; on PRs, a preview job runs `wrangler versions upload` to create a preview URL. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets in GitHub for the build step.

## License

MIT
