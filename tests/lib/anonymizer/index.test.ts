import { describe, it, expect } from "vitest";
import { anonymizeCV } from "@/lib/anonymizer/index";
import { SYNTHETIC_CV_TEXT } from "@/lib/llm/test-data";

const CV_WITH_PII = `
Jane Smith
Senior QA Engineer

Email: jane.smith@company.com
Phone: +48 123 456 789
LinkedIn: linkedin.com/in/janesmith

WORK EXPERIENCE

QA Lead | TechCorp Solutions | January 2022 - Present
- Led QA team at TechCorp Solutions delivering high-quality software.

Senior QA Engineer | DataBridge Inc | March 2019 - December 2021
- Built automation frameworks for DataBridge Inc.
`.trim();

describe("anonymizeCV — structured PII detection", () => {
  it("replaces email addresses with [EMAIL]", () => {
    const { anonymizedText, piiMap } = anonymizeCV(CV_WITH_PII);
    expect(anonymizedText).not.toContain("jane.smith@company.com");
    expect(anonymizedText).toContain("[EMAIL]");
    expect(piiMap["[EMAIL]"]).toBe("jane.smith@company.com");
  });

  it("replaces phone numbers with [PHONE]", () => {
    const { anonymizedText, piiMap } = anonymizeCV(CV_WITH_PII);
    expect(anonymizedText).not.toContain("+48 123 456 789");
    expect(anonymizedText).toContain("[PHONE]");
    expect(piiMap["[PHONE]"]).toContain("+48");
  });

  it("replaces LinkedIn URL with [URL]", () => {
    const { anonymizedText, piiMap } = anonymizeCV(CV_WITH_PII);
    expect(anonymizedText).not.toContain("linkedin.com/in/janesmith");
    expect(anonymizedText).toContain("[URL]");
    expect(piiMap["[URL]"]).toContain("linkedin.com");
  });

  it("replaces candidate name from header with [CANDIDATE_NAME]", () => {
    const { anonymizedText, piiMap } = anonymizeCV(CV_WITH_PII);
    expect(anonymizedText).not.toContain("Jane Smith");
    expect(anonymizedText).toContain("[CANDIDATE_NAME]");
    expect(piiMap["[CANDIDATE_NAME]"]).toBe("Jane Smith");
  });

  it("replaces company names with numbered [COMPANY_N] placeholders", () => {
    const { anonymizedText, piiMap } = anonymizeCV(CV_WITH_PII);
    expect(anonymizedText).toContain("[COMPANY_1]");
    expect(anonymizedText).toContain("[COMPANY_2]");
    expect(piiMap["[COMPANY_1]"]).toBe("TechCorp Solutions");
    expect(piiMap["[COMPANY_2]"]).toBe("DataBridge Inc");
  });

  it("PII counts are accurate", () => {
    const { piiCount } = anonymizeCV(CV_WITH_PII);
    expect(piiCount.emails).toBe(1);
    expect(piiCount.phones).toBe(1);
    expect(piiCount.names).toBe(1);
    expect(piiCount.companies).toBe(2);
  });

  it("anonymized text does not contain the original email", () => {
    const { anonymizedText } = anonymizeCV(CV_WITH_PII);
    expect(anonymizedText).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  });
});

describe("anonymizeCV — edge cases", () => {
  it("returns original text unchanged for empty input", () => {
    const { anonymizedText, piiMap, piiCount } = anonymizeCV("");
    expect(anonymizedText).toBe("");
    expect(piiMap).toEqual({});
    expect(piiCount).toEqual({ names: 0, emails: 0, phones: 0, companies: 0, addresses: 0 });
  });

  it("returns original text unchanged for whitespace-only input", () => {
    const { anonymizedText } = anonymizeCV("   \n  ");
    expect(anonymizedText).toBe("   \n  ");
  });

  it("handles text with no PII gracefully", () => {
    const { anonymizedText, piiCount } = anonymizeCV("Test automation, Playwright, TypeScript, CI/CD pipelines.");
    expect(anonymizedText).toBe("Test automation, Playwright, TypeScript, CI/CD pipelines.");
    expect(piiCount.emails).toBe(0);
    expect(piiCount.phones).toBe(0);
  });
});

describe("anonymizeCV — SYNTHETIC_CV_TEXT", () => {
  it("detects company names in pipe-separated experience lines", () => {
    const { anonymizedText, piiCount } = anonymizeCV(SYNTHETIC_CV_TEXT);
    expect(piiCount.companies).toBeGreaterThanOrEqual(3);
    expect(anonymizedText).not.toContain("TechVision Solutions");
    expect(anonymizedText).not.toContain("DataStream Analytics");
    expect(anonymizedText).not.toContain("WebCraft Digital Agency");
    expect(anonymizedText).toContain("[COMPANY_1]");
  });

  it("produces readable output — does not replace non-PII content", () => {
    const { anonymizedText } = anonymizeCV(SYNTHETIC_CV_TEXT);
    expect(anonymizedText).toContain("Playwright");
    expect(anonymizedText).toContain("TypeScript");
    expect(anonymizedText).toContain("CERTIFICATIONS");
  });
});
