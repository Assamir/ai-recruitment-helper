import { describe, it, expect } from "vitest";
import { shouldDeleteCandidate } from "@/lib/analysis/candidate-cleanup";

describe("shouldDeleteCandidate", () => {
  it("returns true when no analyses remain (count = 0)", () => {
    expect(shouldDeleteCandidate(0)).toBe(true);
  });

  it("returns false when one analysis remains (count = 1)", () => {
    expect(shouldDeleteCandidate(1)).toBe(false);
  });

  it("returns false when multiple analyses remain (count > 1)", () => {
    expect(shouldDeleteCandidate(2)).toBe(false);
    expect(shouldDeleteCandidate(10)).toBe(false);
  });
});
