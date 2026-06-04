import { describe, it, expect } from "vitest";
import { isServiceRoleKey } from "@/lib/supabase-key";

function base64urlJson(obj: object): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fakeJwt(payload: object): string {
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const body = base64urlJson(payload);
  return `${header}.${body}.dummy-signature`;
}

describe("isServiceRoleKey", () => {
  it("returns true for service_role JWT", () => {
    expect(isServiceRoleKey(fakeJwt({ role: "service_role", iss: "supabase" }))).toBe(true);
  });

  it("returns false for anon JWT", () => {
    expect(isServiceRoleKey(fakeJwt({ role: "anon", iss: "supabase" }))).toBe(false);
  });

  it("returns false for sb_publishable keys", () => {
    expect(isServiceRoleKey("sb_publishable_abc123")).toBe(false);
  });

  it("returns false for sb_secret keys", () => {
    expect(isServiceRoleKey("sb_secret_xyz")).toBe(false);
  });

  it("returns false for undefined, null, and garbage", () => {
    expect(isServiceRoleKey(undefined)).toBe(false);
    expect(isServiceRoleKey(null)).toBe(false);
    expect(isServiceRoleKey("not-a-jwt")).toBe(false);
  });
});
