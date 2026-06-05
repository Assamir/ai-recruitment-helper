// Minimal OpenAI-compatible LLM stub for E2E runs.
//
// The app's analysis pipeline calls the LLM server-side (src/pages/api/analysis
// background waitUntil), so page.route() in the browser cannot intercept it. This
// stub binds the lmstudio base host:port the server calls (LMSTUDIO_BASE_URL in
// src/lib/llm/types.ts) and returns a fixed, schema-valid analysis as the chat
// completion content. That fixture is our oracle — the test asserts the UI renders
// exactly what the stub returned, never that an LLM answer is "correct".

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 1234;
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "fixtures", "analysis-response.json");

// Read once at boot; the fixture is the single source of truth shared with the spec.
const analysisResponse = readFileSync(fixturePath, "utf8");

function chatCompletion() {
  return {
    id: "e2e-stub-completion",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "e2e-stub",
    choices: [
      {
        index: 0,
        // The client appends "Respond ONLY with valid JSON" and parses message.content.
        message: { role: "assistant", content: analysisResponse },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

const server = createServer((req, res) => {
  const url = req.url ?? "";

  if (req.method === "GET" && url.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && url.includes("/chat/completions")) {
    // Drain the request body before responding (the model prompt; we ignore it).
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(chatCompletion()));
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[llm-stub] listening on http://localhost:${PORT} (OpenAI-compatible)`);
});
