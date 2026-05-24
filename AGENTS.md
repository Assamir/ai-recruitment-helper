# Repository Guidelines

AI Recruitment Helper is a web application for QA recruitment built with Astro 6, React 19, TypeScript 5, Tailwind 4, and Supabase, deployed on Cloudflare Workers.

## Hard Rules

- Never write to `context/archive/`. Archived changes are immutable.
- Never commit `.env` files. Copy `@.env.example` and populate `SUPABASE_URL` and `SUPABASE_KEY` locally.
- All changes must pass lint and build before merging — CI enforces both on push/PR to `master`.
- Node version: 22.14.0 (pinned in `@.nvmrc`). CI injects `SUPABASE_URL` and `SUPABASE_KEY` from GitHub secrets.

## Pitfalls

- `npx astro sync` must run before `npm run build` — it generates `astro:env/server` type stubs. CI does this automatically but local builds after a clean install will fail without it.
- `createClient()` in `@src/lib/supabase.ts` returns `null` when env vars are missing. Every call site must handle `null` — middleware already does, but new API routes must check too.
- Supabase env vars are declared `optional: true` in `@astro.config.mjs` so the build passes without them, but the app is non-functional at runtime without valid values.

## Project Structure

Single-package Astro app. Source lives in `src/` with `components/{auth,ui}/`, `layouts/`, `lib/`, `pages/{auth,api}/`, `styles/`, and `middleware.ts` (auth route guard). Project context documents live in `context/foundation/` — see `@context/foundation/prd.md` for product requirements. Path alias `@/*` maps to `./src/*` in `@tsconfig.json`.

## Build, Test, and Development Commands

- `npm run dev` — start local dev server
- `npm run build` — production build (requires `SUPABASE_URL` and `SUPABASE_KEY` env vars)
- `npm run lint` — ESLint check
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier formatting

No test framework is configured. There is no `npm test` script.

## Coding Style & Naming Conventions

Lint and format rules live in `@eslint.config.js` and `@.prettierrc.json`. Husky pre-commit hook runs lint-staged: ESLint fix on `*.{ts,tsx,astro}`, Prettier on `*.{json,css,md}`.

Components use PascalCase filenames (`LoginForm.tsx`). Pages and API routes follow Astro file-based routing in `src/pages/`.

## Commit & Pull Request Guidelines

Commit messages use imperative mood with an action-verb prefix: `Add ...`, `Update ...`, `Fix ...`, `Bootstrap ...`. CI runs on push and pull requests targeting `master` — the pipeline installs dependencies, runs `astro sync`, then lint and build. See `@.github/workflows/ci.yml`.
