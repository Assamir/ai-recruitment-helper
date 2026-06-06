import { launch } from "@cloudflare/playwright";
import { MAX_LINKEDIN_TEXT_CHARS } from "@/lib/analysis/limits";
import { classifyLinkedinPageText, extractLinkedinProfileText } from "./extract";
import { LinkedInAuthError, LinkedInNotFoundError, LinkedInScrapeError, LinkedInTimeoutError } from "./errors";
import type { ScrapeLinkedinProfileInput, ScrapeLinkedinProfileResult } from "./types";
import { isLinkedinProfileUrl, normalizeLinkedinProfileUrl } from "./url";

const DEFAULT_TIMEOUT_MS = 25_000;

export { extractLinkedinProfileText, classifyLinkedinPageText, isLinkedinProfileUrl, normalizeLinkedinProfileUrl };

export async function scrapeLinkedinProfile(input: ScrapeLinkedinProfileInput): Promise<ScrapeLinkedinProfileResult> {
  const { browser, url, sessionCookie, timeoutMs = DEFAULT_TIMEOUT_MS } = input;

  if (!isLinkedinProfileUrl(url)) {
    throw new LinkedInScrapeError("Invalid LinkedIn profile URL");
  }

  const normalizedUrl = normalizeLinkedinProfileUrl(url);
  let pwBrowser;
  try {
    pwBrowser = await launch(browser);
    const page = await pwBrowser.newPage();

    await page.context().addCookies([
      {
        name: "li_at",
        value: sessionCookie,
        domain: ".linkedin.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
    ]);

    await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    await expandCollapsibleSections(page, timeoutMs);

    const html = await page.content();
    const text = extractLinkedinProfileText(html);
    const classification = classifyLinkedinPageText(text);

    if (classification === "auth") {
      throw new LinkedInAuthError();
    }
    if (classification === "not_found") {
      throw new LinkedInNotFoundError();
    }
    if (text.trim().length < 50) {
      throw new LinkedInScrapeError("LinkedIn profile text was too short to use");
    }

    return { text: text.slice(0, MAX_LINKEDIN_TEXT_CHARS) };
  } catch (err) {
    if (err instanceof LinkedInScrapeError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "LinkedIn scrape failed";
    if (/timeout/i.test(message)) {
      throw new LinkedInTimeoutError(message);
    }
    throw new LinkedInScrapeError(message);
  } finally {
    await pwBrowser?.close().catch(() => undefined);
  }
}

async function expandCollapsibleSections(page: import("@cloudflare/playwright").Page, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  const selectors = [
    'button:has-text("see more")',
    'button:has-text("See more")',
    'button:has-text("show all")',
    'button:has-text("Show all")',
    'button:has-text("Show all experiences")',
    'button:has-text("Show all education")',
  ];

  for (const selector of selectors) {
    if (Date.now() > deadline) break;
    const buttons = page.locator(selector);
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      if (Date.now() > deadline) break;
      try {
        await buttons.nth(i).click({ timeout: 2_000 });
      } catch {
        // best-effort expansion
      }
    }
  }
}
