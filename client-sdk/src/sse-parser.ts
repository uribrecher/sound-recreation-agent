export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") continue;
        try {
          yield JSON.parse(payload);
        } catch {
          // skip malformed JSON, continue with next line
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
