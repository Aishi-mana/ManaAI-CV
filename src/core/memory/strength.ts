import type { Memory } from "./types";

export const DAY = 86_400_000;
/** Below this strength a memory is "faint": not recalled normally, but it can be revived by a cue. */
export const FAINT_BELOW = 0.15;

const EMOTIONAL = new Set(["happy", "sad", "excited", "worried", "angry", "embarrassed", "proud", "lonely"]);

/**
 * How many days a new memory takes to fade to ~37%.
 * importance 2 ~ 2 days, 5 ~ 1 week, 8 ~ 3 weeks, 10 ~ 6 weeks; emotional ones last 1.5x longer.
 */
export function initialStability(importance: number, emotion: string): number {
  const base = 1.5 * Math.pow(1.45, importance - 1);
  return base * (EMOTIONAL.has(emotion) ? 1.5 : 1);
}

/** Current strength 0-1: exp(-days since last recalled / stability). Pinned memories stay at 1. */
export function retrievability(m: Memory, now: number): number {
  if (m.pinned) return 1;
  const days = Math.max(0, (now - m.lastRecalled) / DAY);
  return Math.exp(-days / m.stability);
}

export const isFaint = (m: Memory, now: number) => !m.pinned && retrievability(m, now) < FAINT_BELOW;

/** Recalling a memory makes it stronger and slower to fade (like spaced repetition). */
export function reinforce(m: Memory, now: number, factor = 1.8): Memory {
  return { ...m, lastRecalled: now, recallCount: m.recallCount + 1, stability: Math.min(m.stability * factor, 3650) };
}
