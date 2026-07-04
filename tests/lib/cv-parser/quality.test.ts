import { describe, it, expect } from "vitest";
import { assertUsableCvText, assessCvTextQuality } from "@/lib/cv-parser/quality";
import { CVParseError } from "@/lib/cv-parser/errors";

/** Realistic multi-section CV (extractor-output style). */
export const CLEAN_CV_TEXT = `
Morgan Lee
Senior QA Engineer

Email: morgan.lee@example.org
Phone: +1 555 010 2234

SUMMARY
Eight years of test automation and release quality for web platforms.

SKILLS
Playwright, Cypress, API testing, CI/CD, risk-based test planning.

WORK EXPERIENCE
QA Lead | Northwind Labs | January 2021 - Present
- Owned regression strategy and mentored three engineers.

Senior QA | Contoso Apps | March 2017 - December 2020
- Built integration suites across payment and onboarding flows.
`.trim();

/** Non-empty PDF/metadata noise — must be rejected. */
export const NON_EMPTY_GARBAGE_TEXT = `
%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
stream xC5x9E2A1B@@@@####....%%%%.... 0xFF 0x00 /Filter /FlateDecode /Length 4096
endstream
trailer << /Root 1 0 R >>
`.trim();

/** Short but real CV — falsifiability anchor (must pass). */
export const TERSE_REAL_CV_TEXT = `
Alex Rivera
QA Engineer
Skills: Playwright, Cypress, API testing, test design, CI pipelines.
`.trim();

/** Just below word-token threshold — must fail. */
const JUST_BELOW_THRESHOLD = `
obj stream xC5 #### .... %%%% 0xFF
QA test
`.trim();

/** Just above garbage threshold — still real words, must pass. */
const JUST_ABOVE_THRESHOLD = `
Sam Ortiz
QA tester with Playwright Cypress API testing design pipelines release quality.
`.trim();

/**
 * Real CV extracted as a single newline-free line (unpdf mergePages style).
 * Regression: prose-line detection must survive missing line breaks.
 */
const SINGLE_LINE_CV_TEXT =
  "PROFILE Over years of API testing I gained experience in SOAP and REST testing including " +
  "writing own test frameworks. I also conduct training courses on how to build automation tests " +
  "using Groovy and ReadyAPI. My latest achievement is my own framework for SOAP and REST built " +
  "on IntelliJ. EXPERIENCE Senior Test Automation Engineer at EPAM Systems developing Java API " +
  "tests in an insurance domain and preparing test cases in Jira for automation.";

describe("assertUsableCvText", () => {
  it("passes a clean CV string", () => {
    expect(() => {
      assertUsableCvText(CLEAN_CV_TEXT);
    }).not.toThrow();
    expect(assessCvTextQuality(CLEAN_CV_TEXT).usable).toBe(true);
  });

  it("rejects non-empty garbage with INSUFFICIENT_CONTENT", () => {
    expect(() => {
      assertUsableCvText(NON_EMPTY_GARBAGE_TEXT);
    }).toThrow(CVParseError);
    try {
      assertUsableCvText(NON_EMPTY_GARBAGE_TEXT);
    } catch (err) {
      expect(err).toMatchObject({ code: "INSUFFICIENT_CONTENT" });
    }
  });

  it("passes a terse-but-real CV", () => {
    expect(() => {
      assertUsableCvText(TERSE_REAL_CV_TEXT);
    }).not.toThrow();
  });

  it("rejects just-below-threshold noise", () => {
    expect(assessCvTextQuality(JUST_BELOW_THRESHOLD).usable).toBe(false);
    expect(() => {
      assertUsableCvText(JUST_BELOW_THRESHOLD);
    }).toThrow(CVParseError);
  });

  it("passes just-above-threshold terse CV", () => {
    expect(assessCvTextQuality(JUST_ABOVE_THRESHOLD).usable).toBe(true);
    expect(() => {
      assertUsableCvText(JUST_ABOVE_THRESHOLD);
    }).not.toThrow();
  });

  it("passes a real CV extracted as a single newline-free line", () => {
    expect(SINGLE_LINE_CV_TEXT).not.toContain("\n");
    expect(assessCvTextQuality(SINGLE_LINE_CV_TEXT).usable).toBe(true);
    expect(() => {
      assertUsableCvText(SINGLE_LINE_CV_TEXT);
    }).not.toThrow();
  });
});
