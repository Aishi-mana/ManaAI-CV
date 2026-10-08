import type { ChatMessage, Msg } from "./types";

export type Health = "ok" | "loading" | "down";

export async function checkHealth(port: number): Promise<Health> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    if (r.ok) return "ok";
    if (r.status === 503) return "loading";
    return "down";
  } catch {
    return "down";
  }
}

/**
 * Builds the message list for the model:
 * system prompt + the most recent turns, starting on a user turn and with
 * same-role neighbours merged (some chat templates reject anything else).
 */
export function buildPayload(system: string, history: Msg[], maxMessages = 24): ChatMessage[] {
  const recent = history.filter((m) => m.content.trim()).slice(-maxMessages);
  while (recent.length && recent[0].role !== "user") recent.shift();

  const merged: ChatMessage[] = [];
  for (const m of recent) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content;
    else merged.push({ role: m.role, content: m.content });
  }
  return [{ role: "system", content: system }, ...merged];
}

export async function streamChat(opts: {
  port: number;
  messages: ChatMessage[];
  temperature: number;
  signal?: AbortSignal;
  onToken: (token: string) => void;
}): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${opts.port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature,
      max_tokens: 700,
      cache_prompt: true,
      // Ignored by models without a thinking mode; turns it off for Qwen3-style ones.
      chat_template_kwargs: { enable_thinking: false },
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Server error ${res.status}: ${text.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) opts.onToken(delta);
      } catch {
        /* ignore a malformed chunk */
      }
    }
  }
}
