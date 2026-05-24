---
project: ai-recruiter
researched_at: 2026-05-24
recommended_platform: Cloudflare Workers + Pages
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers + Pages.**

The project repository is already configured with `@astrojs/cloudflare` v13.5 and `wrangler deploy` — zero adapter migration needed. Cloudflare scores 5/5 on the agent-friendly platform criteria (CLI-first, managed/serverless, agent-readable docs with `llms.txt`, stable deploy API, official MCP server). The free tier covers 100,000 requests per day with 10ms CPU/invocation — sufficient for MVP traffic where the dominant cost (LLM API calls) is I/O wait, not CPU. The developer prioritizes DX and speed of iteration; "ship today without changing anything" is the ultimate DX advantage.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers + Pages** | Pass | Pass | Pass | Pass | Pass | 5/5 |
| **Vercel** | Pass | Pass | Pass | Pass | Pass | 5/5 |
| **GCP Cloud Run** | Pass | Pass | Partial | Pass | Pass | 4.5/5 |
| **Netlify** | Partial | Pass | Pass | Partial | Pass | 3.5/5 |
| **Railway** | Partial | Pass | Pass | Partial | Pass | 3.5/5 |
| **Fly.io** | Pass | Partial | Partial | Pass | Partial | 3/5 |
| **Render** | Partial | Pass | Pass | Partial | Partial | 3/5 |

### Shortlisted Platforms

#### 1. Cloudflare Workers + Pages (Recommended)

Zero migration is the decisive advantage. The repo ships with `@astrojs/cloudflare` v13.5, `wrangler.toml` configured, and CI deploying via `wrangler deploy`. The free tier's 100k requests/day ceiling is effectively unlimited for an MVP with small user scale. Agent workflows are fully supported: `wrangler deploy` / `wrangler rollback` / `wrangler tail` cover the full operational loop, docs publish `llms.txt` and per-page markdown, and an official MCP server enables structured platform access. The edge-first architecture also gives global static asset delivery for free — beneficial even for a single-region user base.

#### 2. Vercel

Scores identically on criteria (5/5) and offers a smoother Node.js runtime that avoids workerd compatibility risks entirely. Fluid compute (GA since April 2025) extends Hobby plan timeouts to 300s — well beyond the 60s LLM pipeline requirement. The gap vs. Cloudflare: requires migrating from `@astrojs/cloudflare` to `@astrojs/vercel`, and memory billing for long I/O-wait functions (GB-hours) can exceed the free tier at scale (100k × 30s × 1GB ≈ 833 GB-hrs vs. 360 GB-hrs included). Official Vercel MCP server supports Cursor. Would be the top pick if the repo weren't already Cloudflare-configured.

#### 3. GCP Cloud Run

Scores 4.5/5 (partial on agent docs — no root `llms.txt`, though per-page `.md` URLs work). Full Node.js runtime eliminates all workerd compatibility concerns. The developer has prior GCP experience (familiarity boost). Free tier is generous: 2M requests + 180k vCPU-seconds/month. Request timeout extends to 3600s (vs. Workers' 30s CPU cap) — the most headroom of any shortlisted platform. The gap: more initial setup overhead (Dockerfile, GCP project, billing account, IAM, Artifact Registry) compared to the "already works" state of Cloudflare. Rollback is traffic-migration based rather than a simple CLI command. Better suited as a migration target if workerd constraints become blocking.

## Anti-Bias Cross-Check: Cloudflare Workers + Pages

### Devil's Advocate — Weaknesses

1. **CPU time limit masks real cost.** Free tier = 10ms CPU/invocation. LLM API calls are I/O-wait (not CPU), but CV parsing (pdf-parse, mammoth for .docx), text anonymization, and response serialization are CPU work. A complex CV could exceed 10ms CPU, forcing upgrade to the $5/mo paid plan (30s CPU cap).
2. **workerd is not Node.js — library compatibility is a gamble.** Despite `nodejs_compat`, PDF/DOCX parsing libraries often rely on Node.js internals (`fs`, `Buffer` edge cases, `stream` specifics). Failures surface only at runtime, not during build or testing.
3. **No background execution without architectural complexity.** The 60-second LLM pipeline must fit in one request lifecycle. Retry logic or multi-step processing requires Cloudflare Queues + a separate consumer Worker — a fundamentally different architecture.
4. **Local development fidelity gap.** `wrangler dev` uses Miniflare (local simulation), not the production workerd runtime. Subtle differences in module resolution and crypto APIs can produce production-only bugs.
5. **Vendor lock-in escalation path.** Each Cloudflare-specific binding adopted (KV, R2, D1, Queues) deepens lock-in. Migration cost grows non-linearly if full Node.js is ever needed.

### Pre-Mortem — How This Could Fail

The team deployed their Astro 6 QA recruitment tool on Cloudflare Workers — zero migration, free tier, easy win. Month one was smooth: simple CV text analysis worked. Month two, they added PDF upload support. The `pdf-parse` library worked in Miniflare but produced corrupted text for certain PDFs in production — `Buffer.from()` behavior differed under `nodejs_compat`. They patched with a workaround. Month three, larger CVs pushed CPU past 10ms on free tier; they upgraded to paid. Month four, LLM rate-limit retries needed background processing — but Workers has no `setTimeout` beyond the request lifecycle. They built Queues + consumer Worker, doubling infrastructure. By month five they had a Cloudflare-specific system untestable locally, unmigrable elsewhere, and costing more developer-hours than a simple Node.js platform ever would. The "zero migration" decision saved one day in week one and cost three weeks by month five.

### Unknown Unknowns

- **Astro 6 prerender + workerd:** Pages with `prerender = true` use relative `fetch('/')` during build. On workerd, these fail silently. Requires `prerenderEnvironment: 'node'` or per-page `prerender = false`.
- **Supabase Auth cookie size:** Cloudflare enforces 8KB per HTTP header. Large JWTs with custom claims can be silently truncated, causing invisible auth failures.
- **Workers Unbound rebranding:** The tech-stack.md mentions "Workers Unbound for the 60-second analysis pipeline" — this was merged into the standard paid plan. Billing model has changed; older docs are inaccurate.
- **No graceful shutdown on deploy:** `wrangler deploy` replaces the Worker instantly. In-flight 60-second analysis requests may be terminated if a deploy lands mid-processing.
- **Cross-network latency to Supabase:** Every DB call crosses from Cloudflare's edge to Supabase's region (20-80ms per query). Fine for occasional reads; painful for sequential multi-query analysis pipelines.

## Operational Story

- **Preview deploys**: Every push to a non-production branch creates a preview URL at `<branch>.<project>.pages.dev`. Preview deployments are public by default — protect sensitive previews with Cloudflare Access (free for up to 50 users). Fork PRs do not trigger previews without explicit CI configuration.
- **Secrets**: Environment variables and secrets live in Cloudflare dashboard or are set via `wrangler secret put <KEY>`. Secrets are encrypted at rest, not readable after creation (write-only). Rotation: delete and re-create. GitHub Actions CI injects `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from GitHub Secrets for automated deploys.
- **Rollback**: `wrangler rollback [VERSION_ID]` reverts to a previous deployment version. Time-to-revert: seconds (instant traffic shift). Caveat: database migrations (Supabase) do not roll back automatically — application code rollback may be incompatible with a forward-migrated schema.
- **Approval**: Publishing to production (`wrangler deploy`) can be automated by an agent. Rotating the primary API token, modifying billing, and deleting Workers require human approval via dashboard. Domain routing changes (DNS) are CLI-scriptable but carry risk.
- **Logs**: `wrangler tail` streams real-time logs (filter by status, method, path). For persistent log storage, enable Logpush (paid) to an external sink. CI pipeline logs live in GitHub Actions. MCP server at `mcp.cloudflare.com` provides structured access to deployment status and observability.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| PDF/DOCX parsing fails on workerd runtime | Devil's advocate | Medium | High | Test pdf-parse and mammoth on Workers early in sprint 1. Fallback: parse client-side or via a Supabase Edge Function (Deno, full Node compat). |
| CPU exceeds 10ms free-tier cap during CV processing | Devil's advocate | High | Low | Budget $5/mo Workers Paid from the start. 30s CPU cap is generous for text processing. |
| 60s LLM pipeline needs retry/queue logic | Devil's advocate | Low | Medium | MVP scope: single request, no retries. If needed later: Cloudflare Queues (GA) or migrate analysis route to GCP Cloud Run. |
| Miniflare/production parity bugs | Devil's advocate | Medium | Medium | Run integration tests against a staging Worker (free). Use `wrangler dev --remote` for production-fidelity local testing. |
| Vendor lock-in blocks future migration | Devil's advocate | Low | Medium | Keep Cloudflare-specific bindings minimal (use Supabase for DB/auth/storage, not D1/R2). Only the deploy layer is Cloudflare-specific. |
| Prerender + workerd build failures | Unknown unknowns | Medium | Low | Set `prerenderEnvironment: 'node'` in `astro.config.mjs` or use `prerender = false` for dynamic pages. |
| Supabase cookie truncation at 8KB | Unknown unknowns | Low | Medium | Keep JWT claims minimal. Monitor auth failures in production logs. |
| In-flight request killed on deploy | Unknown unknowns | Low | Medium | Deploy during low-traffic windows. Implement client-side retry on 502/503 for analysis requests. |
| Cross-network latency to Supabase | Unknown unknowns | Medium | Low | Batch DB reads where possible. Consider Hyperdrive (GA, $5/mo paid plan) for connection pooling if latency becomes an issue. |

## Getting Started

1. **Verify existing setup works:** Run `npm run build` — the repo already has `@astrojs/cloudflare` and `wrangler.toml` configured. If build succeeds, you're deploy-ready.

2. **Set Supabase secrets:** `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` — enter values when prompted.

3. **Deploy to production:** `npx wrangler deploy` — outputs the production URL. Verify the app loads and auth works.

4. **Enable preview deploys in CI:** The existing `.github/workflows/ci.yml` runs lint + build. Add a deploy step using `wrangler deploy` with `--env preview` for non-master branches, gated by the `CLOUDFLARE_API_TOKEN` GitHub Secret.

5. **Set prerender safety valve:** Add `prerenderEnvironment: 'node'` to the Cloudflare adapter config in `astro.config.mjs` to avoid workerd prerender issues with Supabase SSR calls.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (existing GitHub Actions workflow covers this)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare-specific advanced features (Durable Objects, Workers AI, Vectorize)
