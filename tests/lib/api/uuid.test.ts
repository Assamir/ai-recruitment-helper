import { describe, it, expect } from "vitest";
import { isUuid } from "@/lib/api/uuid";

describe("isUuid", () => {
  it("accepts valid UUIDs", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("rejects garbage ids", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
