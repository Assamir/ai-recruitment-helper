import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractDocxText } from "@/lib/cv-parser/docx";
import { CVParseError } from "@/lib/cv-parser/errors";

function makeDocxBuffer(documentXml: string): ArrayBuffer {
  const zip = zipSync({
    "word/document.xml": strToU8(documentXml),
  });
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}

describe("extractDocxText", () => {
  it("extracts text from DOCX XML payload", async () => {
    const xml =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Jan</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Kowalski</w:t></w:r></w:p><w:p><w:r><w:t>QA &amp; Automation</w:t></w:r></w:p></w:body></w:document>';

    const result = await extractDocxText(makeDocxBuffer(xml));

    expect(result).toContain("Jan");
    expect(result).toContain("Kowalski");
    expect(result).toContain("QA & Automation");
  });

  it("throws CVParseError when DOCX does not contain document.xml", async () => {
    const zip = zipSync({ "[Content_Types].xml": strToU8("<Types/>") });
    const invalidBuffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);

    await expect(extractDocxText(invalidBuffer)).rejects.toBeInstanceOf(CVParseError);
  });
});
