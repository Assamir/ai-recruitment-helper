import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    globals: true,
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/lib/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/components/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup/dom.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "rls",
          environment: "node",
          include: ["tests/rls/**/*.test.ts"],
          setupFiles: ["tests/rls/setup.ts"],
        },
      },
    ],
  },
});
