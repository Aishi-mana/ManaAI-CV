// Progress tracking and unlock rules. No imports from the avatar code, so there are no cycles.
import { getData, setData } from "./persist";

export type Rule =
  | { type: "days"; value: number }
  | { type: "messages"; value: number }
  | { type: "skill"; value: number }
  | { type: "bond"; value: number }
  | { type: "milestone"; id: string }
  | { type: "season"; months: number[] };

export interface ItemInfo {
  name?: string;
  tags?: string[];
  /** One rule, or a list of rules that must ALL be met. No rule = available from the start. */
  unlock?: Rule | Rule[];
}
/** items.json: item id ("outfits/summer", "accessories/glasses", ...) -> info */
export type ItemCatalog = Record<string, ItemInfo>;

export interface Stats {
  firstChat: string | null;
  /** distinct local dates (YYYY-MM-DD) on which you sent a message */
  days: string[];
  messages: number;
  /** Mana's coding level: every 5 days you talk about coding or games raises it by 1. */
  skill: number;
  /** how close you two are, 0-100 (grows with days spent together) */
  bond: number;
  lastBondDay: string | null;
  /** days on which you talked about coding or games (every 5 raise her coding level) */
  practiceDays: number;
  lastPracticeDay: string | null;
  /** named achievements -> date earned */
  milestones: Record<string, string>;
}

export const EMPTY_STATS: Stats = {
  firstChat: null,
  days: [],
  messages: 0,
  skill: 0,
  bond: 0,
  lastBondDay: null,
  practiceDays: 0,
  lastPracticeDay: null,
  milestones: {},
};

export function loadStats(): Stats {
  return { ...EMPTY_STATS, ...(getData<Partial<Stats>>("stats") ?? {}) };
}

export function saveStats(s: Stats) {
  setData("stats", s);
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Call when you send a message. */
export function bumpMessage(s: Stats, now: Date = new Date()): Stats {
  const day = dayKey(now);
  return {
    ...s,
    firstChat: s.firstChat ?? day,
    days: s.days.includes(day) ? s.days : [...s.days, day],
    messages: s.messages + 1,
    milestones: s.milestones.first_chat ? s.milestones : { ...s.milestones, first_chat: day },
  };
}

/** Other features call this to grant a named milestone (first diary entry, first game...). */
export function grantMilestone(id: string, now: Date = new Date()) {
  return (s: Stats): Stats => (s.milestones[id] ? s : { ...s, milestones: { ...s.milestones, [id]: dayKey(now) } });
}

export function ruleMet(rule: Rule, s: Stats, now: Date): boolean {
  switch (rule.type) {
    case "days":
      return s.days.length >= rule.value;
    case "messages":
      return s.messages >= rule.value;
    case "skill":
      return s.skill >= rule.value;
    case "bond":
      return s.bond >= rule.value;
    case "milestone":
      return rule.id in s.milestones;
    case "season":
      return rule.months.includes(now.getMonth() + 1);
    default:
      return false; // unknown rule type: stays locked
  }
}

const asList = (u: ItemInfo["unlock"]): Rule[] => (!u ? [] : Array.isArray(u) ? u : [u]);

/** Defaults ("<slot>/default") are ALWAYS unlocked, whatever items.json says. */
export function isUnlocked(id: string, items: ItemCatalog, s: Stats, now: Date): boolean {
  if (id.endsWith("/default")) return true;
  return asList(items[id]?.unlock).every((r) => ruleMet(r, s, now));
}

/** Items whose rules became met between two stat snapshots (only ids that really exist). */
export function newlyUnlocked(items: ItemCatalog, known: Set<string>, before: Stats, after: Stats, now: Date): string[] {
  return Object.keys(items).filter(
    (id) => known.has(id) && !isUnlocked(id, items, before, now) && isUnlocked(id, items, after, now),
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function describeRule(r: Rule, s: Stats, who: string): string {
  switch (r.type) {
    case "days":
      return `Chat on ${r.value} ${r.value === 1 ? "day" : "different days"} (${Math.min(s.days.length, r.value)}/${r.value})`;
    case "messages":
      return `Send ${r.value} ${r.value === 1 ? "message" : "messages"} (${Math.min(s.messages, r.value)}/${r.value})`;
    case "skill":
      return `${who} reaches coding level ${r.value} (${Math.min(s.skill, r.value)}/${r.value})`;
    case "bond":
      return `Grow closer to ${who} (bond ${Math.min(Math.floor(s.bond), r.value)}/${r.value})`;
    case "milestone": {
      const names: Record<string, string> = {
        first_chat: "Say your first hello",
        first_diary: `${who} writes her first diary entry`,
        first_game: `${who} makes her first game`,
      };
      return names[r.id] ?? `Reach the "${r.id}" milestone`;
    }
    case "season":
      return `Only in ${r.months.map((m) => MONTHS[(m - 1) % 12]).join(", ")}`;
    default:
      return "Locked";
  }
}

/** What is still missing for an item, as one short line. */
export function hintFor(id: string, items: ItemCatalog, s: Stats, now: Date, who: string): string {
  const unmet = asList(items[id]?.unlock).filter((r) => !ruleMet(r, s, now));
  return unmet.map((r) => describeRule(r, s, who)).join(" and ");
}
