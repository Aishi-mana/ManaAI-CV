import type { Mood } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const HOUR = 3_600_000;

/** Energy she naturally has at a given hour of the day. */
export function energyByHour(h: number): number {
  if (h < 5) return 0.2;
  if (h < 7) return 0.4;
  if (h < 9) return 0.65;
  if (h < 21) return 0.85;
  if (h < 23) return 0.6;
  return 0.35;
}

/** The mood she drifts back to when nothing is happening (cheerful girls rest happier). */
export function baselineValence(cheerfulness: number): number {
  return 0.1 + (cheerfulness - 0.5) * 0.8;
}

const decay = (value: number, target: number, hours: number, halfLife: number) =>
  target + (value - target) * Math.pow(0.5, hours / halfLife);

export function timeOfDay(hour: number): string {
  if (hour < 5) return "the middle of the night";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "late at night";
}

/**
 * Brings a stored mood up to date: feelings fade back toward her resting mood
 * (hours), energy follows the time of day, and loneliness builds while you are away.
 */
export function settleMood(
  m: Mood,
  traits: { cheerfulness: number; clinginess: number },
  lastChatAt: number | null,
  now: number,
): Mood {
  const hours = Math.max(0, (now - m.at) / HOUR);
  const d = new Date(now);
  const hour = d.getHours() + d.getMinutes() / 60;
  const away = lastChatAt === null ? 0 : Math.max(0, (now - lastChatAt) / HOUR);
  const lonelyTarget = clamp((away - 6) / 42, 0, 1) * (0.4 + 0.6 * traits.clinginess);
  return {
    valence: decay(m.valence, baselineValence(traits.cheerfulness), hours, 3),
    energy: decay(m.energy, energyByHour(hour), hours, 1.5),
    worry: decay(m.worry, 0, hours, 1.5),
    lonely: Math.max(lonelyTarget, decay(m.lonely, 0, hours, 6)),
    at: now,
  };
}

/** You sent a message. After a long absence she is delighted; either way loneliness eases. */
export function afterUserMessage(m: Mood, awayHours: number, now: number): Mood {
  const back = awayHours >= 6;
  return {
    ...m,
    valence: back ? clamp(m.valence + 0.25 * (1 - Math.abs(m.valence)), -1, 1) : m.valence,
    lonely: m.lonely * (back ? 0.3 : 0.7),
    at: now,
  };
}

const TAG_EFFECT: Record<string, { v?: number; e?: number; w?: number }> = {
  happy: { v: 0.15 },
  excited: { v: 0.2, e: 0.1 },
  proud: { v: 0.15 },
  sad: { v: -0.25 },
  worried: { v: -0.1, w: 0.25 },
  embarrassed: { v: 0.05 },
  surprised: { e: 0.05 },
  sleepy: { e: -0.2 },
};

/** Her own reply nudges her mood a little (softly, so she never gets stuck at an extreme). */
export function afterReplyTag(m: Mood, tag: string | null, now: number): Mood {
  const fx = tag ? TAG_EFFECT[tag] : undefined;
  if (!fx) return { ...m, at: now };
  return {
    valence: clamp(m.valence + (fx.v ?? 0) * (1 - Math.abs(m.valence)), -1, 1),
    energy: clamp(m.energy + (fx.e ?? 0), 0, 1),
    worry: clamp(m.worry + (fx.w ?? 0), 0, 1),
    lonely: m.lonely,
    at: now,
  };
}

/** Something good happened (like unlocking an outfit). */
export function afterGoodNews(m: Mood, now: number): Mood {
  return { ...m, valence: clamp(m.valence + 0.2 * (1 - Math.abs(m.valence)), -1, 1), at: now };
}

export interface MoodInfo {
  label: string;
  /** which expression her face uses (matches avatar-map.json) */
  emotion: string;
  phrase: string;
}

export function describeMood(m: Mood): MoodInfo {
  let info: MoodInfo;
  if (m.energy < 0.25) info = { label: "sleepy", emotion: "sleepy", phrase: "very sleepy" };
  else if (m.lonely > 0.55) info = { label: "lonely", emotion: "sad", phrase: "lonely and missing {{user}}" };
  else if (m.worry > 0.5) info = { label: "worried", emotion: "worried", phrase: "worried" };
  else if (m.valence < -0.35) info = { label: "sad", emotion: "sad", phrase: "sad" };
  else if (m.valence > 0.55 && m.energy > 0.6) info = { label: "excited", emotion: "excited", phrase: "bubbly and excited" };
  else if (m.valence > 0.25) info = { label: "happy", emotion: "happy", phrase: "happy" };
  else if (m.valence < -0.15) info = { label: "a little down", emotion: "sad", phrase: "a little down" };
  else info = { label: "calm", emotion: "neutral", phrase: "calm" };

  if (info.label !== "sleepy" && m.energy < 0.45) info = { ...info, phrase: info.phrase + ", a bit tired" };
  else if (m.energy > 0.8 && (info.label === "happy" || info.label === "calm") && m.valence > 0) {
    info = { ...info, phrase: info.phrase + ", full of energy" };
  }
  return info;
}
