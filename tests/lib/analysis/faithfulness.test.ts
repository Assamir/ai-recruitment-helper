import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { AnalysisResponseSchema } from "@/lib/analysis/schema";
import { findUngroundedClaims, type FaithfulnessOracle } from "./faithfulness";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/analysis");

interface AnalysisFixture {
  anonymizedText: string;
  profile: FaithfulnessOracle["profile"];
  response: unknown;
}

function loadFixture(name: string): {
  oracle: FaithfulnessOracle;
  response: ReturnType<typeof AnalysisResponseSchema.parse>;
} {
  const raw = JSON.parse(readFileSync(path.join(fixturesDir, name), "utf8")) as AnalysisFixture;
  const parsed = AnalysisResponseSchema.parse(raw.response);
  return {
    oracle: { anonymizedText: raw.anonymizedText, profile: raw.profile },
    response: parsed,
  };
}

describe("findUngroundedClaims", () => {
  it("returns no findings for a fully grounded fixture", () => {
    const { oracle, response } = loadFixture("grounded.json");
    expect(findUngroundedClaims(oracle, response)).toEqual([]);
  });

  it("flags fabricated skills absent from CV and profile", () => {
    const { oracle, response } = loadFixture("ungrounded.json");
    const findings = findUngroundedClaims(oracle, response);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const spans = findings.map((f) => f.span.toLowerCase()).join(" ");
    expect(spans).toMatch(/terraform|vault|hashicorp/);
  });

  it("allows missing_elements that reference expected_skills not in the CV", () => {
    const { oracle, response } = loadFixture("legitimate-missing.json");
    expect(findUngroundedClaims(oracle, response)).toEqual([]);
  });

  it("accepts an empty questions array", () => {
    const { oracle, response } = loadFixture("empty-questions.json");
    expect(findUngroundedClaims(oracle, response)).toEqual([]);
  });

  it("passes recorded real-run fixtures", () => {
    const { oracle, response } = loadFixture("recorded-run-1.json");
    expect(findUngroundedClaims(oracle, response)).toEqual([]);
  });
});
