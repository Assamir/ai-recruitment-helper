/** Accepted MVP gaps — raw values may survive anonymization today. */

export interface AcceptedMissFixture {
  id: string;
  cv: string;
  /** Raw substrings that should still appear after anonymizeCV (current behavior). */
  expectedPassThrough: string[];
  gap: string;
}

export const ACCEPTED_MISS_FIXTURES: AcceptedMissFixture[] = [
  {
    id: "body-only-company",
    cv: `
Jordan Ellis
QA Engineer

SUMMARY
Delivered test strategy while working at Horizon Made Up Corp across three releases.
`.trim(),
    expectedPassThrough: ["Horizon Made Up Corp"],
    gap: "company only in prose, not pipe-table",
  },
  {
    id: "single-token-header-name",
    cv: `
Madison
QA Engineer

Skills: Playwright, API testing, CI pipelines.
`.trim(),
    expectedPassThrough: ["Madison"],
    gap: "single-token header name",
  },
  {
    id: "all-caps-header-skipped",
    cv: `
JORDAN BLAKE
QA ENGINEER

Email: jordan.blake@fake.example
`.trim(),
    expectedPassThrough: ["JORDAN BLAKE"],
    gap: "ALL-CAPS header line skipped for name heuristic",
  },
  {
    id: "phone-without-plus-or-us-shape",
    cv: `
Casey Ng
Tester

Phone: 123456789012
`.trim(),
    expectedPassThrough: ["123456789012"],
    gap: "phone without + or US (555) shape",
  },
  {
    id: "bare-domain",
    cv: `
Casey Ng
Portfolio: invented-portfolio.example
`.trim(),
    expectedPassThrough: ["invented-portfolio.example"],
    gap: "bare domain without linkedin/github/www prefix",
  },
  {
    id: "street-address",
    cv: `
Casey Ng
Address: 42 Fictional Lane, Made Up City, 99999
`.trim(),
    expectedPassThrough: ["42 Fictional Lane"],
    gap: "addresses never detected (piiCount.addresses === 0)",
  },
  {
    id: "dd-mm-yyyy-date",
    cv: `
Casey Ng
Available from 15/03/2024
`.trim(),
    expectedPassThrough: ["15/03/2024"],
    gap: "findDates defined but not called in anonymizeCV",
  },
];
