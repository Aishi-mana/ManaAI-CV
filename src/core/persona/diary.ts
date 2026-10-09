import { cleanReply } from "../emotion";
import { toPlaceholders } from "../memory/extract";
import type { ChatMessage } from "../types";
import type { DiaryEntry, DiaryFile } from "./types";

export interface DiaryContext {
  userName: string;
  charName: string;
  dateLabel: string;
  moodPhrase: string;
  bondPhrase: string;
  userMessages: number;
  awayText: string;
  /** what she remembers from today (real names filled in) */
  memories: string[];
  /** optionally, one half-faded memory she might mention */
  faintMemory?: string;
}

/** The prompt for her diary entry. `card` is her filled-in character card so the voice matches. */
export function buildDiaryMessages(card: string, c: DiaryContext): ChatMessage[] {
  const facts = c.memories.length ? c.memories.map((t) => `- ${t}`).join("\n") : "- (nothing special stood out)";
  const faint = c.faintMemory
    ? `\nYou also have one memory that is fading and fuzzy: "${c.faintMemory}". You may mention that you only vaguely remember it.`
    : "";
  const system = `${card}

You are now writing in your private diary, in your own voice as ${c.charName}. Write 3 to 6 short sentences, casual and cute. Only write about things listed below. Never invent events, games, projects or places that are not listed. Do not list the notes; just write naturally, like a girl's diary. End with one emotion tag in square brackets, like [happy].`;
  const user = `Date: ${c.dateLabel}
How you feel tonight: ${c.moodPhrase}
${c.userName} sent you ${c.userMessages} message${c.userMessages === 1 ? "" : "s"} today${c.awayText}.
${c.bondPhrase}
Things you remember from today:
${facts}${faint}

Write your diary entry now.`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Cleans up the model's diary text. Returns null if it isn't usable. */
export function parseDiary(raw: string, userName: string, charName: string): { text: string; emotion: string | null } | null {
  const { text, emotion } = cleanReply(raw);
  const t = toPlaceholders(text.replace(/^["'`]+|["'`]+$/g, "").trim(), userName, charName);
  if (t.length < 20) return null;
  return { text: t.slice(0, 1200), emotion };
}

export function normalizeDiary(raw: unknown): DiaryEntry[] {
  const r = (raw ?? {}) as Partial<DiaryFile>;
  const list: unknown[] = Array.isArray(r.entries) ? r.entries : [];
  return list.filter((x): x is DiaryEntry => {
    const e = x as Partial<DiaryEntry> | null;
    return !!e && typeof e.id === "string" && typeof e.text === "string" && typeof e.at === "number";
  });
}
