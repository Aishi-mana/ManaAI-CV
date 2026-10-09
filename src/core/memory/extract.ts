import { cleanReply } from "../emotion";
import type { ChatMessage, Msg } from "../types";
import type { MemoryKind } from "./types";

export const EMOTIONS = ["neutral", "happy", "sad", "excited", "worried", "angry", "embarrassed", "proud", "lonely"];

export interface Candidate {
  importance: number;
  emotion: string;
  text: string;
}

const EXAMPLES = [
  "{user} said their favorite food is pepperoni pizza.",
  "{char} and {user} played a jumping game together.",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Swap the real names for {{user}} / {{char}} so a rename never leaves stale memories. */
export function toPlaceholders(text: string, userName: string, charName: string): string {
  let t = text;
  if (userName.trim()) t = t.replace(new RegExp(`\\b${escapeRe(userName.trim())}\\b`, "gi"), "{{user}}");
  if (charName.trim()) t = t.replace(new RegExp(`\\b${escapeRe(charName.trim())}\\b`, "gi"), "{{char}}");
  return t;
}

/** A guess at whether a memory is a lasting fact about someone or a one-time event. */
export function guessKind(text: string): MemoryKind {
  return /\b(likes?|loves?|hates?|favorite|favourite|birthday|works?|lives?|is a|has a|name is|allergic|afraid|prefers?)\b/i.test(text)
    ? "fact"
    : "event";
}

/** The conversation excerpt as plain text with real names (reply tags like [happy] removed). */
export function formatExcerpt(chunk: Msg[], userName: string, charName: string): string {
  return chunk
    .map((m) => {
      const body = m.role === "assistant" ? cleanReply(m.content).text : m.content;
      return `${m.role === "user" ? userName : charName}: ${body.replace(/\s+/g, " ").trim().slice(0, 600)}`;
    })
    .join("\n");
}

export function buildExtractionMessages(chunk: Msg[], userName: string, charName: string): ChatMessage[] {
  const system = `You help ${charName} keep a memory journal about her daily life with ${userName}. Read the conversation excerpt and decide what is worth remembering later.

Write 0 to 4 lines. Each line must look exactly like this:
IMPORTANCE | EMOTION | MEMORY

- IMPORTANCE: a number from 1 to 10. 1-2 = small talk, 3-5 = a normal notable moment, 6-8 = something personal, a plan, a promise or a strong feeling, 9-10 = a major life event.
- EMOTION: one word from: ${EMOTIONS.join(", ")}.
- MEMORY: one short sentence in the past tense. Use the names ${userName} and ${charName}. Do not use he, she or they.

Only write things that were really said in the excerpt. Never invent anything. If nothing is worth remembering, write only: NONE

Format examples (not real memories):
7 | happy | ${userName} said their favorite food is pepperoni pizza.
5 | excited | ${charName} and ${userName} played a jumping game together.`;
  return [
    { role: "system", content: system },
    { role: "user", content: `Conversation excerpt:\n${formatExcerpt(chunk, userName, charName)}\n\nMemory journal lines:` },
  ];
}

const LINE = /^\s*(?:[-*\u2022]\s*|\d+[.)]\s+)?(\d{1,2})(?:\s*\/\s*10)?\s*\|\s*([A-Za-z]+)\s*\|\s*(.+?)\s*$/;

/** Reads the model's lines. Anything that doesn't fit the format is ignored. */
export function parseExtraction(raw: string, userName = "", charName = ""): Candidate[] {
  const out: Candidate[] = [];
  const example = EXAMPLES.map((e) => toPlaceholders(e.replace("{user}", "{{user}}").replace("{char}", "{{char}}"), "", ""));
  for (const line of raw.replace(/<think>[\s\S]*?<\/think>/gi, "").split(/\r?\n/)) {
    const m = line.match(LINE);
    if (!m) continue;
    const importance = Math.min(10, Math.max(1, parseInt(m[1], 10)));
    const emotion = EMOTIONS.includes(m[2].toLowerCase()) ? m[2].toLowerCase() : "neutral";
    const text = m[3].replace(/^["'`]+|["'`]+$/g, "").trim();
    if (text.length < 8 || text.length > 300 || /^none\b/i.test(text)) continue;
    const normalized = toPlaceholders(text, userName, charName);
    // models sometimes copy the format examples back; skip those
    if (example.some((e) => e === normalized)) continue;
    if (importance <= 1) continue; // trivial small talk isn't worth keeping
    out.push({ importance, emotion, text: normalized });
  }
  return out;
}
