# E2E Testing Rules

Read before writing or changing any spec under `tests/e2e/`. These keep generated
tests stable and tied to a real risk (see `context/foundation/test-plan.md`).

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to
  `getByTestId` only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure to locate elements.
- Each test must be independently runnable — no shared state between tests.
- Never use `page.waitForTimeout()`. Wait for specific conditions:
  `toBeVisible()`, `waitForURL()`, `waitForResponse()`.
- Assert the business outcome, not implementation details.
- Use unique identifiers (e.g. a timestamp suffix) for test data to avoid
  collisions in parallel runs; clean up in `afterEach` when you create data.
- Use `storageState` for authentication — never log in through the UI inside an
  individual test (do it once in `auth.setup.ts`).

## Project-specific

- **E2E ≠ zero mocking.** Auth, routing, and Supabase stay REAL — that's where
  integration risk hides. Only the **LLM** is stubbed, at the network edge
  (`tests/e2e/support/llm-stub.mjs`), because it is expensive and non-deterministic.
- **The stub is the oracle.** Assert that the UI renders exactly what the stub
  returned (`tests/e2e/fixtures/analysis-response.json`). Never assert that an LLM
  answer is "correct" against the model's own output (the oracle problem, Risk #1).
- **No exact-pixel / layout-snapshot assertions** (test-plan §7 excludes UI snapshots).
- **Name the test after the risk** it protects, not `test('test 1', ...)`.
- **Falsifiability:** every assertion must fail if its risk materializes. Confirm with
  a deliberate break (see `tests/e2e/README.md`) before trusting a green run.
