import { strFromU8, unzipSync } from "fflate";
import { CVParseError } from "./errors";

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

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  try {
    const files = unzipSync(new Uint8Array(buffer));
    const documentXml = files["word/document.xml"];

    if (!documentXml) {
      throw new CVParseError("PARSE_FAILED", "DOCX file is missing word/document.xml.");
    }

    const xml = strFromU8(documentXml);
    return extractTextFromDocumentXml(xml);
  } catch (error) {
    if (error instanceof CVParseError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CVParseError("PARSE_FAILED", `DOCX parsing failed: ${message}`);
  }
}
