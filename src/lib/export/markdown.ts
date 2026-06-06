import type { ExportReport, RedactionSeed } from "./types";
import { redactReport } from "./redact";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  exportFilenameStem,
  formatCreatedDate,
  formatRequirementsLabel,
} from "./format";

export function CONFIDENTIALITY_HEADER(now: Date): string {
  return [
    "# CONFIDENTIAL",
    "",
    "This document contains an anonymized candidate analysis.",
    "Do not redistribute.",
    "",
    `Generated ${now.toISOString()}`,
    "",
    "---",
    "",
  ].join("\n");
}

export function toMarkdown(report: ExportReport, seed: RedactionSeed, now = new Date()): string {
  const redacted = redactReport(report, seed);
  const requirements = formatRequirementsLabel(redacted.profile, redacted.customRequirements);
  const lines: string[] = [CONFIDENTIALITY_HEADER(now)];

  lines.push(`# Candidate Analysis Report`);
  lines.push("");
  lines.push(`**Analysis ID:** ${redacted.analysisId}`);
  lines.push(`**Requirements:** ${requirements.label}`);
  if (requirements.detail) {
    lines.push(`**Custom requirements:** ${requirements.detail}`);
  }
  lines.push(`**Created:** ${formatCreatedDate(redacted.createdAt)}`);
  if (redacted.hasLinkedin) {
    lines.push(`**LinkedIn:** Cross-referenced`);
    if (redacted.linkedinScrapeNote) {
      lines.push(`**LinkedIn note:** ${redacted.linkedinScrapeNote}`);
    }
  }
  if (redacted.projectContext) {
    lines.push(`**Project context:** ${redacted.projectContext}`);
  }
  lines.push("");

  lines.push("## Match Summary");
  lines.push("");
  lines.push(redacted.matchSummary ?? "_No match summary available._");
  lines.push("");

  for (const category of CATEGORY_ORDER) {
    const categoryQuestions = redacted.questions.filter((q) => q.category === category);
    if (categoryQuestions.length === 0) continue;

    lines.push(`## ${CATEGORY_LABELS[category]}`);
    lines.push("");

    categoryQuestions.forEach((q, index) => {
      lines.push(`### ${index + 1}. ${q.question}`);
      lines.push("");
      lines.push(`**Rationale:** ${q.rationale}`);
      if (q.suggested_answer) {
        lines.push("");
        lines.push(`**Suggested answer:** ${q.suggested_answer}`);
      }
      lines.push("");
    });
  }

  return lines.join("\n");
}

export function markdownFilename(report: ExportReport): string {
  return `${exportFilenameStem(report.analysisId, report.createdAt)}.md`;
}
