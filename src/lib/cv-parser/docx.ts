import { WasmDocument } from "office-oxide-wasm";

export function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const doc = new WasmDocument(new Uint8Array(buffer), "docx");
  try {
    return Promise.resolve(doc.plainText());
  } finally {
    doc.free();
  }
}
