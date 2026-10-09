import { DAY, FAINT_BELOW, retrievability } from "./strength";
import { keywordRel } from "./text";
import type { Memory, Recalled } from "./types";
import { cosine, decodeVec } from "./vectors";

// Tuning knobs (the Memories window shows each recall's numbers so you can adjust these).
export const MIN_REL = 0.25; // how well it must match to come to mind
export const MIN_REL_FAINT = 0.4; // faint memories need a stronger match
export const EMBED_LO = 0.5; // cosine at/below this counts as "unrelated" (bge-small)
export const EMBED_HI = 0.85; // cosine at/above this counts as a perfect match

/** Phrases that mean "try hard to remember": faint memories may come back. */
export const CUE = /\b(remember|remind(?:ed)?|recall|forgot|forget|did we|do you know|what was)\b/i;
export const hasCue = (text: string) => CUE.test(text);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export interface RecallOptions {
  k?: number;
  /** the person is explicitly asking her to remember: faint memories are allowed */
  cue?: boolean;
  queryVec?: Float32Array | null;
  vecModel?: string;
}

/**
 * Picks the memories that come to mind for what was just said.
 * score = match * (0.35 + 0.65 * strength) + a little for importance + a little for being very recent.
 * Pinned memories are skipped here because they are always in her prompt anyway.
 */
export function recall(mems: Memory[], query: string, now: number, opts: RecallOptions = {}): Recalled[] {
  const k = opts.k ?? 4;
  const cands = mems.filter((m) => !m.pinned);
  const kw = keywordRel(query, cands.map((m) => m.text));
  const out: Recalled[] = [];

  cands.forEach((m, i) => {
    const R = retrievability(m, now);
    const faint = R < FAINT_BELOW;
    if (faint && !opts.cue) return;

    let rel = kw[i];
    if (opts.queryVec && m.vec && m.vecModel === opts.vecModel) {
      const cos = cosine(opts.queryVec, decodeVec(m.vec));
      const mapped = clamp01((cos - EMBED_LO) / (EMBED_HI - EMBED_LO));
      rel = 0.7 * mapped + 0.3 * kw[i];
    }
    if (rel < (faint ? MIN_REL_FAINT : MIN_REL)) return;

    const recent = Math.max(0, 1 - (now - m.created) / DAY) * 0.04;
    const score = rel * (0.35 + 0.65 * R) + 0.06 * (m.importance / 10) + recent;
    out.push({ memory: m, rel, score, vague: faint || R < 0.35, retrievability: R });
  });

  return out.sort((a, b) => b.score - a.score).slice(0, k);
}
