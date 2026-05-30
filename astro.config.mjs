// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

const isDev = process.argv.includes("dev");

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    define: isDev ? { "process.env.NODE_ENV": JSON.stringify("development") } : {},
    esbuild: {
      jsxDev: false,
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  },
  adapter: cloudflare({
    prerenderEnvironment: "node",
  }),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      LLM_PROVIDER: envField.string({ context: "server", access: "secret", optional: true }),
      LLM_MODEL: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
