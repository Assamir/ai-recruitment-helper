import { describe, it, expect } from "vitest";
import { anonymizeCV } from "@/lib/anonymizer/index";
import { buildAnalysisPrompt } from "@/lib/analysis/prompt";
import { CATCHABLE_CV_FIXTURES } from "../../fixtures/cv/catchable";

const SYNTHETIC_PROFILE = {
  name: "Synthetic QA Profile",
  description: "Invented role for boundary tests.",
  expected_skills: ["Playwright", "API testing"],
};

const SYNTHETIC_CUSTOM_REQUIREMENTS = "Requires ISTQB Foundation and 5+ years in regulated industries.";
const SYNTHETIC_PROJECT_CONTEXT = "Healthcare SaaS, SAFe agile, Azure cloud stack.";

describe("anonymizeCV → buildAnalysisPrompt boundary", () => {
  for (const fixture of CATCHABLE_CV_FIXTURES) {
    it(`[${fixture.id}] prompt has placeholders and zero raw catchable PII`, () => {
      const { anonymizedText } = anonymizeCV(fixture.cv);
      const prompt = buildAnalysisPrompt({
        anonymizedText,
        profile: SYNTHETIC_PROFILE,
        customRequirements: SYNTHETIC_CUSTOM_REQUIREMENTS,
        projectContext: SYNTHETIC_PROJECT_CONTEXT,
      });

      for (const placeholder of fixture.expectedPlaceholders) {
        expect(prompt).toContain(placeholder);
      }

      for (const raw of fixture.piiValues) {
        expect(prompt).not.toContain(raw);
      }
    });
  }
});
