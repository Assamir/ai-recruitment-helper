import { loadEnv } from "vite";

const env = loadEnv("", process.cwd(), "");
for (const [key, value] of Object.entries(env)) {
  process.env[key] ??= value;
}

if (!process.env.SUPABASE_TEST_URL && process.env.SUPABASE_URL) {
  process.env.SUPABASE_TEST_URL = process.env.SUPABASE_URL;
}
if (!process.env.SUPABASE_TEST_ANON_KEY && process.env.SUPABASE_KEY) {
  process.env.SUPABASE_TEST_ANON_KEY = process.env.SUPABASE_KEY;
}

import { ensureTestUsersExist } from "./ensure-test-users";

await ensureTestUsersExist();
