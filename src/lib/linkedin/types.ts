export interface ScrapeLinkedinProfileInput {
  browser: import("@cloudflare/playwright").BrowserWorker;
  url: string;
  /** `li_at` session cookie from a logged-in browser session. */
  sessionCookie: string;
  timeoutMs?: number;
}

export interface ScrapeLinkedinProfileResult {
  text: string;
}
