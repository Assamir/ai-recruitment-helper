import { findEmails, findPhones, findUrls } from "@/lib/anonymizer/patterns";
import type { ExportReport, RedactionSeed } from "./types";

const REDACTED = "[REDACTED]";

function uniqueNonEmptySeeds(seed: RedactionSeed): string[] {
  const seen = new Set<string>();
  const values = [...seed.piiMapValues, ...seed.candidateNames];
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result.sort((a, b) => b.length - a.length);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAllCaseInsensitive(text: string, needle: string, replacement: string): string {
  if (!needle) return text;
  return text.replace(new RegExp(escapeRegex(needle), "gi"), replacement);
}

function applyPatternLayer(text: string): string {
  interface Match {
    start: number;
    end: number;
    label: string;
  }
  const matches: Match[] = [
    ...findEmails(text).map((m) => ({ start: m.start, end: m.end, label: "[EMAIL]" })),
    ...findPhones(text).map((m) => ({ start: m.start, end: m.end, label: "[PHONE]" })),
    ...findUrls(text).map((m) => ({ start: m.start, end: m.end, label: "[URL]" })),
  ];

  if (matches.length === 0) return text;

  matches.sort((a, b) => b.start - a.start);
  let result = text;
  for (const { start, end, label } of matches) {
    result = result.slice(0, start) + label + result.slice(end);
  }
  return result;
}

export function redactText(text: string, seed: RedactionSeed): string {
  let result = text;
  for (const needle of uniqueNonEmptySeeds(seed)) {
    result = replaceAllCaseInsensitive(result, needle, REDACTED);
  }
  return applyPatternLayer(result);
}

export function redactReport(report: ExportReport, seed: RedactionSeed): ExportReport {
  const redact = (value: string | null | undefined): string | null => {
    if (value == null || value === "") return value ?? null;
    return redactText(value, seed);
  };

  return {
    ...report,
    matchSummary: redact(report.matchSummary),
    customRequirements: redact(report.customRequirements),
    projectContext: redact(report.projectContext),
    linkedinScrapeNote: redact(report.linkedinScrapeNote),
    profile: report.profile
      ? {
          ...report.profile,
          name: redactText(report.profile.name, seed),
          seniority_level: report.profile.seniority_level
            ? redactText(report.profile.seniority_level, seed)
            : report.profile.seniority_level,
          description: report.profile.description ? redactText(report.profile.description, seed) : null,
        }
      : null,
    questions: report.questions.map((q) => ({
      ...q,
      question: redactText(q.question, seed),
      rationale: redactText(q.rationale, seed),
      suggested_answer: q.suggested_answer ? redactText(q.suggested_answer, seed) : null,
    })),
  };
}
