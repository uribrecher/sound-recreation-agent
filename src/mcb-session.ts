/**
 * Tiny standalone MCB client. The agent only ever needs to claim a single
 * session from MCB at startup, so a 30-line HTTP-over-UDS helper beats
 * coupling the repo to `keyboards-mcp`'s internal client. The agent and
 * the MCP it spawns are peers under MCB — each gets its own sessionId.
 */

import { request } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

export class McbUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McbUnreachableError";
  }
}

function defaultSocketPath(): string {
  return process.env.MCB_SOCKET ?? join(homedir(), ".mcb", "sock");
}

const REQUEST_TIMEOUT_MS = 2000;

/**
 * Claim a session from MCB. Throws `McbUnreachableError` if the broker
 * isn't listening, stalls past `REQUEST_TIMEOUT_MS`, or returns an
 * unexpected response. Caller is expected to surface the failure at
 * server boot rather than degrade silently — the timeout in particular
 * is the difference between "fail fast" and a hung startup when MCB
 * accepted the connection but never responded.
 */
export async function claimMcbSession(
  pid: number = process.pid,
  processName = "sound-recreation-agent",
  socketPath: string = defaultSocketPath(),
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const req = request(
      { socketPath, method: "POST", path: "/v1/sessions", headers: { "content-type": "application/json" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode !== 200) {
            reject(new McbUnreachableError(`MCB returned ${res.statusCode} on POST /v1/sessions: ${text}`));
            return;
          }
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch {
            reject(new McbUnreachableError(`MCB returned non-JSON body on POST /v1/sessions: ${text}`));
            return;
          }
          const sessionId = (parsed as { sessionId?: unknown }).sessionId;
          if (typeof sessionId !== "string") {
            reject(new McbUnreachableError(`MCB response missing sessionId field: ${text}`));
            return;
          }
          resolve(sessionId);
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new McbUnreachableError(
        `MCB at ${socketPath} did not respond to POST /v1/sessions within ${REQUEST_TIMEOUT_MS}ms`,
      ));
    });
    req.on("error", (err) => reject(new McbUnreachableError(
      `MCB unreachable at ${socketPath}: ${err.message}. Is MCB running? (npm run mcb in keyboards-mcp)`,
    )));
    req.write(JSON.stringify({ pid, processName }));
    req.end();
  });
}
