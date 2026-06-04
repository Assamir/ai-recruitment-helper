import { CVParseError } from "./errors";

/**
 * Conservative quality gate for non-empty CV text after extraction.
 *
 * Signals (tuned against tests/lib/cv-parser/quality.test.ts fixtures):
 * - At least MIN_WORD_LIKE_TOKENS tokens of 2+ letters
 * - At least MIN_LETTER_RATIO of letters among non-whitespace characters
 * - At least MIN_DISTINCT_WORDS unique lowercase word tokens
 *
 * Empty/whitespace is handled upstream via EMPTY_CONTENT; this targets
 * non-empty garbage (PDF metadata, encoding noise, punctuation runs).
 */
const MIN_WORD_LIKE_TOKENS = 8;
const MIN_LETTER_RATIO = 0.55;
const MIN_DISTINCT_WORDS = 6;
/** Reject lines dominated by PDF/binary punctuation (see NON_EMPTY_GARBAGE fixture). */
const MAX_SYMBOL_RATIO = 0.22;
const MIN_PROSE_LINES = 2;

const WORD_LIKE = /[A-Za-zÀ-ÖØ-öø-ÿ]{2,}/g;
const NATURAL_WORD = /^[A-Za-zÀ-ÖØ-öø-ÿ]{3,}$/;

function symbolRatio(nonWhitespace: string): number {
  if (nonWhitespace.length === 0) return 1;
  const letters = (nonWhitespace.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) ?? []).length;
  const digits = (nonWhitespace.match(/\d/g) ?? []).length;
  const symbols = nonWhitespace.length - letters - digits;
  return symbols / nonWhitespace.length;
}

function countProseLines(text: string): number {
  let proseLines = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const lineNonWs = trimmed.replace(/\s/g, "");
    if (symbolRatio(lineNonWs) > MAX_SYMBOL_RATIO) continue;

    const tokens = trimmed.split(/\s+/).filter((t) => NATURAL_WORD.test(t) && /[aeiouAEIOUÀ-ÿ]/i.test(t));
    if (tokens.length >= 2) proseLines++;
  }
  return proseLines;
}

export interface CvTextQuality {
  usable: boolean;
  reason?: string;
}

export function assessCvTextQuality(text: string): CvTextQuality {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { usable: false, reason: "empty" };
  }

  const wordMatches = trimmed.match(WORD_LIKE) ?? [];
  const wordCount = wordMatches.length;

  const nonWhitespace = trimmed.replace(/\s/g, "");
  const letterCount = (nonWhitespace.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) ?? []).length;
  const letterRatio = nonWhitespace.length === 0 ? 0 : letterCount / nonWhitespace.length;
  const symRatio = symbolRatio(nonWhitespace);
  const proseLines = countProseLines(trimmed);

  const distinctWords = new Set(wordMatches.map((w) => w.toLowerCase())).size;

  if (wordCount < MIN_WORD_LIKE_TOKENS) {
    return { usable: false, reason: `too few word-like tokens (${wordCount} < ${MIN_WORD_LIKE_TOKENS})` };
  }
  if (letterRatio < MIN_LETTER_RATIO) {
    return { usable: false, reason: `letter ratio too low (${letterRatio.toFixed(2)} < ${MIN_LETTER_RATIO})` };
  }
  if (symRatio > MAX_SYMBOL_RATIO) {
    return { usable: false, reason: `symbol ratio too high (${symRatio.toFixed(2)} > ${MAX_SYMBOL_RATIO})` };
  }
  if (distinctWords < MIN_DISTINCT_WORDS) {
    return { usable: false, reason: `too few distinct words (${distinctWords} < ${MIN_DISTINCT_WORDS})` };
  }
  if (proseLines < MIN_PROSE_LINES) {
    return { usable: false, reason: `too few prose lines (${proseLines} < ${MIN_PROSE_LINES})` };
  }

  return { usable: true };
}

export function assertUsableCvText(text: string): void {
  const quality = assessCvTextQuality(text);
  if (!quality.usable) {
    throw new CVParseError(
      "INSUFFICIENT_CONTENT",
      "The CV text does not contain enough readable content to analyze. Try a different file or paste the CV text directly.",
    );
  }
}
