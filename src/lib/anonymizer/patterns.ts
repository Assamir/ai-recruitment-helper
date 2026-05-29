export interface PiiMatch {
  match: string;
  start: number;
  end: number;
}

function scanPattern(text: string, pattern: RegExp): PiiMatch[] {
  const results: PiiMatch[] = [];
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0]) {
      results.push({ match: m[0], start: m.index, end: m.index + m[0].length });
    }
  }
  return results;
}

export function findEmails(text: string): PiiMatch[] {
  return scanPattern(text, /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
}

export function findPhones(text: string): PiiMatch[] {
  const patterns = [
    // International format: +1-555-123-4567, +44 20 7123 4567, +48 123 456 789
    /[+]\d{1,3}[\s-]?[(]?\d{1,4}[)]?[\s-]?\d{3,4}[\s-]?\d{3,4}(?:[\s-]?\d{1,4})?/,
    // US format with parentheses: (555) 123-4567
    /[(]\d{3}[)][\s]?\d{3}[-\s]?\d{4}/,
  ];

  const seen = new Set<string>();
  const results: PiiMatch[] = [];

  for (const p of patterns) {
    for (const m of scanPattern(text, p)) {
      const key = `${m.start}:${m.end}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(m);
      }
    }
  }

  return results;
}

export function findUrls(text: string): PiiMatch[] {
  // Use character-class syntax for / and . to avoid regex-literal escape issues
  return scanPattern(text, /https?:[/][/][^\s<>'"]+|(?:www[.]|linkedin|github)[.]com[/][^\s<>'"]+/);
}

export function findDates(text: string): PiiMatch[] {
  return scanPattern(text, /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/);
}
