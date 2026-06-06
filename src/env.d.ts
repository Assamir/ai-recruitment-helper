declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    cfContext: { waitUntil: (promise: Promise<unknown>) => void };
  }
}
