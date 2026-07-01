import { describe, it, expect } from "vitest";
import { exportFilenameStem, formatCreatedDate } from "@/lib/export/format";

const ANALYSIS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("exportFilenameStem", () => {
  it("builds analysis-<id>-<YYYY-MM-DD> from an id and ISO timestamp", () => {
    expect(exportFilenameStem(ANALYSIS_ID, "2026-06-01T08:30:00.000Z")).toBe(
      `analysis-${ANALYSIS_ID}-2026-06-01`,
    );
  });

  it("derives the date in UTC from a non-UTC offset", () => {
    // 2026-06-01T23:30-05:00 is 2026-06-02T04:30Z → UTC calendar day is the 2nd.
    expect(exportFilenameStem(ANALYSIS_ID, "2026-06-01T23:30:00.000-05:00")).toBe(
      `analysis-${ANALYSIS_ID}-2026-06-02`,
    );
  });
});

describe("formatCreatedDate", () => {
  it("returns the YYYY-MM-DD UTC slice of an ISO timestamp", () => {
    expect(formatCreatedDate("2026-06-06T12:00:00.000Z")).toBe("2026-06-06");
  });

  it("normalizes a non-UTC offset to the UTC calendar day", () => {
    expect(formatCreatedDate("2026-06-01T23:30:00.000-05:00")).toBe("2026-06-02");
  });
});
