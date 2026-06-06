import { MAX_LINKEDIN_TEXT_CHARS } from "@/lib/analysis/limits";

/** Pure DOM/text extraction for unit tests — no live browser dependency. */
export function extractLinkedinProfileText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const text = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');

  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !/^see more$/i.test(line) && !/^show all$/i.test(line));

  const joined = lines.join("\n");
  if (joined.length <= MAX_LINKEDIN_TEXT_CHARS) {
    return joined;
  }
  return joined.slice(0, MAX_LINKEDIN_TEXT_CHARS);
}

export type LinkedinPageClassification = "success" | "auth" | "not_found";

// LinkedIn redirects an unauthenticated/blocked request to one of these paths
// regardless of UI language, so the final URL is the most reliable signal.
const AUTH_URL_RE = /\/(authwall|login|uas\/login|checkpoint|signup|join)\b/i;

export function isLinkedinAuthUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    if (AUTH_URL_RE.test(pathname)) return true;
    // A valid profile fetch stays on /in/<slug>; anything else means we were
    // bounced off the profile (login wall / interstitial).
    return !/\/in\//i.test(pathname);
  } catch {
    return false;
  }
}

// Language-agnostic-ish markers for the login/join wall served on a /in/ URL.
const AUTH_TEXT_MARKERS = [
  "join linkedin",
  "welcome back",
  "checkpoint",
  "sign in to",
  "new to linkedin",
  "agree & join",
  "forgot password",
  "zaloguj si", // PL: "Zaloguj się"
  "nie pami", // PL: "Nie pamiętasz hasła"
  "do linkedin", // PL: "Dołącz do LinkedIn"
];

// "Profile/page doesn't exist" wording (EN + PL). A strong, explicit signal.
const NOT_FOUND_TEXT_MARKERS = [
  "this page doesn't exist",
  "page not found",
  "couldn't find this page",
  "page isn't available",
  "page is not available",
  "isn't available right now",
  "nie znaleziono",
  "ta strona nie istnieje",
  "strona nie istnieje",
  "ta strona jest niedost", // PL: "Ta strona jest niedostępna"
];

function isNotFoundText(lower: string): boolean {
  return NOT_FOUND_TEXT_MARKERS.some((marker) => lower.includes(marker));
}

export function classifyLinkedinPageText(text: string): LinkedinPageClassification {
  const lower = text.toLowerCase();
  if (isNotFoundText(lower)) {
    return "not_found";
  }
  if (AUTH_TEXT_MARKERS.some((marker) => lower.includes(marker))) {
    return "auth";
  }
  return "success";
}

/** Combine the post-navigation URL (strongest signal) with page-text heuristics. */
export function classifyLinkedinPage(input: { url: string; text: string }): LinkedinPageClassification {
  // Explicit "doesn't exist" wording wins even if LinkedIn bounced us to a
  // login-styled 404, so a bad URL reads as not-found rather than auth.
  if (isNotFoundText(input.text.toLowerCase())) {
    return "not_found";
  }
  if (isLinkedinAuthUrl(input.url)) {
    return "auth";
  }
  return classifyLinkedinPageText(input.text);
}
