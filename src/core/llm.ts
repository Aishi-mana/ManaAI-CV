import { trimRunaway } from "./guard";
import type { ChatMessage, Msg } from "./types";

export type Health = "ok" | "loading" | "down";

/**
 * The GPU scheduler installs a gate here so every request to the chat model is registered as "in use"
 * (the scheduler never unloads the model in the middle of a reply). No gate = requests run directly.
 */
type Gate = <T>(fn: () => Promise<T>) => Promise<T>;
let gate: Gate | null = null;
export function setChatGate(g: Gate | null) {
  gate = g;
}
const through = <T>(fn: () => Promise<T>): Promise<T> => (gate ? gate(fn) : fn());

/** Waits (up to timeoutMs) until the server answers its health check. */
export async function waitHealthy(port: number, timeoutMs: number, shouldAbort?: () => boolean): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await checkHealth(port)) === "ok") return true;
    if (shouldAbort?.()) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

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

/**
 * Sampling safeguards sent with every chat reply. Without them, small or heavily compressed models can fall into
 * loops ("Manaaaaaa...", "hey hey hey ..."). They are ignored by servers that don't know a field.
 */
const CHAT_SAMPLING = {
  top_k: 40,
  top_p: 0.95,
  min_p: 0.05,
  repeat_penalty: 1.1,
  repeat_last_n: 256,
  // "don't repeat the same sequence" sampler (newer llama.cpp)
  dry_multiplier: 0.8,
  dry_base: 1.75,
  dry_allowed_length: 2,
};

/** For lines of structured text (memories, diary) a lighter touch: only a mild repeat penalty. */
const STRUCTURED_SAMPLING = { top_k: 40, top_p: 0.95, min_p: 0.05, repeat_penalty: 1.05 };

export interface StreamOptions {
  port: number;
  messages: ChatMessage[];
  temperature: number;
  signal?: AbortSignal;
  /** text that ends the reply, e.g. "\nAishi:" so she can't write your lines for you */
  stop?: string[];
  onToken: (token: string) => void;
}

export function streamChat(opts: StreamOptions): Promise<void> {
  return through(() => streamChatNow(opts));
}

async function streamChatNow(opts: StreamOptions): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${opts.port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature,
      max_tokens: 450,
      cache_prompt: true,
      ...CHAT_SAMPLING,
      ...(opts.stop && opts.stop.length ? { stop: opts.stop } : {}),
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

/** One normal (non-streaming) reply, e.g. for writing memories. Returns the text. */
export function chatOnce(opts: {
  port: number;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<string> {
  return through(() => chatOnceNow(opts));
}

async function chatOnceNow(opts: {
  port: number;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${opts.port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      messages: opts.messages,
      stream: false,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 350,
      ...STRUCTURED_SAMPLING,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Server error ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return "";
  return trimRunaway(content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()).text;
}
