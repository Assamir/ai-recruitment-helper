import { describe, it, expect } from "vitest";
import { toMarkdown } from "@/lib/export/markdown";
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

    expect(md).toMatchInlineSnapshot(`
      "# CONFIDENTIAL

      This document contains an anonymized candidate analysis.
      Do not redistribute.

      Generated 2026-06-06T12:00:00.000Z

      ---

      # Candidate Analysis Report

      **Analysis ID:** aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
      **Requirements:** Senior QA Engineer — Senior
      **Created:** 2026-06-01
      **LinkedIn:** Cross-referenced
      **LinkedIn note:** Profile fetched successfully
      **Project context:** E-commerce platform rewrite

      ## Match Summary

      Worked at [REDACTED] for five years.

      ## Missing Elements

      ### 1. What testing frameworks were used?

      **Rationale:** CV lacks explicit framework names.

      **Suggested answer:** Ask about Cypress and Playwright experience.

      ## Contradictions

      ### 1. Tenure at [REDACTED]?

      **Rationale:** [REDACTED] dates conflict.

      ## Vague Claims

      ### 1. What does 'led initiatives' mean?

      **Rationale:** Claim is not quantified.

      **Suggested answer:** Probe for team size and outcomes.

      ## Anomalies

      ### 1. Gap between 2019 and 2021?

      **Rationale:** Unexplained employment gap.
      "
    `);
  });
});
