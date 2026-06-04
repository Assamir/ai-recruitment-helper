export type CVParseErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "PARSE_FAILED"
  | "EMPTY_CONTENT"
  | "INSUFFICIENT_CONTENT"
  | "FILE_TOO_LARGE";

export class CVParseError extends Error {
  code: CVParseErrorCode;

  constructor(code: CVParseErrorCode, message: string) {
    super(message);
    this.name = "CVParseError";
    this.code = code;
  }
}
