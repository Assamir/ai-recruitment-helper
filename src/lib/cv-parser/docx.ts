import { strFromU8, unzipSync } from "fflate";
import { CVParseError } from "./errors";

/**
 * Upper bound for the uncompressed `word/document.xml` payload. A small DOCX can
 * decompress to a much larger XML body (zip-bomb style), so cap it before and
 * after inflation rather than trusting the upload size alone.
 */
const MAX_DOCX_DOCUMENT_BYTES = 20 * 1024 * 1024;

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function extractTextFromDocumentXml(xml: string): string {
  const normalized = xml
    .replaceAll("</w:p>", "\n")
    .replaceAll("</w:tr>", "\n")
    .replaceAll("<w:tab/>", "\t")
    .replaceAll("<w:tab />", "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<w:cr\s*\/>/g, "\n");

  const textFragments = [...normalized.matchAll(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) =>
    decodeXmlEntities(match[1]),
  );

  return textFragments.join("");
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  try {
    let oversize = false;
    // Only inflate the document body; skip every other archive entry so a
    // bomb packed into unrelated parts is never decompressed.
    const files = unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        if (file.name !== "word/document.xml") return false;
        if (file.originalSize > MAX_DOCX_DOCUMENT_BYTES) {
          oversize = true;
          return false;
        }
        return true;
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated inside the filter closure, which the rule can't track
    if (oversize) {
      throw new CVParseError("FILE_TOO_LARGE", "DOCX document content exceeds the size limit.");
    }

    const documentXml = files["word/document.xml"] as Uint8Array | undefined;

    if (!documentXml) {
      throw new CVParseError("PARSE_FAILED", "DOCX file is missing word/document.xml.");
    }

    // Guard against a local header that understates the real inflated size.
    if (documentXml.length > MAX_DOCX_DOCUMENT_BYTES) {
      throw new CVParseError("FILE_TOO_LARGE", "DOCX document content exceeds the size limit.");
    }

    const xml = strFromU8(documentXml);
    return extractTextFromDocumentXml(xml);
  } catch (error) {
    if (error instanceof CVParseError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CVParseError("PARSE_FAILED", `DOCX parsing failed: ${message}`);
  }
}
