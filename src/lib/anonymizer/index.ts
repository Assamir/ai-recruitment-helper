import type { AnonymizationResult } from "./types";
import type { PiiMatch } from "./patterns";
import { findEmails, findPhones, findUrls } from "./patterns";
import { findCandidateName, findCompanyNames } from "./section-rules";

type PiiTag = "email" | "phone" | "url" | "name" | "company";
type TaggedMatch = PiiMatch & { tag: PiiTag };

/** Remove matches that overlap with an earlier (lower start) match. */
function deduplicateOverlapping(matches: TaggedMatch[]): TaggedMatch[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  const result: TaggedMatch[] = [];
  let lastEnd = -1;

  for (const m of sorted) {
    if (m.start >= lastEnd) {
      result.push(m);
      lastEnd = m.end;
    }
  }

  return result;
}

/**
 * Find all character positions of `needle` in `haystack`.
 * Returns matches sorted ascending by start position.
 */
function findAllOccurrences(haystack: string, needle: string): PiiMatch[] {
  const results: PiiMatch[] = [];
  let idx = 0;
  while (idx <= haystack.length - needle.length) {
    const pos = haystack.indexOf(needle, idx);
    if (pos === -1) break;
    results.push({ match: needle, start: pos, end: pos + needle.length });
    idx = pos + 1;
  }
  return results;
}

export function anonymizeCV(text: string): AnonymizationResult {
  if (text.trim().length === 0) {
    return {
      anonymizedText: text,
      piiMap: {},
      piiCount: { names: 0, emails: 0, phones: 0, companies: 0, addresses: 0 },
    };
  }

  const emailMatches = findEmails(text);
  const phoneMatches = findPhones(text);
  const urlMatches = findUrls(text);
  const nameMatches = findCandidateName(text);

  // Two-pass company detection:
  // 1. Find unique company names from pipe-separated experience lines
  // 2. Replace ALL occurrences of each company name throughout the full text
  const uniqueCompanies = findCompanyNames(text);
  const companyPlaceholderMap = new Map<string, string>(); // name → placeholder
  let companyIndex = 0;
  const expandedCompanyMatches: TaggedMatch[] = [];

  for (const c of uniqueCompanies) {
    if (!companyPlaceholderMap.has(c.match)) {
      companyIndex++;
      companyPlaceholderMap.set(c.match, `[COMPANY_${companyIndex}]`);
    }
    for (const occurrence of findAllOccurrences(text, c.match)) {
      expandedCompanyMatches.push({ ...occurrence, tag: "company" as const });
    }
  }

  const tagged: TaggedMatch[] = [
    ...nameMatches.map((m) => ({ ...m, tag: "name" as const })),
    ...emailMatches.map((m) => ({ ...m, tag: "email" as const })),
    ...phoneMatches.map((m) => ({ ...m, tag: "phone" as const })),
    ...urlMatches.map((m) => ({ ...m, tag: "url" as const })),
    ...expandedCompanyMatches,
  ];

  const deduped = deduplicateOverlapping(tagged);

  // Assign placeholders in ascending text order
  const piiMap: Record<string, string> = {};

  const withPlaceholders = deduped.map((m) => {
    let placeholder: string;

    switch (m.tag) {
      case "email":
        placeholder = "[EMAIL]";
        break;
      case "phone":
        placeholder = "[PHONE]";
        break;
      case "url":
        placeholder = "[URL]";
        break;
      case "name":
        placeholder = "[CANDIDATE_NAME]";
        break;
      case "company":
        placeholder = companyPlaceholderMap.get(m.match) ?? "[COMPANY]";
        break;
    }

    if (!(placeholder in piiMap)) {
      piiMap[placeholder] = m.match;
    }

    return { ...m, placeholder };
  });

  // Replace from end to start to preserve character indices
  withPlaceholders.sort((a, b) => b.start - a.start);
  let result = text;
  for (const m of withPlaceholders) {
    result = result.slice(0, m.start) + m.placeholder + result.slice(m.end);
  }

  return {
    anonymizedText: result,
    piiMap,
    piiCount: {
      names: nameMatches.length,
      emails: emailMatches.length,
      phones: phoneMatches.length,
      companies: uniqueCompanies.length,
      addresses: 0,
    },
  };
}

export type { AnonymizationResult };
