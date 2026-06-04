import { CVParseError } from "./errors";
import { extractPdfText } from "./pdf";
import { extractDocxText } from "./docx";

/** Matches client cap in FileUpload.tsx (MAX_SIZE_MB = 5). */
export const MAX_CV_FILE_BYTES = 5 * 1024 * 1024;

const EXTRACTORS: Partial<Record<string, (buffer: ArrayBuffer) => Promise<string>>> = {
  "application/pdf": extractPdfText,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": extractDocxText,
};

export async function extractText(file: File): Promise<string> {
  if (file.size > MAX_CV_FILE_BYTES) {
    throw new CVParseError("FILE_TOO_LARGE", "File exceeds the 5 MB limit.");
  }
  const extractor = EXTRACTORS[file.type];

  if (!extractor) {
    throw new CVParseError("UNSUPPORTED_FORMAT", `Unsupported file type: "${file.type}". Accepted types: PDF, DOCX.`);
  }

  let text: string;
  try {
    const buffer = await file.arrayBuffer();
    text = await extractor(buffer);
  } catch (error) {
    if (error instanceof CVParseError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CVParseError("PARSE_FAILED", `Failed to parse file: ${message}`);
  }

  if (text.trim().length === 0) {
    throw new CVParseError(
      "EMPTY_CONTENT",
      "The file appears to be empty or contains only non-text content (e.g. scanned images).",
    );
  }

  return text;
}

export { CVParseError };
export type { CVParseErrorCode } from "./errors";
