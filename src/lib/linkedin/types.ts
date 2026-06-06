export interface ScrapeLinkedinProfileInput {
  browser: import("@cloudflare/playwright").BrowserWorker;
  url: string;
  sessionCookie: string;
  timeoutMs?: number;
}

export interface ScrapeLinkedinProfileResult {
  text: string;
}
