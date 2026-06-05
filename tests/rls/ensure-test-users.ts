import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const TEST_USERS = [
  { email: "rls-cand-update-test@gmail.com", password: "TestPassword123!" },
  { email: "rls-test-user-a@gmail.com", password: "TestPassword123!" },
  { email: "rls-test-user-b@gmail.com", password: "TestPassword123!" },
] as const;

const USER_EXISTS = /already|registered|exists/i;

function serviceRoleKey(): string | null {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
  const projectRef = process.env.SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) return null;

  const result = spawnSync("npx", ["supabase", "projects", "api-keys", "--project-ref", projectRef, "-o", "json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) return null;

  try {
    const keys = JSON.parse(result.stdout) as { name: string; api_key: string }[];
    return keys.find((k) => k.name === "service_role")?.api_key ?? null;
  } catch {
    return null;
  }
}

/** Create stable RLS test users on the linked remote project (local/CLI only; skipped in CI). */
export async function ensureTestUsersExist(): Promise<void> {
  if (process.env.CI || process.env.GITHUB_ACTIONS) return;

  const url = process.env.SUPABASE_TEST_URL ?? process.env.SUPABASE_URL;
  const serviceKey = serviceRoleKey();
  if (!url || !serviceKey) return;

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const { email, password } of TEST_USERS) {
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error && !USER_EXISTS.test(error.message)) {
      // Rate limits or transient errors — sign-in path may still work if user exists
      continue;
    }
  }
}
