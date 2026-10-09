import { baselineValence } from "./mood";
import type { Persona, Trait, TraitMap } from "./types";
import { TRAITS } from "./types";

export const MAX_DRIFT = 0.2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const DEFAULT_BASELINE: TraitMap = { cheerfulness: 0.8, shyness: 0.2, clinginess: 0.5, curiosity: 0.9, sass: 0.4 };
const ZERO: TraitMap = { cheerfulness: 0, shyness: 0, clinginess: 0, curiosity: 0, sass: 0 };

export const TRAIT_LABEL: Record<Trait, string> = {
  cheerfulness: "Cheerfulness",
  shyness: "Shyness",
  clinginess: "Clinginess",
  curiosity: "Curiosity",
  sass: "Sassiness",
};

export function newPersona(now: number): Persona {
  return {
    version: 1,
    baseline: { ...DEFAULT_BASELINE },
    drift: { ...ZERO },
    mood: { valence: baselineValence(DEFAULT_BASELINE.cheerfulness), energy: 0.8, lonely: 0, worry: 0, at: now },
    lastChatAt: null,
    lastReflectionAt: null,
  };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Reads persona.json defensively (missing, old, or hand-edited). */
export function normalizePersona(raw: unknown, now: number): Persona {
  const base = newPersona(now);
  const r = (raw ?? {}) as Partial<Persona>;
  const baseline = { ...base.baseline };
  const drift = { ...base.drift };
  for (const t of TRAITS) {
    baseline[t] = clamp(num(r.baseline?.[t], base.baseline[t]), 0, 1);
    drift[t] = clamp(num(r.drift?.[t], 0), -MAX_DRIFT, MAX_DRIFT);
  }
  const m = (r.mood ?? {}) as Partial<Persona["mood"]>;
  return {
    version: 1,
    baseline,
    drift,
    mood: {
      valence: clamp(num(m.valence, base.mood.valence), -1, 1),
      energy: clamp(num(m.energy, base.mood.energy), 0, 1),
      lonely: clamp(num(m.lonely, 0), 0, 1),
      worry: clamp(num(m.worry, 0), 0, 1),
      at: num(m.at, now),
    },
    lastChatAt: typeof r.lastChatAt === "number" ? r.lastChatAt : null,
    lastReflectionAt: typeof r.lastReflectionAt === "number" ? r.lastReflectionAt : null,
  };
}

/** What each trait is right now: baseline plus drift. */
export function currentTraits(p: Persona): TraitMap {
  const out = { ...ZERO };
  for (const t of TRAITS) out[t] = clamp(p.baseline[t] + p.drift[t], 0, 1);
  return out;
}

/** Nudges traits. Drift never goes beyond +/- 0.2 from the baseline (and never past 0 or 1). */
export function applyDrift(p: Persona, deltas: Partial<TraitMap>): Persona {
  const drift = { ...p.drift };
  for (const t of TRAITS) {
    const d = deltas[t];
    if (!d) continue;
    const lo = Math.max(-MAX_DRIFT, -p.baseline[t]);
    const hi = Math.min(MAX_DRIFT, 1 - p.baseline[t]);
    drift[t] = clamp(drift[t] + d, lo, hi);
  }
  return { ...p, drift };
}

export function setBaseline(p: Persona, t: Trait, value: number): Persona {
  const baseline = { ...p.baseline, [t]: clamp(value, 0, 1) };
  return applyDrift({ ...p, baseline }, {}); // re-checks the limits
}

export function resetDrift(p: Persona): Persona {
  return { ...p, drift: { ...ZERO } };
}

const HIGH: Record<Trait, string> = {
  cheerfulness: "She is naturally cheerful and upbeat.",
  shyness: "She is shy and easily flustered.",
  clinginess: "She gets attached easily and misses {{user}} a lot.",
  curiosity: "She is very curious and asks lots of questions.",
  sass: "She likes to tease {{user}} playfully.",
};
const LOW: Record<Trait, string> = {
  cheerfulness: "She is a bit serious and quiet by nature.",
  shyness: "She is not shy at all and speaks up easily.",
  clinginess: "She is independent and doesn't cling to {{user}}.",
  curiosity: "She doesn't ask many questions.",
  sass: "She is gentle and rarely teases.",
};
const ADJ: Record<Trait, string> = { cheerfulness: "cheerful", shyness: "shy", clinginess: "clingy", curiosity: "curious", sass: "sassy" };

/** Plain-language lines for her prompt: extreme traits, and anything that has drifted noticeably. */
export function traitLines(p: Persona): string[] {
  const now = currentTraits(p);
  const out: string[] = [];
  for (const t of TRAITS) {
    if (now[t] >= 0.7) out.push(HIGH[t]);
    else if (now[t] <= 0.3) out.push(LOW[t]);
  }
  const drifted = TRAITS.filter((t) => Math.abs(p.drift[t]) >= 0.07).map((t) => `${p.drift[t] > 0 ? "more" : "less"} ${ADJ[t]}`);
  if (drifted.length) out.push(`Lately she has been ${drifted.join(" and ")} than usual.`);
  return out;
}

export interface Stage {
  key: string;
  label: string;
  min: number;
  phrase: string;
}

export const STAGES: Stage[] = [
  { key: "new", label: "Getting to know you", min: 0, phrase: "You are still getting to know {{user}}. You are friendly but a little careful and polite." },
  { key: "friendly", label: "Friends", min: 15, phrase: "You and {{user}} are comfortable together now. You feel relaxed and joke around more." },
  { key: "close", label: "Close", min: 40, phrase: "You and {{user}} are very close. You share little secrets and feel free to be silly or sulky." },
  { key: "bonded", label: "Inseparable", min: 80, phrase: "{{user}} is the most important person in your world. You are openly affectionate and trust {{user}} completely." },
];

export function stageOf(bond: number): { stage: Stage; next: Stage | null } {
  let idx = 0;
  STAGES.forEach((s, i) => {
    if (bond >= s.min) idx = i;
  });
  return { stage: STAGES[idx], next: STAGES[idx + 1] ?? null };
}
