import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";
import { isServiceRoleKey } from "@/lib/supabase-key";

export { isServiceRoleKey } from "@/lib/supabase-key";

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  if (isServiceRoleKey(SUPABASE_KEY)) {
    // eslint-disable-next-line no-console -- intentional operator signal for misconfiguration
    console.error(
      "SUPABASE_KEY appears to be a service_role JWT — this bypasses RLS. Use the anon/publishable key instead.",
    );
    return null;
  }
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
      },
    },
  });
}
