import { describe, it, expect } from "vitest";
import { extractLinkedinProfileText, classifyLinkedinPageText } from "@/lib/linkedin/extract";
import { isLinkedinProfileUrl, normalizeLinkedinProfileUrl } from "@/lib/linkedin/url";
import { MAX_LINKEDIN_TEXT_CHARS } from "@/lib/analysis/limits";
import {
  LinkedInAuthError,
  LinkedInNotFoundError,
  LinkedInScrapeError,
  LinkedInTimeoutError,
} from "@/lib/linkedin/errors";

const PROFILE_HTML = `
<html><body>
  <h1>Jane Smith</h1>
  <section>About<p>Senior QA Engineer with 8 years of experience.</p></section>
  <section>Experience
    <div>Acme Corp · QA Lead · 2020 - Present</div>
    <button>See more</button>
    <div>Beta Ltd · QA Analyst · 2018 - 2020</div>
  </section>
</body></html>
`;

describe("isLinkedinProfileUrl", () => {
  it("accepts standard profile URLs", () => {
    expect(isLinkedinProfileUrl("https://www.linkedin.com/in/jane-smith/")).toBe(true);
    expect(isLinkedinProfileUrl("https://linkedin.com/in/jane-smith")).toBe(true);
  });

  it("rejects non-profile URLs", () => {
    expect(isLinkedinProfileUrl("https://example.com/in/jane")).toBe(false);
    expect(isLinkedinProfileUrl("https://www.linkedin.com/company/acme")).toBe(false);
  });
});

describe("normalizeLinkedinProfileUrl", () => {
  it("strips query/hash and ensures trailing slash", () => {
    expect(normalizeLinkedinProfileUrl("https://www.linkedin.com/in/jane-smith?trk=foo#section")).toBe(
      "https://www.linkedin.com/in/jane-smith/",
    );
  });
});

describe("extractLinkedinProfileText", () => {
  it("extracts readable profile text from HTML fixtures", () => {
    const text = extractLinkedinProfileText(PROFILE_HTML);
    expect(text).toContain("Jane Smith");
    expect(text).toContain("Senior QA Engineer");
    expect(text).toContain("Acme Corp");
    expect(text).not.toContain("<h1>");
  });

  it("caps extracted text at MAX_LINKEDIN_TEXT_CHARS", () => {
    const huge = `<html><body>${"A".repeat(MAX_LINKEDIN_TEXT_CHARS + 500)}</body></html>`;
    const text = extractLinkedinProfileText(huge);
    expect(text.length).toBe(MAX_LINKEDIN_TEXT_CHARS);
  });
});

describe("classifyLinkedinPageText", () => {
  it("detects auth walls", () => {
    expect(classifyLinkedinPageText("Sign in Join LinkedIn Welcome back")).toBe("auth");
  });

  it("detects not-found pages", () => {
    expect(classifyLinkedinPageText("This page doesn't exist")).toBe("not_found");
  });

  it("treats profile content as success", () => {
    expect(classifyLinkedinPageText("Jane Smith Senior QA Engineer at Acme Corp")).toBe("success");
  });
});

describe("LinkedIn error hierarchy", () => {
  it("maps failure modes to typed errors", () => {
    expect(new LinkedInAuthError()).toBeInstanceOf(LinkedInScrapeError);
    expect(new LinkedInNotFoundError()).toBeInstanceOf(LinkedInScrapeError);
    expect(new LinkedInTimeoutError()).toBeInstanceOf(LinkedInScrapeError);
    expect(new LinkedInAuthError().name).toBe("LinkedInAuthError");
  });
});
