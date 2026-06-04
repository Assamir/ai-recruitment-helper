/** Catchable PII — must be fully removed before the LLM prompt is built. */

export interface CatchableCvFixture {
  id: string;
  cv: string;
  piiValues: string[];
  expectedPlaceholders: string[];
}

export const CATCHABLE_CV_FIXTURES: CatchableCvFixture[] = [
  {
    id: "full-catchable-set",
    cv: `
Riley Chen
QA Automation Engineer

Email: riley.chen@invented-labs.example
Phone: +44 20 7946 0123
Alt: (555) 234-9876

SUMMARY
Builds reliable automation for web and API products.

WORK EXPERIENCE
QA Lead | Northstar Invented Ltd | January 2021 - Present
- Led regression and release sign-off at Northstar Invented Ltd.
`.trim(),
    piiValues: [
      "riley.chen@invented-labs.example",
      "+44 20 7946 0123",
      "(555) 234-9876",
      "Riley Chen",
      "Northstar Invented Ltd",
    ],
    expectedPlaceholders: ["[EMAIL]", "[PHONE]", "[CANDIDATE_NAME]", "[COMPANY_1]"],
  },
];
