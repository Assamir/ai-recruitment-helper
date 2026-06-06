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

const CUSTOM_REQUIREMENTS = "Must have 3+ years Playwright experience and API testing with REST Assured.";
const PROJECT_CONTEXT = "Fintech payments platform, agile squads, stack: React, Node.js, PostgreSQL.";

function buildPrompt(overrides: Partial<Parameters<typeof buildAnalysisPrompt>[0]> = {}) {
  return buildAnalysisPrompt({
    anonymizedText: ANONYMIZED_CV,
    profile: PROFILE,
    ...overrides,
  });
}

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

  it("acknowledges custom requirements and project context", () => {
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("custom free-text requirements");
    expect(QA_ANALYSIS_SYSTEM_PROMPT).toContain("project context");
  });
});

describe("buildAnalysisPrompt", () => {
  it("includes the anonymized CV text", () => {
    const prompt = buildPrompt();
    expect(prompt).toContain(ANONYMIZED_CV);
  });

  it("includes the profile name", () => {
    const prompt = buildPrompt();
    expect(prompt).toContain(PROFILE.name);
  });

  it("includes the profile description", () => {
    const prompt = buildPrompt();
    expect(prompt).toContain(PROFILE.description);
  });

  it("includes expected skills", () => {
    const prompt = buildPrompt();
    expect(prompt).toContain("Playwright");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("CI/CD integration");
  });

  it("handles expected_skills as a pre-serialized string", () => {
    const profileWithStringSkills = {
      ...PROFILE,
      expected_skills: JSON.stringify(PROFILE.expected_skills),
    };
    const prompt = buildPrompt({ profile: profileWithStringSkills });
    expect(prompt).toContain("Playwright");
  });

  it("contains the anonymized placeholder [CANDIDATE_NAME] not a real name", () => {
    const prompt = buildPrompt();
    expect(prompt).toContain("[CANDIDATE_NAME]");
    expect(prompt).not.toContain("Jane Smith");
  });

  it("renders custom-only requirements without profile sections", () => {
    const prompt = buildAnalysisPrompt({
      anonymizedText: ANONYMIZED_CV,
      customRequirements: CUSTOM_REQUIREMENTS,
    });

    expect(prompt).toContain("CUSTOM JOB REQUIREMENTS:");
    expect(prompt).toContain(CUSTOM_REQUIREMENTS);
    expect(prompt).not.toContain("JOB PROFILE:");
    expect(prompt).not.toContain("EXPECTED SKILLS:");
  });

  it("renders profile and custom requirements together", () => {
    const prompt = buildPrompt({ customRequirements: CUSTOM_REQUIREMENTS });

    expect(prompt).toContain("JOB PROFILE:");
    expect(prompt).toContain("EXPECTED SKILLS:");
    expect(prompt).toContain("CUSTOM JOB REQUIREMENTS:");
    expect(prompt).toContain(CUSTOM_REQUIREMENTS);
  });

  it("includes project context when provided", () => {
    const prompt = buildPrompt({ projectContext: PROJECT_CONTEXT });

    expect(prompt).toContain("PROJECT CONTEXT:");
    expect(prompt).toContain(PROJECT_CONTEXT);
  });

  it("omits project context section when absent", () => {
    const prompt = buildPrompt();
    expect(prompt).not.toContain("PROJECT CONTEXT:");
  });

  it("keeps CV block present and last", () => {
    const prompt = buildPrompt({
      customRequirements: CUSTOM_REQUIREMENTS,
      projectContext: PROJECT_CONTEXT,
    });

    const cvIndex = prompt.lastIndexOf("CV (anonymized):");
    const customIndex = prompt.indexOf("CUSTOM JOB REQUIREMENTS:");
    const projectIndex = prompt.indexOf("PROJECT CONTEXT:");
    const profileIndex = prompt.indexOf("JOB PROFILE:");

    expect(cvIndex).toBeGreaterThan(customIndex);
    expect(cvIndex).toBeGreaterThan(projectIndex);
    expect(cvIndex).toBeGreaterThan(profileIndex);
    expect(prompt.slice(cvIndex)).toContain(ANONYMIZED_CV);
  });
});
