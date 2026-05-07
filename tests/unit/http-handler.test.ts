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

const FIXED_SESSION_ID = "00000000-0000-4000-8000-000000000001";

describe("HTTP handler (createRequestHandler)", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    server = createServer(createRequestHandler(null, async () => FIXED_SESSION_ID));
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

  it("GET /health returns 200 with ok:true and the MCB-issued sessionId", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "application/json");
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.sessionId, FIXED_SESSION_ID);
  });

  it("/health returns whatever the session-id getter resolves to on each probe", async () => {
    // The handler now consults the getter on every probe (so MCB
    // restarts are visible to clients). When the getter is stable,
    // probes are stable; when the getter changes, probes change.
    const a = await (await fetch(`${baseUrl}/health`)).json();
    const b = await (await fetch(`${baseUrl}/health`)).json();
    assert.strictEqual(a.sessionId, b.sessionId);
  });

  it("/health degrades to sessionId:null when the getter throws", async () => {
    // /health's contract is "always 200". Lock in the defensive
    // try/catch around the getter so a future regression that lets a
    // getter exception escape can't hang the connection or produce an
    // unhandled rejection.
    const localServer = createServer(createRequestHandler(null, async () => {
      throw new Error("simulated getter failure");
    }));
    await new Promise<void>((resolve) => localServer.listen(0, resolve));
    try {
      const addr = localServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://localhost:${port}/health`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.sessionId, null);
    } finally {
      await new Promise<void>((resolve, reject) => {
        localServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("/health returns sessionId:null when the getter resolves to null", async () => {
    // Models the "keyboards-mcp not connected / no session minted yet"
    // case — the renderer falls back to "—" rather than locking up.
    const localServer = createServer(createRequestHandler(null, async () => null));
    await new Promise<void>((resolve) => localServer.listen(0, resolve));
    try {
      const addr = localServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const body = await (await fetch(`http://localhost:${port}/health`)).json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.sessionId, null);
    } finally {
      await new Promise<void>((resolve, reject) => {
        localServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("/health does not echo any legacy instanceId field", async () => {
    // Lock in the rename — clients must read sessionId, not instanceId.
    const body = await (await fetch(`${baseUrl}/health`)).json();
    assert.strictEqual(body.instanceId, undefined);
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
