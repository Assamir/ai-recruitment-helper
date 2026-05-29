import { describe, it, expect } from "vitest";
import { QA_ANALYSIS_SYSTEM_PROMPT, buildAnalysisPrompt } from "@/lib/analysis/prompt";

const PROFILE = {
  name: "Automation QA — Playwright",
  description: "Test automation engineer specializing in Playwright for modern web applications.",
  expected_skills: [
    { name: "Playwright", category: "framework" },
    { name: "TypeScript", category: "language" },
    { name: "CI/CD integration", category: "concept" },
  ],
};

const ANONYMIZED_CV = `[CANDIDATE_NAME]
Senior QA Engineer

WORK EXPERIENCE
QA Lead | [COMPANY_1] | January 2022 - Present
- Introduced Playwright-based E2E test automation framework achieving 85% coverage.
- Technologies: Playwright, TypeScript, Jenkins CI/CD`;

describe("QA_ANALYSIS_SYSTEM_PROMPT", () => {
  it("contains all four anomaly categories", () => {
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("missing_elements");
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("contradictions");
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("vague_claims");
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("anomalies");
  });

  it("contains output format instructions", () => {
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("match_summary");
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("questions");
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("rationale");
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("suggested_answer");
  });

  it("instructs the model not to fabricate details", () => {
    const lower = QA_ANALYSIS_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("only");
  });
});

describe("buildAnalysisPrompt", () => {
  it("includes the anonymized CV text", () => {
    const prompt = buildAnalysisPrompt(ANONYMIZED_CV, PROFILE);
    expect(prompt).toContain(ANONYMIZED_CV);
  });

  it("includes the profile name", () => {
    const prompt = buildAnalysisPrompt(ANONYMIZED_CV, PROFILE);
    expect(prompt).toContain(PROFILE.name);
  });

  it("includes the profile description", () => {
    const prompt = buildAnalysisPrompt(ANONYMIZED_CV, PROFILE);
    expect(prompt).toContain(PROFILE.description);
  });

  it("includes expected skills", () => {
    const prompt = buildAnalysisPrompt(ANONYMIZED_CV, PROFILE);
    expect(prompt).toContain("Playwright");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("CI/CD integration");
  });

  it("handles expected_skills as a pre-serialized string", () => {
    const profileWithStringSkills = {
      ...PROFILE,
      expected_skills: JSON.stringify(PROFILE.expected_skills),
    };
    const prompt = buildAnalysisPrompt(ANONYMIZED_CV, profileWithStringSkills);
    expect(prompt).toContain("Playwright");
  });

  it("contains the anonymized placeholder [CANDIDATE_NAME] not a real name", () => {
    const prompt = buildAnalysisPrompt(ANONYMIZED_CV, PROFILE);
    expect(prompt).toContain("[CANDIDATE_NAME]");
    expect(prompt).not.toContain("Jane Smith");
  });
});
