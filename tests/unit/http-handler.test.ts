import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { createRequestHandler } from "../../src/index.js";

// Boots the production handler from src/index.ts on a random port and
// hits it over real HTTP. The integration suite mounts its own minimal
// handler and only runs under `npm run test:integration`, so without
// these tests a regression in the actual routing/CORS could merge
// green. `agent: null` is fine here — /health and CORS preflight don't
// need an agent, and /chat is exercised by the integration suite.

describe("HTTP handler (createRequestHandler)", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createServer(createRequestHandler(null));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /health returns 200 with { ok: true }", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "application/json");
    assert.deepStrictEqual(await res.json(), { ok: true });
  });

  it("CORS preflight advertises GET, POST, OPTIONS", async () => {
    // Real bug previously: only POST/OPTIONS were advertised, so any
    // browser preflight for GET /health (e.g. with a non-simple
    // header) would be rejected.
    const res = await fetch(`${baseUrl}/health`, { method: "OPTIONS" });
    assert.strictEqual(res.status, 204);
    const allow = res.headers.get("access-control-allow-methods") ?? "";
    assert.ok(/GET/.test(allow), `expected GET in Allow-Methods, got: "${allow}"`);
    assert.ok(/POST/.test(allow));
    assert.ok(/OPTIONS/.test(allow));
    assert.strictEqual(res.headers.get("access-control-allow-origin"), "*");
  });

  it("unknown route returns 404", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    assert.strictEqual(res.status, 404);
  });

  it("POST /chat returns 503 when agent is not initialized", async () => {
    // With agent === null, /chat should refuse cleanly rather than
    // crashing on a null deref. This guards against a future refactor
    // accidentally allowing /chat through without an agent.
    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      }),
    });
    assert.strictEqual(res.status, 503);
  });
});
