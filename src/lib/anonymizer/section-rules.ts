import type { PiiMatch } from "./patterns";

const MONTH_NAMES = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)/i;

/**
 * Looks at the first 10 non-blank lines of the CV for a candidate name.
 * A name is 2–4 Title Case words on a line by themselves, with no digits
 * or special characters. Section headers (ALL CAPS) are skipped.
 */
export function findCandidateName(text: string): PiiMatch[] {
  const lines = text.split("\n");
  let charOffset = 0;

  for (const line of lines.slice(0, 10)) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      charOffset += line.length + 1;
      continue;
    }

    // Skip ALL CAPS section headers
    if (trimmed === trimmed.toUpperCase()) {
      charOffset += line.length + 1;
      continue;
    }

    // Match 2–4 Title Case words (letters only, no digits or special chars)
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(trimmed)) {
      const start = text.indexOf(trimmed, charOffset);
      if (start !== -1) {
        return [{ match: trimmed, start, end: start + trimmed.length }];
      }
    }

    charOffset += line.length + 1;
  }

  return [];
}

/**
 * Detects company names from experience section lines formatted as:
 *   "Job Title | Company Name | Date Range"
 *
 * Only unique company names are returned (first occurrence wins for position).
 */
export function findCompanyNames(text: string): PiiMatch[] {
  // Match content between pipe delimiters or between a pipe and end-of-line
  const pipePattern = /\|\s+([A-Z][a-zA-Z0-9\s&,.']+?)(?:\s+\||$)/gm;
  const results: PiiMatch[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = pipePattern.exec(text)) !== null) {
    const company = m[1].trim();

    // Filter out date ranges (start with a month name or a 4-digit year)
    if (MONTH_NAMES.test(company) || /^\d{4}/.test(company)) continue;
    // Filter entries that are implausibly short or very long
    if (company.length < 3 || company.length > 60) continue;
    // Filter lines that look like month ranges: "Month YYYY – Month YYYY"
    if (/\d{4}/.test(company)) continue;

    if (seen.has(company)) continue;
    seen.add(company);

    const matchStart = m.index + m[0].indexOf(m[1]);
    results.push({ match: company, start: matchStart, end: matchStart + company.length });
  }

  return results;
}
