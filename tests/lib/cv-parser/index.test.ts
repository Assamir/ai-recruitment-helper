/* eslint-disable @typescript-eslint/no-unsafe-return */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractText, CVParseError } from "@/lib/cv-parser/index";

const mockExtractPdfText = vi.fn();
const mockExtractDocxText = vi.fn();

vi.mock("@/lib/cv-parser/pdf", () => ({
  extractPdfText: (...args: unknown[]) => mockExtractPdfText(...args),
}));

vi.mock("@/lib/cv-parser/docx", () => ({
  extractDocxText: (...args: unknown[]) => mockExtractDocxText(...args),
}));

function makeFile(name: string, type: string, content = "dummy"): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

describe("extractText", () => {
  beforeEach(() => {
    mockExtractPdfText.mockReset();
    mockExtractDocxText.mockReset();
  });

  it("dispatches PDF MIME type to PDF extractor", async () => {
    mockExtractPdfText.mockResolvedValue("Extracted PDF content");
    const file = makeFile("cv.pdf", "application/pdf");
    const result = await extractText(file);
    expect(result).toBe("Extracted PDF content");
    expect(mockExtractPdfText).toHaveBeenCalledOnce();
    expect(mockExtractDocxText).not.toHaveBeenCalled();
  });

  it("dispatches DOCX MIME type to DOCX extractor", async () => {
    mockExtractDocxText.mockResolvedValue("Extracted DOCX content");
    const file = makeFile("cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const result = await extractText(file);
    expect(result).toBe("Extracted DOCX content");
    expect(mockExtractDocxText).toHaveBeenCalledOnce();
    expect(mockExtractPdfText).not.toHaveBeenCalled();
  });

  it("throws CVParseError with UNSUPPORTED_FORMAT for unknown MIME type", async () => {
    const file = makeFile("cv.txt", "text/plain");
    await expect(extractText(file)).rejects.toThrow(CVParseError);
    await expect(extractText(file)).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });

  it("throws CVParseError with EMPTY_CONTENT when extraction returns empty string", async () => {
    mockExtractPdfText.mockResolvedValue("");
    const file = makeFile("cv.pdf", "application/pdf");
    await expect(extractText(file)).rejects.toThrow(CVParseError);
    await expect(extractText(file)).rejects.toMatchObject({ code: "EMPTY_CONTENT" });
  });

  it("throws CVParseError with EMPTY_CONTENT when extraction returns whitespace only", async () => {
    mockExtractPdfText.mockResolvedValue("   \n  \t  ");
    const file = makeFile("cv.pdf", "application/pdf");
    await expect(extractText(file)).rejects.toMatchObject({ code: "EMPTY_CONTENT" });
  });

  it("wraps extractor errors in CVParseError with PARSE_FAILED", async () => {
    mockExtractPdfText.mockRejectedValue(new Error("Corrupt PDF stream"));
    const file = makeFile("cv.pdf", "application/pdf");
    await expect(extractText(file)).rejects.toThrow(CVParseError);
    await expect(extractText(file)).rejects.toMatchObject({ code: "PARSE_FAILED" });
  });

  it("re-throws CVParseError from extractor without wrapping", async () => {
    const original = new CVParseError("PARSE_FAILED", "Inner parse failure");
    mockExtractPdfText.mockRejectedValue(original);
    const file = makeFile("cv.pdf", "application/pdf");
    await expect(extractText(file)).rejects.toBe(original);
  });
});
