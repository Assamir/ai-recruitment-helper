import { findCandidateName } from "@/lib/anonymizer/section-rules";

/**
 * Splits a full name string into first and last name parts.
 *
 * Split rule:
 *   - Trim and collapse internal whitespace.
 *   - First space-delimited token → firstName.
 *   - Remaining tokens joined with a space → lastName.
 *   - Single token → firstName set, lastName null.
 *   - Empty / whitespace-only / nullish → both null.
 */
export function splitFullName(full: string | null | undefined): { firstName: string | null; lastName: string | null } {
  if (!full) return { firstName: null, lastName: null };

  const tokens = full.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };

  return {
    firstName: tokens[0],
    lastName: tokens.slice(1).join(" "),
  };
}

/**
 * Extracts a candidate name from raw CV text using the header heuristic,
 * then splits it into first/last name parts.
 *
 * Returns both null when no name is detected in the header.
 */
export function extractCandidateName(cvText: string): { firstName: string | null; lastName: string | null } {
  const matches = findCandidateName(cvText);
  if (matches.length === 0) return { firstName: null, lastName: null };
  return splitFullName(matches[0].match);
}
