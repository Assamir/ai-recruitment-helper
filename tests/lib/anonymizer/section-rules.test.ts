import { describe, it, expect } from "vitest";
import { findCandidateName, findCompanyNames } from "@/lib/anonymizer/section-rules";

describe("findCandidateName", () => {
  it("matches a header Title-Case 2–4-word name", () => {
    const text = "Samira Okonkwo\nSenior QA\n\nSkills: Playwright";
    const matches = findCandidateName(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].match).toBe("Samira Okonkwo");
  });

  it("skips ALL-CAPS header lines", () => {
    const text = "JORDAN BLAKE\nQA ENGINEER\nEmail: j@x.test";
    expect(findCandidateName(text)).toEqual([]);
  });

  it("returns only the first qualifying header line", () => {
    const text = "Alex Kim\nTaylor Brooks\nEngineer";
    const matches = findCandidateName(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].match).toBe("Alex Kim");
  });

  it("accepted gap: misses single-token header name", () => {
    const text = "Madison\nQA Engineer";
    expect(findCandidateName(text)).toEqual([]);
  });

  it("accepted gap: misses 5+-word header line", () => {
    const text = "Alex Kim Taylor Brooks Lee\nEngineer";
    expect(findCandidateName(text)).toEqual([]);
  });

  it("accepted gap: misses lines with digits or special characters", () => {
    const text = "Alex Kim 2nd\nEngineer";
    expect(findCandidateName(text)).toEqual([]);
  });

  it("accepted gap: misses names below the header block (not in first 10 lines)", () => {
    const lines = Array.from({ length: 11 }, (_, i) => `Line ${i}`);
    lines.push("Taylor Brooks");
    const text = lines.join("\n");
    expect(findCandidateName(text)).toEqual([]);
  });
});

describe("findCompanyNames", () => {
  it("extracts company from Title | Company | Date pipe line", () => {
    const text = "QA Lead | Zephyr Made Up Co | January 2022 - Present";
    const matches = findCompanyNames(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].match).toBe("Zephyr Made Up Co");
  });

  it("filters date-range segments that look like companies", () => {
    const text = "Role | January 2022 - Present";
    expect(findCompanyNames(text)).toEqual([]);
  });

  it("accepted gap: misses company mentioned only in prose", () => {
    const text = "Worked at Zephyr Made Up Co for several years.";
    expect(findCompanyNames(text)).toEqual([]);
  });
});
