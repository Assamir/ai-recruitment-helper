import type { ExportReport, RedactionSeed } from "./types";
import { redactReport } from "./redact";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  exportFilenameStem,
  formatCreatedDate,
  formatRequirementsLabel,
} from "./format";
import { CONFIDENTIALITY_HEADER } from "./markdown";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function paragraphHtml(text: string): string {
  return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
}

export function toPrintableHtml(report: ExportReport, seed: RedactionSeed, now = new Date()): string {
  const redacted = redactReport(report, seed);
  const requirements = formatRequirementsLabel(redacted.profile, redacted.customRequirements);
  const title = exportFilenameStem(redacted.analysisId, redacted.createdAt);
  const headerLines = CONFIDENTIALITY_HEADER(now)
    .split("\n")
    .filter((line) => line !== "---" && line.trim() !== "");

  const metaRows = [
    ["Analysis ID", redacted.analysisId],
    ["Requirements", requirements.label],
    ...(requirements.detail ? [["Custom requirements", requirements.detail] as const] : []),
    ["Created", formatCreatedDate(redacted.createdAt)],
    ...(redacted.hasLinkedin ? [["LinkedIn", "Cross-referenced"] as const] : []),
    ...(redacted.linkedinScrapeNote ? [["LinkedIn note", redacted.linkedinScrapeNote] as const] : []),
    ...(redacted.projectContext ? [["Project context", redacted.projectContext] as const] : []),
  ];

  const categorySections = CATEGORY_ORDER.map((category) => {
    const categoryQuestions = redacted.questions.filter((q) => q.category === category);
    if (categoryQuestions.length === 0) return "";

    const questionsHtml = categoryQuestions
      .map((q, index) => {
        const suggested = q.suggested_answer
          ? `<p><strong>Suggested answer:</strong> ${escapeHtml(q.suggested_answer)}</p>`
          : "";
        return `<article class="question">
          <h3>${index + 1}. ${escapeHtml(q.question)}</h3>
          <p><strong>Rationale:</strong> ${escapeHtml(q.rationale)}</p>
          ${suggested}
        </article>`;
      })
      .join("\n");

    return `<section>
      <h2>${escapeHtml(CATEGORY_LABELS[category])}</h2>
      ${questionsHtml}
    </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 1.5cm; }
    body {
      font-family: Georgia, "Times New Roman", serif;
      color: #111;
      line-height: 1.5;
      max-width: 800px;
      margin: 0 auto;
      padding: 1.5rem;
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.15rem; margin-top: 1.5rem; border-bottom: 1px solid #ccc; padding-bottom: 0.25rem; }
    h3 { font-size: 1rem; margin-top: 1rem; }
    .confidential {
      border: 2px solid #333;
      padding: 1rem;
      margin-bottom: 1.5rem;
      background: #f9f9f9;
    }
    .confidential h1 { margin-top: 0; }
    .meta { margin: 1rem 0; }
    .meta dt { font-weight: bold; margin-top: 0.25rem; }
    .meta dd { margin: 0 0 0.5rem 0; }
    .question { margin-bottom: 1rem; page-break-inside: avoid; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="confidential">
    ${headerLines.map((line) => (line.startsWith("# ") ? `<h1>${escapeHtml(line.slice(2))}</h1>` : line ? `<p>${escapeHtml(line)}</p>` : "")).join("\n")}
  </div>

  <h1>Candidate Analysis Report</h1>
  <dl class="meta">
    ${metaRows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("\n")}
  </dl>

  <section>
    <h2>Match Summary</h2>
    ${redacted.matchSummary ? paragraphHtml(redacted.matchSummary) : "<p><em>No match summary available.</em></p>"}
  </section>

  ${categorySections}

  <script>window.print()</script>
</body>
</html>`;
}
