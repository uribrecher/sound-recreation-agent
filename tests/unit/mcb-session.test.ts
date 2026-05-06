import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimMcbSession, McbUnreachableError } from "../../src/mcb-session.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("claimMcbSession", () => {
  it("returns a UUID when a fake MCB answers POST /v1/sessions", async () => {
    // Stand up a UDS HTTP server that mimics MCB just enough for the
    // session-claim call. Vendoring a tiny client means the real
    // keyboards-mcp doesn't have to be running for this test.
    const dir = mkdtempSync(join(tmpdir(), "mcb-session-test-"));
    const sock = join(dir, "sock");
    const server: Server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/sessions") {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ sessionId: "11111111-2222-4333-8444-555555555555", ownerPid: 9999 }));
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => server.listen(sock, () => r()));
    try {
      const sid = await claimMcbSession(1234, "test-agent", sock);
      assert.match(sid, UUID_RE);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws McbUnreachableError when nothing listens on the socket", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcb-session-test-"));
    const sock = join(dir, "absent.sock");
    try {
      await assert.rejects(
        claimMcbSession(1234, "test-agent", sock),
        (err: Error) => err instanceof McbUnreachableError && /MCB unreachable/.test(err.message),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws McbUnreachableError when MCB returns non-200", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcb-session-test-"));
    const sock = join(dir, "sock");
    const server: Server = createServer((_req, res) => {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "invalid-input" }));
    });
    await new Promise<void>((r) => server.listen(sock, () => r()));
    try {
      await assert.rejects(
        claimMcbSession(1234, "test-agent", sock),
        (err: Error) => err instanceof McbUnreachableError && /400/.test(err.message),
      );
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
