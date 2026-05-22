// Generic SSE streaming helper for endpoints that proxy
// OpenAI-compatible chat completions streams.
export async function streamSSE({
  url,
  body,
  signal,
  onDelta,
  onDone,
  onError,
}: {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    onError("Nepodarilo sa spojiť so serverom.");
    return;
  }

  if (!resp.ok || !resp.body) {
    try {
      const data = await resp.json();
      onError(data.error ?? "Chyba pri generovaní.");
    } catch {
      onError("Chyba pri generovaní.");
    }
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  try {
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (json === "[DONE]") {
          done = true;
          break;
        }
        try {
          const parsed = JSON.parse(json);
          const content = parsed.choices?.[0]?.delta?.content as
            | string
            | undefined;
          if (content) onDelta(content);
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      onError("Spojenie sa prerušilo.");
      return;
    }
    return;
  }

  onDone();
}
