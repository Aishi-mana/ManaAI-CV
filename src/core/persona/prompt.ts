import { describeMood, timeOfDay } from "./mood";
import { stageOf, traitLines } from "./traits";
import type { Mood, Persona } from "./types";

function humanHours(h: number): string {
  if (h < 36) return `about ${Math.max(1, Math.round(h))} hours`;
  return `about ${Math.round(h / 24)} days`;
}

export interface Returning {
  awayHours: number;
  /** how lonely she was just before you wrote */
  lonelyBefore: number;
}

/**
 * Her inner state as plain sentences for the system prompt (never numbers).
 * Keeps {{user}}/{{char}} placeholders; the caller fills them in.
 */
export function personaSection(p: Persona, mood: Mood, bond: number, now: number, returning?: Returning): string {
  const lines: string[] = [];
  lines.push(`It is ${timeOfDay(new Date(now).getHours())}. Right now {{char}} feels ${describeMood(mood).phrase}.`);
  if (returning && returning.awayHours >= 6) {
    lines.push(
      `{{user}} was away for ${humanHours(returning.awayHours)} and has just come back. ` +
        (returning.lonelyBefore > 0.3 ? "{{char}} really missed {{user}}." : "{{char}} is happy to see {{user}} again."),
    );
  }
  lines.push(stageOf(bond).stage.phrase);
  lines.push(...traitLines(p));
  return `\n\n${lines.join(" ")}\nLet this color how you talk, but never mention these notes or any numbers.`;
}
