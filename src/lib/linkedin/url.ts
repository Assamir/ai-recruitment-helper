const LINKEDIN_PROFILE_RE = /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w%-]+\/?(?:\?.*)?$/i;

export function isLinkedinProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    return LINKEDIN_PROFILE_RE.test(parsed.toString());
  } catch {
    return false;
  }
}

export function normalizeLinkedinProfileUrl(url: string): string {
  const parsed = new URL(url.trim());
  parsed.hash = "";
  parsed.search = "";
  if (!parsed.pathname.endsWith("/")) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed.toString();
}
