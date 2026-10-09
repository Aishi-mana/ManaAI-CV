import { retrievability } from "../memory/strength";
import type { Memory } from "../memory/types";
import { dayKey } from "../persona/reflect";
import type { Mood, TraitMap } from "../persona/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type Frequency = "rare" | "normal" | "often";
export type Kind = "followup" | "greet" | "miss" | "curious" | "share" | "timeofday";

export interface Plan {
  kind: Kind;
  /** for "followup": the memory she wants to ask about */
  memory?: Memory;
}

export interface InitiativeState {
  version: 1;
  lastAt: number | null;
  day: string;
  todayCount: number;
  /** set while she is waiting for your answer to something she started */
  waitingSince: number | null;
  /** memories she already followed up on (id -> when) */
  usedMemories: Record<string, number>;
  lastKinds: Kind[];
}

export function newState(): InitiativeState {
  return { version: 1, lastAt: null, day: "", todayCount: 0, waitingSince: null, usedMemories: {}, lastKinds: [] };
}

export function normalizeState(raw: unknown): InitiativeState {
  const r = (raw ?? {}) as Partial<InitiativeState>;
  const base = newState();
  return {
    version: 1,
    lastAt: typeof r.lastAt === "number" ? r.lastAt : null,
    day: typeof r.day === "string" ? r.day : "",
    todayCount: typeof r.todayCount === "number" ? r.todayCount : 0,
    waitingSince: typeof r.waitingSince === "number" ? r.waitingSince : null,
    usedMemories: r.usedMemories && typeof r.usedMemories === "object" ? r.usedMemories : base.usedMemories,
    lastKinds: Array.isArray(r.lastKinds) ? r.lastKinds.slice(-5) : [],
  };
}

/** How often she speaks up: minutes of quiet before, minutes between, and the daily limit. */
export const FREQ: Record<Frequency, { idleMin: number; cooldownMin: number; perDay: number }> = {
  rare: { idleMin: 45, cooldownMin: 120, perDay: 3 },
  normal: { idleMin: 20, cooldownMin: 60, perDay: 6 },
  often: { idleMin: 8, cooldownMin: 30, perDay: 10 },
};

/** Quiet hours may wrap past midnight (23 to 8). */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface EligibilityInput {
  now: number;
  enabled: boolean;
  frequency: Frequency;
  quietStart: number;
  quietEnd: number;
  state: InitiativeState;
  ready: boolean;
  busy: boolean;
  /** a window like Settings or Memories is open, so you are doing something */
  drawerOpen: boolean;
  /** how long since you last typed or sent something */
  idleMs: number;
  /** random 0.7-1.3 so the timing isn't clockwork */
  jitter: number;
  mood: Mood;
  /** for the greeting when you open the app: ignore the idle time and cooldown */
  skipIdle?: boolean;
}

/** May she start a conversation right now? Always explains why not. */
export function eligibility(c: EligibilityInput): { ok: boolean; reason: string } {
  const no = (reason: string) => ({ ok: false, reason });
  if (!c.enabled) return no("turned off");
  if (!c.ready) return no("model not ready");
  if (c.busy) return no("busy");
  if (c.drawerOpen) return no("you are in a menu");
  if (inQuietHours(new Date(c.now).getHours(), c.quietStart, c.quietEnd)) return no("quiet hours");
  if (c.mood.energy < 0.25) return no("sleepy");
  if (c.state.waitingSince !== null) return no("still waiting for your answer");

  const f = FREQ[c.frequency];
  const today = c.state.day === dayKey(c.now) ? c.state.todayCount : 0;
  if (today >= f.perDay) return no("daily limit reached");

  if (!c.skipIdle) {
    if (c.state.lastAt !== null && c.now - c.state.lastAt < f.cooldownMin * 60_000) return no("too soon after the last one");
    // loneliness makes her braver: she waits up to half as long
    const need = f.idleMin * 60_000 * c.jitter * (1 - 0.5 * c.mood.lonely);
    if (c.idleMs < need) return no("you were active recently");
  }
  return { ok: true, reason: "" };
}

function weightedPick<T>(items: T[], weights: number[], rng: () => number): T | undefined {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Something that happened (not a lasting fact) that she can ask about: "how did your exam go?" */
export function pickFollowupMemory(
  mems: Memory[],
  now: number,
  used: Record<string, number>,
  rng: () => number = Math.random,
): Memory | undefined {
  const pool = mems.filter(
    (m) =>
      !m.pinned &&
      m.kind !== "fact" &&
      m.importance >= 5 &&
      now - m.created >= 3 * HOUR &&
      now - m.created <= 14 * DAY &&
      retrievability(m, now) >= 0.2 &&
      !(used[m.id] && now - used[m.id] < 5 * DAY),
  );
  return weightedPick(pool, pool.map((m) => m.importance), rng);
}

/** What she talks about, weighted by memories, mood, her curiosity and the time of day. */
export function pickPlan(c: {
  now: number;
  mems: Memory[];
  state: InitiativeState;
  mood: Mood;
  traits: TraitMap;
  awayHours: number;
  rng?: () => number;
}): Plan {
  const rng = c.rng ?? Math.random;
  const memory = pickFollowupMemory(c.mems, c.now, c.state.usedMemories, rng);
  const hour = new Date(c.now).getHours();
  const dayPart = (hour >= 7 && hour < 11) || (hour >= 18 && hour < 22);
  const options: { kind: Kind; w: number }[] = [
    { kind: "followup", w: memory ? 3 : 0 },
    { kind: "miss", w: c.mood.lonely > 0.35 || c.awayHours >= 8 ? 3 : 0 },
    { kind: "curious", w: 1 + 2 * c.traits.curiosity },
    { kind: "share", w: 1.2 },
    { kind: "timeofday", w: dayPart ? 2 : 0 },
  ];
  const recent = c.state.lastKinds.slice(-2);
  const weights = options.map((o) => o.w * (recent.includes(o.kind) ? 0.3 : 1));
  const kind = weightedPick(options, weights, rng)?.kind ?? "curious";
  return { kind, memory: kind === "followup" ? memory : undefined };
}

/** Bookkeeping when she starts one. */
export function recordStart(s: InitiativeState, plan: Plan, now: number): InitiativeState {
  const day = dayKey(now);
  const used = { ...s.usedMemories };
  if (plan.memory) used[plan.memory.id] = now;
  for (const id of Object.keys(used)) if (now - used[id] > 30 * DAY) delete used[id];
  return {
    ...s,
    lastAt: now,
    day,
    todayCount: (s.day === day ? s.todayCount : 0) + 1,
    waitingSince: now,
    usedMemories: used,
    lastKinds: [...s.lastKinds, plan.kind].slice(-5),
  };
}

function humanHours(h: number): string {
  return h < 36 ? `about ${Math.max(1, Math.round(h))} hours` : `about ${Math.round(h / 24)} days`;
}

/**
 * The hidden instruction she receives instead of a message from you
 * (it is not saved in the chat).
 */
export function initiativeTurn(
  plan: Plan,
  c: { userName: string; awayHours: number; hour: number; memoryText?: string },
): string {
  const u = c.userName;
  let body: string;
  switch (plan.kind) {
    case "greet":
      body = `${u} just opened the app after being away for ${humanHours(c.awayHours)}. Greet ${u} warmly, say you missed them or that you are happy they are back, then ask one small question about their day.`;
      break;
    case "followup":
      body = `${u} hasn't said anything for a while, so you start a new conversation yourself. You remember this about ${u}: "${c.memoryText ?? ""}". Ask ${u} about it in a natural, caring way, for example how it went.`;
      break;
    case "miss":
      body = `${u} has been quiet for a while and you miss them. Say something sweet about missing ${u}, and ask one small question to get them talking.`;
      break;
    case "share":
      body = `${u} hasn't said anything for a while, so you start a new conversation yourself. Share one small thing you are excited about or an idea you would like to try, such as a game idea or something you want to learn. Do not claim that you finished or built anything. Then ask what ${u} thinks.`;
      break;
    case "timeofday":
      body =
        c.hour < 12
          ? `It is morning and ${u} hasn't said anything yet. Greet ${u} and ask what they are planning to do today.`
          : `It is evening and ${u} hasn't said anything for a while. Ask how ${u}'s day went.`;
      break;
    default:
      body = `${u} hasn't said anything for a while, so you start a new conversation yourself. Ask ${u} one new question to get to know them better. It must be something you don't already know from your memories. Keep it light and fun.`;
  }
  return `[${body} Speak in your usual voice. Write only 1 to 3 short sentences, ask exactly one question, and end with an emotion tag.]`;
}
