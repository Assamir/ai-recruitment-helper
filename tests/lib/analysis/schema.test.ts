import { describe, it, expect } from "vitest";
import { AnalysisResponseSchema } from "@/lib/analysis/schema";

const VALID_RESPONSE = {
  match_summary: "Strong candidate with broad QA experience. Key gap: no performance testing.",
  questions: [
    {
      category: "missing_elements",
      question: "The CV shows no performance testing experience. How would you approach k6 load testing?",
      rationale: "The role requires performance testing but the CV omits it entirely.",
      suggested_answer: "Candidate should describe setting up k6, defining thresholds, CI integration.",
    },
    {
      category: "vague_claims",
      question: "You mention 'improved quality significantly' — can you quantify this?",
      rationale: "Vague achievement with no metric.",
      suggested_answer: null,
    },
  ],
};

describe("AnalysisResponseSchema", () => {
  it("validates a well-formed response", () => {
    const result = AnalysisResponseSchema.safeParse(VALID_RESPONSE);
    expect(result.success).toBe(true);
  });

  it("accepts suggested_answer: null", () => {
    const result = AnalysisResponseSchema.safeParse(VALID_RESPONSE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.questions[1].suggested_answer).toBeNull();
    }
  });

  it("accepts empty questions array", () => {
    const result = AnalysisResponseSchema.safeParse({
      match_summary: "No issues found.",
      questions: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing match_summary", () => {
    const result = AnalysisResponseSchema.safeParse({ questions: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category value", () => {
    const bad = {
      ...VALID_RESPONSE,
      questions: [{ ...VALID_RESPONSE.questions[0], category: "red_flags" }],
    };
    const result = AnalysisResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("strips extra fields from the response object", () => {
    const withExtra = { ...VALID_RESPONSE, score: 95, debug_info: "internal" };
    const result = AnalysisResponseSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("score" in result.data).toBe(false);
    }
  });

  it("strips extra fields from individual questions", () => {
    const withExtra = {
      ...VALID_RESPONSE,
      questions: [{ ...VALID_RESPONSE.questions[0], internal_id: "abc" }],
    };
    const result = AnalysisResponseSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("internal_id" in result.data.questions[0]).toBe(false);
    }
  });

  it("rejects missing question text", () => {
    const bad = {
      ...VALID_RESPONSE,
      questions: [{ category: "anomalies", rationale: "some reason", suggested_answer: null }],
    };
    const result = AnalysisResponseSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts all four valid categories", () => {
    const categories = ["missing_elements", "contradictions", "vague_claims", "anomalies"];
    for (const category of categories) {
      const result = AnalysisResponseSchema.safeParse({
        match_summary: "test",
        questions: [{ category, question: "q", rationale: "r", suggested_answer: null }],
      });
      expect(result.success, `category '${category}' should be valid`).toBe(true);
    }
  });
});
