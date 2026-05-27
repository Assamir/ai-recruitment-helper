# Repository Guidelines

AI Recruitment Helper is a web application for QA recruitment built with Astro 6, React 19, TypeScript 5, Tailwind 4, and Supabase, deployed on Cloudflare Workers.

## Hard Rules

- Never write to `context/archive/`. Archived changes are immutable.
- Never commit `.env` files. Copy `@.env.example` and populate `SUPABASE_URL`, `SUPABASE_KEY`, and LLM vars locally.
- All changes must pass lint and build before merging — CI enforces both on push/PR to `master`.
- Node version: 22.14.0 (pinned in `@.nvmrc`). CI injects `SUPABASE_URL` and `SUPABASE_KEY` from GitHub secrets.

## Deployment

Deployed on Cloudflare Workers via `wrangler deploy`. CI auto-deploys on push to `master` and creates preview versions on PRs. See `context/deployment/deploy-plan.md` for the full operational runbook.

- `npm run deploy` — build and deploy to production
- `npm run rollback` — revert to the previous Worker version
- `npx wrangler tail` — stream real-time production logs

Supabase DB migrations must be backward-compatible (additive only: new columns with defaults, no renames or drops in the same deploy). `wrangler rollback` reverts application code instantly but does not roll back the database schema — a forward-migrated schema with a rolled-back Worker will break if migrations are destructive.

## Pitfalls

- `npx astro sync` must run before `npm run build` — it generates `astro:env/server` type stubs. CI does this automatically but local builds after a clean install will fail without it.
- `createClient()` in `@src/lib/supabase.ts` returns `null` when env vars are missing. Every call site must handle `null` — middleware already does, but new API routes must check too.
- Supabase env vars are declared `optional: true` in `@astro.config.mjs` so the build passes without them, but the app is non-functional at runtime without valid values.
- **workerd is not Node.js.** The `nodejs_compat` flag covers most APIs, but PDF/DOCX parsing libraries (`pdf-parse`, `mammoth`) may rely on unsupported Node.js internals. Test any new native-Node dependency on Workers early (`wrangler dev --remote` for production-fidelity checks). Failures surface only at runtime, not during build.
- **`wrangler deploy` kills in-flight requests.** The Worker is replaced instantly. For short requests (auth, page renders) this is safe. When the 60-second CV analysis pipeline is added, implement client-side retry on 502/503 and deploy during low-traffic windows.
- **Cross-network latency to Supabase.** Every DB call crosses from Cloudflare edge to Supabase's region (20-80ms per query). Batch reads where possible in multi-query pipelines. Consider Cloudflare Hyperdrive for connection pooling if latency becomes a bottleneck.

## Project Structure

Single-package Astro app. Source lives in `src/` with `components/{auth,ui}/`, `layouts/`, `lib/`, `pages/{auth,api}/`, `styles/`, and `middleware.ts` (auth route guard). Project context documents live in `context/foundation/` — see `@context/foundation/prd.md` for product requirements. Path alias `@/*` maps to `./src/*` in `@tsconfig.json`. Unit tests live in `tests/` at the project root.

## Build, Test, and Development Commands

- `npm run dev` — start local dev server
- `npm run build` — production build (requires `SUPABASE_URL` and `SUPABASE_KEY` env vars)
- `npm run lint` — ESLint check
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier formatting
- `npm run deploy` — build and deploy to Cloudflare Workers production
- `npm run rollback` — revert to the previous Worker version

- `npm run test` — run Vitest unit tests
- `npm run test:watch` — run Vitest in watch mode

## LLM Integration

The LLM client module lives at `src/lib/llm/`. It supports two providers switchable via the `LLM_PROVIDER` env var:

- `lmstudio` (default) — local LM Studio at `http://localhost:1234/v1`, no API key needed
- `openrouter` — cloud provider, requires `OPENROUTER_API_KEY`

Key files: `client.ts` (provider factory + `completeLLM` service), `config.ts` (Astro env reader), `types.ts` (Zod schemas, defaults), `errors.ts` (typed error hierarchy). All env vars (`OPENROUTER_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`) are declared `optional: true` in `@astro.config.mjs` — the build passes without them. For production Workers, set secrets via `npx wrangler secret put <KEY>`.

The viability test endpoint at `POST /api/llm/health` sends a synthetic CV through the LLM and returns timing metrics. It requires authentication (returns 401 JSON without it).

`getLLMConfig()` returns `null` when the selected provider's credentials are missing (same pattern as `createClient()` for Supabase). Every call site must handle `null`.

## Coding Style & Naming Conventions

Lint and format rules live in `@eslint.config.js` and `@.prettierrc.json`. Husky pre-commit hook runs lint-staged: ESLint fix on `*.{ts,tsx,astro}`, Prettier on `*.{json,css,md}`.

Components use PascalCase filenames (`LoginForm.tsx`). Pages and API routes follow Astro file-based routing in `src/pages/`.

## Commit & Pull Request Guidelines

Commit messages use imperative mood with an action-verb prefix: `Add ...`, `Update ...`, `Fix ...`, `Bootstrap ...`. CI runs on push and pull requests targeting `master` — the pipeline installs dependencies, runs `astro sync`, then lint and build. On push to `master`, a deploy job runs `wrangler deploy` to production. On PRs, a preview job runs `wrangler versions upload` to create a preview URL. See `@.github/workflows/ci.yml`.
