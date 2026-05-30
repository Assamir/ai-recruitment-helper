import { describe, it, expect } from "vitest";
import { splitFullName, extractCandidateName } from "@/lib/candidate/name";

describe("splitFullName", () => {
  it("splits a two-token name into first and last", () => {
    expect(splitFullName("Jane Smith")).toEqual({ firstName: "Jane", lastName: "Smith" });
  });

  it("splits a three-token name: first token → firstName, rest → lastName", () => {
    expect(splitFullName("Anna Maria Kowalska")).toEqual({ firstName: "Anna", lastName: "Maria Kowalska" });
  });

  it("handles a four-token name", () => {
    expect(splitFullName("Mary Jo Van Buren")).toEqual({ firstName: "Mary", lastName: "Jo Van Buren" });
  });

  it("single token → firstName set, lastName null", () => {
    expect(splitFullName("Jane")).toEqual({ firstName: "Jane", lastName: null });
  });

  it("empty string → both null", () => {
    expect(splitFullName("")).toEqual({ firstName: null, lastName: null });
  });

  it("whitespace-only string → both null", () => {
    expect(splitFullName("   ")).toEqual({ firstName: null, lastName: null });
  });

  it("null → both null", () => {
    expect(splitFullName(null)).toEqual({ firstName: null, lastName: null });
  });

  it("undefined → both null", () => {
    expect(splitFullName(undefined)).toEqual({ firstName: null, lastName: null });
  });

  it("collapses extra internal whitespace", () => {
    expect(splitFullName("Jane   Smith")).toEqual({ firstName: "Jane", lastName: "Smith" });
  });
});

describe("extractCandidateName", () => {
  const CV_WITH_NAME = `Jane Smith
Senior QA Engineer

Email: jane.smith@example.com
`;

  const CV_WITHOUT_NAME = `WORK EXPERIENCE

Senior QA Engineer | TechCorp | 2022 - Present
- Led automation efforts.
`;

  it("extracts and splits a name from a CV header", () => {
    expect(extractCandidateName(CV_WITH_NAME)).toEqual({ firstName: "Jane", lastName: "Smith" });
  });

  it("returns both null when no detectable header name", () => {
    expect(extractCandidateName(CV_WITHOUT_NAME)).toEqual({ firstName: null, lastName: null });
  });

  it("returns both null for empty CV text", () => {
    expect(extractCandidateName("")).toEqual({ firstName: null, lastName: null });
  });
});
