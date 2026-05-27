export class LLMError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "LLMError";
    this.code = code;
  }
}

export class LLMConfigError extends LLMError {
  constructor(message: string) {
    super(message, "LLM_CONFIG_ERROR");
    this.name = "LLMConfigError";
  }
}

export class LLMConnectionError extends LLMError {
  constructor(message: string) {
    super(message, "LLM_CONNECTION_ERROR");
    this.name = "LLMConnectionError";
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(message: string) {
    super(message, "LLM_TIMEOUT_ERROR");
    this.name = "LLMTimeoutError";
  }
}

export class LLMParseError extends LLMError {
  constructor(message: string) {
    super(message, "LLM_PARSE_ERROR");
    this.name = "LLMParseError";
  }
}
