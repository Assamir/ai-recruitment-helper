import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Risk #8 (test-plan.md §2 / §3 Phase 5): after login, the main analysis flow must
 * hold together through the real UI — a recruiter pastes CV text, submits, and reaches
 * a *rendered* results view. Failure modes: blank screen, stuck progress, silent error.
 *
 * Real boundaries: auth, routing, Supabase. Stubbed: the LLM, at the network edge
 * (tests/e2e/support/llm-stub.mjs) — so the assertions below are anchored to our own
 * fixture (the oracle), never to a model-generated answer.
 *
 * Seed exemplar: tests/fixtures/seed.spec.ts.
 */

const stub = JSON.parse(readFileSync("tests/e2e/fixtures/analysis-response.json", "utf8")) as {
  match_summary: string;
  questions: { question: string }[];
};

// A plausible CV; content is irrelevant to the assertions (LLM output is stubbed).
const CV_TEXT = [
  "Jane Tester",
  "",
  "QA engineer with 7 years of experience in Java, test automation, and CI.",
  "Tools: Selenium, JMeter, Jenkins, IntelliJ, SQL, Docker.",
].join("\n");

test.describe("Risk #8 — main analysis flow (paste path)", () => {
  // Clean up the analysis this test creates so repeated/parallel runs don't accumulate
  // rows. Uses the page's authenticated context to hit the real DELETE endpoint.
  test.afterEach(async ({ page }) => {
    const match = /\/dashboard\/([0-9a-f-]{36})$/.exec(page.url());
    if (match) {
      await page.request.delete(`/api/analysis/${match[1]}`);
    }
  });

  test("logged-in recruiter pastes a CV, submits, and reaches the rendered results view", async ({
    page,
  }) => {
    // Start a new analysis from the dashboard.
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "+ New Analysis" }).click();
    await expect(page).toHaveURL(/\/dashboard\/new$/);

    // Reveal the paste field and enter CV text.
    await page.getByRole("button", { name: "▼ Paste CV text instead" }).click();
    await page.getByRole("textbox", { name: "Paste the full CV text here..." }).fill(CV_TEXT);

    // Pick the first real job profile (index 0 is the disabled placeholder) — this
    // avoids coupling the test to a specific seeded profile UUID.
    await page.getByRole("combobox").selectOption({ index: 1 });

    // Submit and follow the client redirect to the per-analysis results page.
    await page.getByRole("button", { name: "Analyze CV" }).click();
    await page.waitForURL(/\/dashboard\/[0-9a-f-]{36}$/);

    // The stubbed pipeline completes and the results view renders — the Risk #8 outcome.
    // Wait for state (progress → completed), never a fixed timeout.
    await expect(page.getByText("Match Summary")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(stub.match_summary)).toBeVisible();
    // exact: true → the status badge, not the raw JSON dump that also contains the word.
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText(stub.questions[0].question)).toBeVisible();
  });
});
