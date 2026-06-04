/**
 * Detects Supabase service_role JWT keys (misconfiguration that bypasses RLS).
 * Conservative: only true when payload decodes to role === "service_role".
 */
export function isServiceRoleKey(key: string | undefined | null): boolean {
  if (!key || typeof key !== "string") return false;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = parts[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
    return json.role === "service_role";
  } catch {
    return false;
  }
}
