import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

const USER_EXISTS = /already|registered|exists/i;

/** Sign in with a stable test account; sign up only if the user does not exist yet. */
export async function ensureSignedIn(client: SupabaseClient<Database>, email: string, password: string): Promise<void> {
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (!signIn.error) return;

  const signUp = await client.auth.signUp({ email, password });
  if (signUp.error && !USER_EXISTS.test(signUp.error.message)) {
    throw signUp.error;
  }

  const retry = await client.auth.signInWithPassword({ email, password });
  if (retry.error) throw retry.error;
}
