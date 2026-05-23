---
bootstrapped_at: 2026-05-23T18:17:00+02:00
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: ai-recruiter
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: ai-recruiter
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

Solo developer shipping a QA recruitment analysis tool in 6 after-hours weeks with auth and AI/LLM analysis needs a battle-tested, agent-friendly starter that minimizes integration work. The 10x Astro Starter is the recommended default for (web-app, js) and clears all four agent-friendly gates — typed (TypeScript + Zod), convention-based (file-based routes + island architecture), popular in training data, and well-documented. Supabase provides PostgreSQL, auth, and storage out of the box; Cloudflare Pages handles edge deployment. AI/LLM integration fits via Astro API routes, with the edge runtime's execution-time constraint manageable through Workers Unbound for the 60-second analysis pipeline. The standard path was taken — no quality overrides, no agent-friendly gaps to compensate for.

## Pre-scaffold verification

| Signal        | Value                                                   | Severity | Notes                                  |
| ------------- | ------------------------------------------------------- | -------- | -------------------------------------- |
| npm package   | not run                                                 | —        | cmd_template uses git clone, not npm   |
| GitHub repo   | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url                     |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned starter repo, deleted upstream .git/ before moving files up)
**Exit code**: 0
**Files moved**: 19
**Conflicts (.scaffold siblings)**: CLAUDE.md -> CLAUDE.md.scaffold
**.gitignore handling**: moved silently (no pre-existing .gitignore in cwd)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0

#### HIGH findings

- **devalue** v5.6.3–5.8.0 — DoS via sparse array deserialization (GHSA-77vg-94rm-hx3p, CVSS 7.5). Transitive dependency. Fix available via `npm audit fix`.

#### MODERATE findings

- **ws** v8.0.0–8.20.0 — Uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx, CVSS 4.4). Transitive via miniflare/supabase-realtime-js. Fix available.
- **yaml** v2.0.0–2.8.2 — Stack Overflow via deeply nested YAML collections (GHSA-48c2-rrv3-qjmp, CVSS 4.3). Transitive via yaml-language-server. Fix requires semver-major bump of @astrojs/check.
- **@astrojs/check** >=0.9.3 — Affected via @astrojs/language-server -> volar-service-yaml -> yaml-language-server -> yaml. Direct dependency. Fix requires downgrade to 0.9.2 (semver-major).
- **@astrojs/language-server** >=2.14.0 — Affected via volar-service-yaml. Transitive.
- **volar-service-yaml** <=0.0.70 — Affected via yaml-language-server. Transitive.
- **yaml-language-server** — Affected via yaml. Transitive.
- **wrangler** v3.108.0–4.93.0 — Affected via miniflare -> ws. Direct dependency. Fix available.
- **miniflare** — Affected via ws. Transitive. Fix available.
- **@cloudflare/vite-plugin** — Affected via miniflare, wrangler, ws. Transitive. Fix available.

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | github-actions      |
| ci_default_flow         | auto-deploy-on-merge|
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | false               |
| has_ai                  | true                |
| has_background_jobs     | false               |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
