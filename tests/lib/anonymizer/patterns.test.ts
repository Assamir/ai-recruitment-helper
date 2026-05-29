import { describe, it, expect } from "vitest";
import { findEmails, findPhones, findUrls } from "@/lib/anonymizer/patterns";

describe("findEmails", () => {
  it("detects a standard email address", () => {
    const matches = findEmails("Contact me at john.doe@example.com for details.");
    expect(matches).toHaveLength(1);
    expect(matches[0].match).toBe("john.doe@example.com");
  });

  it("detects email with plus sign and subdomain", () => {
    const matches = findEmails("john+filter@mail.company.co.uk");
    expect(matches).toHaveLength(1);
    expect(matches[0].match).toBe("john+filter@mail.company.co.uk");
  });

  it("detects multiple emails in text", () => {
    const matches = findEmails("work: work@corp.io  personal: me@gmail.com");
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.match)).toEqual(["work@corp.io", "me@gmail.com"]);
  });

  it("does not match plain words without @", () => {
    expect(findEmails("no email here at all")).toHaveLength(0);
  });

  it("does not match version numbers that contain dots", () => {
    expect(findEmails("v1.2.3 released")).toHaveLength(0);
  });

  it("returns correct start and end positions", () => {
    const text = "Email: test@example.org please";
    const matches = findEmails(text);
    expect(matches[0].start).toBe(text.indexOf("test@example.org"));
    expect(matches[0].end).toBe(matches[0].start + "test@example.org".length);
  });
});

describe("findPhones", () => {
  it("detects international format with + prefix", () => {
    const matches = findPhones("Call me: +48 123 456 789");
    expect(matches).toHaveLength(1);
    expect(matches[0].match).toContain("+48");
  });

  it("detects US format: +1-555-123-4567", () => {
    const matches = findPhones("Phone: +1-555-123-4567");
    expect(matches).toHaveLength(1);
  });

  it("detects UK format: +44 20 7123 4567", () => {
    const matches = findPhones("UK: +44 20 7123 4567");
    expect(matches).toHaveLength(1);
    expect(matches[0].match).toContain("+44");
  });

  it("detects US parentheses format: (555) 123-4567", () => {
    const matches = findPhones("(555) 123-4567");
    expect(matches).toHaveLength(1);
  });

  it("does not match version numbers like 1.23.456", () => {
    expect(findPhones("pytest==1.23.456 installed")).toHaveLength(0);
  });

  it("does not match year ranges like 2019-2022", () => {
    expect(findPhones("Worked 2019-2022")).toHaveLength(0);
  });
});

describe("findUrls", () => {
  it("detects https URL", () => {
    const matches = findUrls("Portfolio: https://johndoe.dev");
    expect(matches).toHaveLength(1);
    expect(matches[0].match).toBe("https://johndoe.dev");
  });

  it("detects LinkedIn profile URL", () => {
    const matches = findUrls("linkedin.com/in/johndoe");
    expect(matches).toHaveLength(1);
    expect(matches[0].match).toBe("linkedin.com/in/johndoe");
  });

  it("detects GitHub URL", () => {
    const matches = findUrls("github.com/johndoe");
    expect(matches).toHaveLength(1);
  });

  it("does not match plain domain names without path or protocol", () => {
    expect(findUrls("I used google.com to search")).toHaveLength(0);
  });

  it("does not match an email address as a URL", () => {
    const matches = findUrls("john@example.com is not a URL");
    expect(matches).toHaveLength(0);
  });
});
