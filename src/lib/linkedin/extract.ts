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

export function classifyLinkedinPageText(text: string): "success" | "auth" | "not_found" {
  const lower = text.toLowerCase();
  if (
    lower.includes("sign in") &&
    (lower.includes("join linkedin") || lower.includes("welcome back") || lower.includes("checkpoint"))
  ) {
    return "auth";
  }
  if (lower.includes("this page doesn't exist") || lower.includes("page not found")) {
    return "not_found";
  }
  return "success";
}
