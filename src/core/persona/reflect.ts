import { cleanReply } from "../emotion";
import type { Stats } from "../progress";
import type { Msg } from "../types";
import type { DayStats, Trait } from "./types";

const HOUR = 3_600_000;

/** Words that count as "we talked about coding or making games". */
export const PRACTICE =
  /\b(code|coding|coded|program(?:ming|mer)?|bugs?|debug(?:ging)?|scripts?|python|javascript|unity|godot|game ?dev|make (?:a )?games?|making (?:a )?games?|level design|sprites?)\b/i;

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Summarizes the messages since her last reflection (only messages that have a timestamp). */
export function dayStats(msgs: Msg[], since: number | null, _now: number): DayStats {
  const user = msgs.filter((m) => m.role === "user" && m.at).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const tags: Record<string, number> = {};
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    const e = cleanReply(m.content).emotion;
    if (e) tags[e] = (tags[e] ?? 0) + 1;
  }
  let maxGap = 0;
  let prev = since && since > 0 ? since : null;
  for (const m of user) {
    const t = m.at ?? 0;
    if (prev !== null) maxGap = Math.max(maxGap, (t - prev) / HOUR);
    prev = t;
  }
  return {
    userMessages: user.length,
    tags,
    maxGapHours: maxGap,
    practice: user.some((m) => PRACTICE.test(m.content)),
  };
}

/**
 * How her traits drift after a day (small steps: about 10-20 days of the same kind of
 * day to reach the +/- 0.2 limit).
 */
export function driftFromDay(s: DayStats): Partial<Record<Trait, number>> {
  const pos = (s.tags.happy ?? 0) + (s.tags.excited ?? 0) + (s.tags.proud ?? 0);
  const neg = (s.tags.sad ?? 0) + (s.tags.worried ?? 0);
  const total = Object.values(s.tags).reduce((a, b) => a + b, 0);
  const d: Partial<Record<Trait, number>> = {};
  if (total >= 4) d.cheerfulness = (0.02 * (pos - neg)) / total;
  if (s.maxGapHours >= 24) d.clinginess = 0.015; // being left alone makes her cling
  else if (s.userMessages >= 20) d.clinginess = -0.01; // lots of company makes her secure
  if (s.userMessages >= 10) d.shyness = -0.01; // getting used to you
  if ((s.tags.embarrassed ?? 0) >= 2) d.shyness = (d.shyness ?? 0) + 0.015;
  return d;
}

/**
 * Bond points: 1 for the first active reflection of a calendar day, plus up to +2 for happy moments.
 * Bond never goes down.
 */
export function bondGain(s: DayStats, firstOfDay: boolean): number {
  if (s.userMessages === 0) return 0;
  const pos = (s.tags.happy ?? 0) + (s.tags.excited ?? 0) + (s.tags.proud ?? 0);
  return (firstOfDay ? 1 : 0) + Math.min(2, pos * 0.2);
}

/** Updates the shared progress: bond, practice days, and her coding level (1 per 5 practice days). */
export function applyDayToStats(st: Stats, s: DayStats, now: number): Stats {
  const today = dayKey(now);
  const newPractice = s.practice && st.lastPracticeDay !== today;
  const practiceDays = st.practiceDays + (newPractice ? 1 : 0);
  return {
    ...st,
    bond: Math.min(100, st.bond + bondGain(s, st.lastBondDay !== today)),
    lastBondDay: s.userMessages > 0 ? today : st.lastBondDay,
    practiceDays,
    lastPracticeDay: s.practice ? today : st.lastPracticeDay,
    skill: Math.max(st.skill, Math.floor(practiceDays / 5)),
  };
}
