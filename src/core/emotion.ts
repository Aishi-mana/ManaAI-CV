import { trimRunaway } from "./guard";

export const EMOTIONS = ["happy", "sad", "excited", "worried", "thinking", "surprised", "embarrassed", "sleepy", "neutral"] as const;

let speakerNames: string[] = [];

/** The two names models like to put in front of a line ("Mana: ..."). Set by the app. */
export function setSpeakerNames(names: string[]) {
  speakerNames = names.map((n) => n.trim()).filter(Boolean);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes a "Mana:" / "**Mana**:" label at the start of the reply (or of any line). */
export function stripSpeakerPrefix(text: string): string {
  let t = text;
  for (let i = 0; i < 3; i++) {
    const before = t;
    for (const n of speakerNames) {
      t = t.replace(new RegExp(`^[ \\t]*(?:\\*\\*)?${escapeRe(n)}(?:\\*\\*)?[ \\t]*[:：][ \\t]*`, "gim"), "");
    }
    if (t === before) break;
  }
  return t;
}

/** Her earlier replies as the model should see them: no name labels, no loops (tags are kept). */
export function sanitizeForModel(text: string): string {
  return trimRunaway(stripSpeakerPrefix(text)).text;
}

const KNOWN_TAG = new RegExp(`\\[\\s*(${EMOTIONS.join("|")})\\s*\\]`, "gi");

/**
 * Turns raw model output into display text + emotion.
 * - removes <think>...</think> blocks (reasoning models)
 * - removes emotion tags like [excited] wherever the model put them (middle or end); the last one is her emotion
 * - pulls any other trailing [word] tag off the end
 * - hides a half-typed tag while the reply is still streaming
 */
export function cleanReply(raw: string): { text: string; emotion: string | null } {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "");

  const found: string[] = [];
  t = t.replace(KNOWN_TAG, (_m: string, e: string) => {
    found.push(e.toLowerCase());
    return "";
  });
  let emotion: string | null = found.length ? found[found.length - 1] : null;

  const m = t.match(/\[\s*([a-zA-Z]+)\s*\]\s*$/);
  if (m && m.index !== undefined) {
    if (!emotion) emotion = m[1].toLowerCase();
    t = t.slice(0, m.index);
  }
  t = t.replace(/\[\s*[a-zA-Z]*\s*$/, "");
  t = stripSpeakerPrefix(t);
  t = trimRunaway(t).text;
  t = t.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  return { text: t.trim(), emotion };
}
