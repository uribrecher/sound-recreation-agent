# @sounds-and-recreation/agent-client

Browser-safe TypeScript client for the sound-recreation-agent HTTP server.

Used by:
- `sound-recreation-agent`'s Node REPL (terminal client)
- `keyboards-mcp`'s Electron renderer (in-app chat client)

## Install

For sibling repos, depend via local path:

```json
{
  "dependencies": {
    "@sounds-and-recreation/agent-client": "file:../sound-recreation-agent/client-sdk"
  }
}
```

## Use

```ts
import { AgentClient } from "@sounds-and-recreation/agent-client";

const client = new AgentClient({ serverUrl: "http://localhost:2999" });

for await (const event of client.send("hello")) {
  switch (event.type) {
    case "text-delta": render(event.delta); break;
    case "tool-input-start": showSpinner(event.toolName); break;
    case "tool-output-available": hideSpinner(); break;
    case "done": /* assistant message already committed */ break;
  }
}

console.log(client.messages); // readonly UIMessage[]
client.reset();
```

## Runtime requirements

The SDK uses only browser-standard APIs:

- `fetch`
- `ReadableStream` / `getReader()`
- `TextDecoder` / `TextEncoder`
- `crypto.randomUUID()`

It works in any modern browser, in Electron renderer (with default `nodeIntegration: false`), and in Node 19+.

## Packaging note

The macOS packager that bundles `keyboards-mcp` into a `.app` cannot resolve `file:../sound-recreation-agent/client-sdk` from inside the bundled product. The packager must:

1. Run `npm run build` in `client-sdk/` to produce `dist/`.
2. Copy `client-sdk/dist/` into the bundled Electron app's resources next to the renderer bundle.
3. Rewrite the bare specifier `@sounds-and-recreation/agent-client` to a relative path (or vendor it into the renderer bundle at build time).

Until that packager exists, this caveat is recorded here so the dev-time `file:` dep does not get treated as production-ready distribution.
