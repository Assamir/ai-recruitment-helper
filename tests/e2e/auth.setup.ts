import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Auth is a REAL boundary here (test-plan §7 excludes testing the auth *mechanism*,
// but the flow still has to be authenticated). We sign in once via the UI and persist
// storageState so the main-flow spec never logs in through the UI itself.
const authFile = "tests/e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "E2E_EMAIL and E2E_PASSWORD must be set to an existing Supabase user. " +
        "See tests/e2e/README.md.",
    );
  }

  await page.goto("/auth/signin");

  // exact: true so "Password" doesn't also match the "Show password" toggle button.
  const emailField = page.getByLabel("Email", { exact: true });
  const passwordField = page.getByLabel("Password", { exact: true });

  // The form is a hydrating React island (client:load); filling before hydration
  // finishes can drop the typed value. Retry until both values stick.
  await expect(async () => {
    await emailField.fill(email);
    await passwordField.fill(password);
    await expect(emailField).toHaveValue(email);
    await expect(passwordField).toHaveValue(password);
  }).toPass({ timeout: 10_000 });

  await page.getByRole("button", { name: "Sign in" }).click();

  // The signin handler redirects to "/" on success; failures bounce back to
  // /auth/signin?error=... — assert we landed authenticated, then prove access.
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"));
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "+ New Analysis" })).toBeVisible();

  mkdirSync(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
