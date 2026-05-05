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

  it("GET /health returns 200 with ok:true and a UUID instanceId", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "application/json");
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.match(
      body.instanceId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      `instanceId should be a UUID, got: "${body.instanceId}"`,
    );
  });

  it("instanceId is stable across probes within one process lifetime", async () => {
    // The whole point of instanceId is that clients can detect a
    // restart by observing it CHANGE — which means it must NOT change
    // between requests against the same handler.
    const a = await (await fetch(`${baseUrl}/health`)).json();
    const b = await (await fetch(`${baseUrl}/health`)).json();
    assert.strictEqual(a.instanceId, b.instanceId);
  });

  it("two handler instances produce different instanceIds", async () => {
    // Stand up a second handler on a separate port; their default
    // UUIDs must differ so a real restart shows up as a change.
    const otherServer = createServer(createRequestHandler(null));
    await new Promise<void>((resolve) => otherServer.listen(0, resolve));
    try {
      const otherAddr = otherServer.address();
      const otherPort = typeof otherAddr === "object" && otherAddr ? otherAddr.port : 0;
      const a = await (await fetch(`${baseUrl}/health`)).json();
      const b = await (await fetch(`http://localhost:${otherPort}/health`)).json();
      assert.notStrictEqual(a.instanceId, b.instanceId);
    } finally {
      await new Promise<void>((resolve, reject) => {
        otherServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("explicit instanceId override is reflected in /health response", async () => {
    // The factory accepts an instanceId argument so tests (and any
    // future deterministic-startup needs) don't have to scrape a
    // generated UUID out of a probe response.
    const fixed = "00000000-0000-4000-8000-000000000001";
    const fixedServer = createServer(createRequestHandler(null, fixed));
    await new Promise<void>((resolve) => fixedServer.listen(0, resolve));
    try {
      const fixedAddr = fixedServer.address();
      const fixedPort = typeof fixedAddr === "object" && fixedAddr ? fixedAddr.port : 0;
      const body = await (await fetch(`http://localhost:${fixedPort}/health`)).json();
      assert.strictEqual(body.instanceId, fixed);
    } finally {
      await new Promise<void>((resolve, reject) => {
        fixedServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
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
