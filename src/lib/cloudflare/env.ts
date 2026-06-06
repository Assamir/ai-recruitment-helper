import type { BrowserWorker } from "@cloudflare/playwright";

export interface WorkerBindings {
  BROWSER?: BrowserWorker;
  LINKEDIN_SESSION_COOKIE?: string;
}

/** Read Cloudflare Worker bindings when running on Workers; null in Vitest / plain Node. */
export async function getWorkerBindings(): Promise<WorkerBindings | null> {
  try {
    const { env } = (await import("cloudflare:workers")) as { env: WorkerBindings };
    return env;
  } catch {
    return null;
  }
}
