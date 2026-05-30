/**
 * Returns true iff the candidate has no remaining analyses after deletion,
 * meaning its row (which holds raw CV PII) can be safely removed.
 *
 * Pure function; no DB access. Kept separate so the route stays thin
 * and the rule is trivially unit-testable.
 */
export function shouldDeleteCandidate(remainingAnalysisCount: number): boolean {
  return remainingAnalysisCount === 0;
}
