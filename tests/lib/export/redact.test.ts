import { describe, it, expect } from "vitest";
import { redactText } from "@/lib/export/redact";

describe("redactText", () => {
  it("redacts seeded raw candidate name and pattern email from LinkedIn-style output", () => {
    const text =
      "Jane Smith shows strong skills. Contact jane.smith@acme.com for follow-up. Jane Smith mentioned React.";
    const seed = {
      piiMapValues: [],
      candidateNames: ["Jane Smith"],
    };
    const result = redactText(text, seed);
    expect(result).not.toContain("Jane Smith");
    expect(result).not.toContain("jane.smith@acme.com");
    expect(result).toContain("[REDACTED]");
    expect(result).toContain("[EMAIL]");
  });

  it("preserves existing CV-only placeholders unchanged", () => {
    const text = "Candidate [CANDIDATE_NAME] has [EMAIL] listed in their CV.";
    const seed = {
      piiMapValues: ["Jane Doe", "jane@example.com"],
      candidateNames: ["Jane Doe"],
    };
    const result = redactText(text, seed);
    expect(result).toBe("Candidate [CANDIDATE_NAME] has [EMAIL] listed in their CV.");
  });

  it("redacts full name before partial name tokens (longest-match-first)", () => {
    const text = "John Smith and John both appear here.";
    const seed = {
      piiMapValues: [],
      candidateNames: ["John", "John Smith"],
    };
    const result = redactText(text, seed);
    expect(result).not.toContain("John Smith");
    expect(result).toBe("[REDACTED] and [REDACTED] both appear here.");
  });

  it("redacts phones and urls via pattern layer", () => {
    const text = "Call +1-555-123-4567 or visit https://linkedin.com/in/jane";
    const result = redactText(text, { piiMapValues: [], candidateNames: [] });
    expect(result).toContain("[PHONE]");
    expect(result).toContain("[URL]");
    expect(result).not.toContain("+1-555-123-4567");
    expect(result).not.toContain("linkedin.com");
  });

  it("ignores empty or whitespace-only seeds", () => {
    const text = "No changes expected.";
    const result = redactText(text, { piiMapValues: ["", "   "], candidateNames: [] });
    expect(result).toBe(text);
  });
});
