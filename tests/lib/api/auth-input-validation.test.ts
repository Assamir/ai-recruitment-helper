import { describe, it, expect, vi } from "vitest";
import { POST as signIn } from "@/pages/api/auth/signin";
import { POST as signUp } from "@/pages/api/auth/signup";
import { makeApiContext } from "../../helpers/api-context";

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

function authContext(path: string, body?: BodyInit, contentType?: string) {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  return makeApiContext({
    request: new Request(`http://localhost${path}`, { method: "POST", headers, body }),
    url: `http://localhost${path}`,
  });
}

describe("auth routes — malformed input boundary (Risk #7)", () => {
  it("signin redirects with error on invalid form data", async () => {
    const ctx = authContext("/api/auth/signin", "not multipart", "multipart/form-data; boundary=----bad");
    const redirect = vi.mocked(ctx.redirect);
    await signIn(ctx);
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining("/auth/signin?error="));
  });

  it("signup redirects with error on invalid form data", async () => {
    const ctx = authContext("/api/auth/signup", "not multipart", "multipart/form-data; boundary=----bad");
    const redirect = vi.mocked(ctx.redirect);
    await signUp(ctx);
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining("/auth/signup?error="));
  });

  it("signin redirects when email/password missing", async () => {
    const form = new FormData();
    const ctx = authContext("/api/auth/signin", form);
    const redirect = vi.mocked(ctx.redirect);
    await signIn(ctx);
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining("Email%20and%20password%20are%20required"));
  });
});
