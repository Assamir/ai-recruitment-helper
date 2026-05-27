import { describe, it, expect } from "vitest";
import { LLMError, LLMConfigError, LLMConnectionError, LLMTimeoutError, LLMParseError } from "@/lib/llm/errors";

describe("LLM error hierarchy", () => {
  it("LLMConfigError extends LLMError", () => {
    const err = new LLMConfigError("missing key");
    expect(err).toBeInstanceOf(LLMError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("LLM_CONFIG_ERROR");
    expect(err.name).toBe("LLMConfigError");
    expect(err.message).toBe("missing key");
  });

  it("LLMConnectionError extends LLMError", () => {
    const err = new LLMConnectionError("network down");
    expect(err).toBeInstanceOf(LLMError);
    expect(err.code).toBe("LLM_CONNECTION_ERROR");
    expect(err.name).toBe("LLMConnectionError");
  });

  it("LLMTimeoutError extends LLMError", () => {
    const err = new LLMTimeoutError("timed out");
    expect(err).toBeInstanceOf(LLMError);
    expect(err.code).toBe("LLM_TIMEOUT_ERROR");
    expect(err.name).toBe("LLMTimeoutError");
  });

  it("LLMParseError extends LLMError", () => {
    const err = new LLMParseError("bad json");
    expect(err).toBeInstanceOf(LLMError);
    expect(err.code).toBe("LLM_PARSE_ERROR");
    expect(err.name).toBe("LLMParseError");
  });

  it("instanceof distinguishes error types in catch blocks", () => {
    const errors = [
      new LLMConfigError("a"),
      new LLMConnectionError("b"),
      new LLMTimeoutError("c"),
      new LLMParseError("d"),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(LLMError);
    }

    expect(errors[0]).toBeInstanceOf(LLMConfigError);
    expect(errors[0]).not.toBeInstanceOf(LLMConnectionError);
    expect(errors[1]).toBeInstanceOf(LLMConnectionError);
    expect(errors[1]).not.toBeInstanceOf(LLMTimeoutError);
  });
});
