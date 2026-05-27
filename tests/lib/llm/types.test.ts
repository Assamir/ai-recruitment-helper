import { describe, it, expect } from "vitest";
import { HealthCheckResponseSchema } from "@/lib/llm/types";

describe("HealthCheckResponseSchema", () => {
  it("validates a well-formed response", () => {
    const valid = { summary: "Good candidate match", anomaly_count: 3 };
    const result = HealthCheckResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary).toBe("Good candidate match");
      expect(result.data.anomaly_count).toBe(3);
    }
  });

  it("rejects missing summary field", () => {
    const result = HealthCheckResponseSchema.safeParse({ anomaly_count: 2 });
    expect(result.success).toBe(false);
  });

  it("rejects missing anomaly_count field", () => {
    const result = HealthCheckResponseSchema.safeParse({ summary: "text" });
    expect(result.success).toBe(false);
  });

  it("rejects wrong type for anomaly_count", () => {
    const result = HealthCheckResponseSchema.safeParse({ summary: "text", anomaly_count: "three" });
    expect(result.success).toBe(false);
  });

  it("strips extra fields", () => {
    const result = HealthCheckResponseSchema.safeParse({
      summary: "text",
      anomaly_count: 1,
      extra_field: "should be removed",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("extra_field" in result.data).toBe(false);
    }
  });

  it("accepts zero anomaly count", () => {
    const result = HealthCheckResponseSchema.safeParse({ summary: "Clean CV", anomaly_count: 0 });
    expect(result.success).toBe(true);
  });
});
