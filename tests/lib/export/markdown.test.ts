import { describe, it, expect } from "vitest";
import { toMarkdown, CONFIDENTIALITY_HEADER } from "@/lib/export/markdown";
import type { ExportReport } from "@/lib/export/types";

const FROZEN_NOW = new Date("2026-06-06T12:00:00.000Z");

const baseReport: ExportReport = {
  analysisId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  matchSummary: "Strong match for the role.",
  profile: { name: "Senior QA Engineer", seniority_level: "Senior" },
  customRequirements: null,
  projectContext: "E-commerce platform rewrite",
  hasLinkedin: true,
  linkedinScrapeNote: "Profile fetched successfully",
  createdAt: "2026-06-01T08:30:00.000Z",
  questions: [
    {
      category: "missing_elements",
      question: "What testing frameworks were used?",
      rationale: "CV lacks explicit framework names.",
      suggested_answer: "Ask about Cypress and Playwright experience.",
    },
    {
      category: "contradictions",
      question: "Tenure at Acme Corp?",
      rationale: "Dates conflict between roles.",
      suggested_answer: null,
    },
    {
      category: "vague_claims",
      question: "What does 'led initiatives' mean?",
      rationale: "Claim is not quantified.",
      suggested_answer: "Probe for team size and outcomes.",
    },
    {
      category: "anomalies",
      question: "Gap between 2019 and 2021?",
      rationale: "Unexplained employment gap.",
      suggested_answer: null,
    },
  ],
};

describe("toMarkdown", () => {
  it("renders confidentiality header, four categories, and redacted content", () => {
    const seed = { piiMapValues: [], candidateNames: ["Acme Corp"] };
    const report: ExportReport = {
      ...baseReport,
      matchSummary: "Worked at Acme Corp for five years.",
      questions: baseReport.questions.map((q) =>
        q.category === "contradictions"
          ? { ...q, question: "Tenure at Acme Corp?", rationale: "Acme Corp dates conflict." }
          : q,
      ),
    };

    const md = toMarkdown(report, seed, FROZEN_NOW);

    expect(md).toContain(CONFIDENTIALITY_HEADER(FROZEN_NOW).trim());
    expect(md).toContain("## Missing Elements");
    expect(md).toContain("## Contradictions");
    expect(md).toContain("## Vague Claims");
    expect(md).toContain("## Anomalies");
    expect(md).not.toContain("Acme Corp");
    expect(md).toContain("[REDACTED]");
    expect(md).toContain("**LinkedIn:** Cross-referenced");
    expect(md).toContain("**Project context:** E-commerce platform rewrite");
    expect(md).toContain("Generated 2026-06-06T12:00:00.000Z");
  });
});
