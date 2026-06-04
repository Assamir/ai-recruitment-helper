/**
 * Pre-commit: run Vitest "related" only for staged files in test-plan risk areas.
 * @see context/foundation/test-plan.md §2 (hot-spot paths)
 */
import { spawnSync } from "node:child_process";

/** Paths that warrant scoped tests on commit (normalized with forward slashes). */
const RISK_PREFIXES = [
  "src/lib/llm/",
  "src/lib/analysis/",
  "src/components/analysis/",
  "src/lib/anonymizer/",
  "src/lib/cv-parser/",
  "src/pages/api/",
  "tests/lib/",
  "tests/rls/",
  "tests/components/",
];

const CODE_FILE = /\.(ts|tsx|astro)$/;

function normalize(path) {
  return path.replace(/\\/g, "/");
}

function isRiskFile(path) {
  const p = normalize(path);
  return RISK_PREFIXES.some((prefix) => p.startsWith(prefix));
}

function stagedFiles() {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error("lefthook-related-tests: git diff failed");
    process.exit(result.status ?? 1);
  }
  return result.stdout.split("\0").filter(Boolean);
}

const files = stagedFiles().filter(isRiskFile).filter((f) => CODE_FILE.test(f));

if (files.length === 0) {
  process.exit(0);
}

const run = spawnSync("npx", ["vitest", "related", ...files, "--run"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(run.status ?? 1);
