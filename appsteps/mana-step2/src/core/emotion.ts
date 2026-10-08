export const EMOTIONS = ["happy", "sad", "excited", "worried", "thinking", "surprised", "embarrassed", "sleepy", "neutral"] as const;

/**
 * Turns raw model output into display text + emotion.
 * - removes <think>...</think> blocks (reasoning models)
 * - pulls a trailing [emotion] tag off the end
 * - hides a half-typed tag while the reply is still streaming
 */
export function cleanReply(raw: string): { text: string; emotion: string | null } {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "");
  let emotion: string | null = null;

  const m = t.match(/\[\s*([a-zA-Z]+)\s*\]\s*$/);
  if (m && m.index !== undefined) {
    emotion = m[1].toLowerCase();
    t = t.slice(0, m.index);
  }
  t = t.replace(/\[\s*[a-zA-Z]*\s*$/, "");

  return { text: t.trim(), emotion };
}
