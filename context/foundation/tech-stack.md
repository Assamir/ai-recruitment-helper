---
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
---

## Why this stack

Solo developer shipping a QA recruitment analysis tool in 6 after-hours weeks with auth and AI/LLM analysis needs a battle-tested, agent-friendly starter that minimizes integration work. The 10x Astro Starter is the recommended default for (web-app, js) and clears all four agent-friendly gates — typed (TypeScript + Zod), convention-based (file-based routes + island architecture), popular in training data, and well-documented. Supabase provides PostgreSQL, auth, and storage out of the box; Cloudflare Pages handles edge deployment. AI/LLM integration fits via Astro API routes, with the edge runtime's execution-time constraint manageable through Workers Unbound for the 60-second analysis pipeline. The standard path was taken — no quality overrides, no agent-friendly gaps to compensate for.
