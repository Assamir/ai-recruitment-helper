import type { AnalysisResponse } from "@/lib/analysis/schema";

/** Minimum token overlap ratio (exact + bigram) required to treat a span as grounded. */
const GROUNDED_OVERLAP_THRESHOLD = 0.55;

const PLACEHOLDER_PATTERN = /\[(?:CANDIDATE_NAME|EMAIL|PHONE|URL|COMPANY(?:_\d+)?)\]/gi;

const STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "been",
  "being",
  "both",
  "could",
  "does",
  "from",
  "have",
  "into",
  "more",
  "only",
  "other",
  "over",
  "role",
  "show",
  "some",
  "such",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
  "you",
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "can",
  "how",
  "why",
  "who",
  "was",
  "were",
  "has",
  "had",
  "any",
  "all",
  "its",
  "our",
  "expected",
  "profile",
  "timeline",
  "anonymized",
]);

export interface FaithfulnessOracle {
  anonymizedText: string;
  profile: {
    name: string;
    description: string;
    expected_skills: unknown;
  };
}

export interface UngroundedFinding {
  questionIndex: number;
  field: "question" | "rationale";
  span: string;
  reason: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(PLACEHOLDER_PATTERN, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOracleString(oracle: FaithfulnessOracle): string {
  const skillsText =
    typeof oracle.profile.expected_skills === "string"
      ? oracle.profile.expected_skills
      : JSON.stringify(oracle.profile.expected_skills ?? []);

  return [oracle.anonymizedText, oracle.profile.name, oracle.profile.description, skillsText].join("\n");
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function bigrams(tokens: string[]): string[] {
  const grams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    grams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return grams;
}

function overlapScore(span: string, oracleNormalized: string): number {
  const spanNorm = normalize(span);
  if (!spanNorm) return 1;

  if (oracleNormalized.includes(spanNorm)) return 1;

  const spanTokens = tokenize(span);
  if (spanTokens.length === 0) return 1;

  const oracleTokens = new Set(tokenize(oracleNormalized));
  const tokenHits = spanTokens.filter((t) => oracleTokens.has(t)).length;
  const tokenScore = tokenHits / spanTokens.length;

  const spanBigrams = bigrams(spanTokens);
  const oracleBigramSet = new Set(bigrams(tokenize(oracleNormalized)));
  const bigramHits = spanBigrams.filter((g) => oracleBigramSet.has(g)).length;
  const bigramScore = spanBigrams.length === 0 ? 0 : bigramHits / spanBigrams.length;

  return spanBigrams.length === 0 ? tokenScore : Math.max(tokenScore, bigramScore);
}

/** Salient spans: numbers, proper-noun phrases, technical tokens — not connective prose. */
function extractSalientSpans(text: string): string[] {
  const withoutPlaceholders = text.replace(PLACEHOLDER_PATTERN, " ");
  const spans = new Set<string>();

  const patterns = [
    /\b\d+(?:\.\d+)?%?\b/g,
    /\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)+\b/g,
    /\b[A-Za-z]*\d[A-Za-z0-9/-]*\b/g,
    /\b[A-Z][a-z]{4,}\b/g,
    /\b[A-Z]{4,}\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of withoutPlaceholders.matchAll(pattern)) {
      const raw = match[0].trim();
      if (STOPWORDS.has(raw.toLowerCase())) continue;
      if (/^(?:The|A|An)\s+/i.test(raw)) continue;
      spans.add(raw);
    }
  }

  return [...spans];
}

function isPlaceholderOnly(span: string): boolean {
  return span.replace(PLACEHOLDER_PATTERN, "").trim().length === 0;
}

export function findUngroundedClaims(oracle: FaithfulnessOracle, response: AnalysisResponse): UngroundedFinding[] {
  const oracleNormalized = normalize(buildOracleString(oracle));
  const findings: UngroundedFinding[] = [];

  response.questions.forEach((q, questionIndex) => {
    for (const field of ["question", "rationale"] as const) {
      const text = q[field];
      for (const span of extractSalientSpans(text)) {
        if (isPlaceholderOnly(span)) continue;

        const score = overlapScore(span, oracleNormalized);
        if (score < GROUNDED_OVERLAP_THRESHOLD) {
          findings.push({
            questionIndex,
            field,
            span,
            reason: `overlap ${score.toFixed(2)} < threshold ${GROUNDED_OVERLAP_THRESHOLD}`,
          });
        }
      }
    }
  });

  return findings;
}
