import { extractText } from "unpdf";

export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return text;
}
