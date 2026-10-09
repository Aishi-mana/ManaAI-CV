import { uid } from "../types";
import { initialStability, reinforce } from "./strength";
import { jaccard, tokens } from "./text";
import type { Memory, MemoryFile, MemoryKind } from "./types";
import { EMPTY_MEMORY_FILE } from "./types";
import { cosine, decodeVec } from "./vectors";

export const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export function newMemory(
  p: {
    text: string;
    importance: number;
    emotion?: string;
    kind?: MemoryKind;
    source?: string[];
    manual?: boolean;
    pinned?: boolean;
    vec?: string;
    vecModel?: string;
  },
  now: number,
): Memory {
  const importance = clampInt(p.importance, 1, 10);
  const emotion = p.emotion ?? "neutral";
  return {
    id: uid(),
    text: p.text.trim(),
    kind: p.kind ?? "event",
    emotion,
    importance,
    created: now,
    lastRecalled: now,
    recallCount: 0,
    stability: initialStability(importance, emotion),
    pinned: !!p.pinned,
    source: p.source,
    vec: p.vec,
    vecModel: p.vecModel,
    manual: p.manual,
  };
}

/** Reads memory.json defensively (it may be missing, old, or hand-edited). */
export function normalizeFile(raw: unknown): MemoryFile {
  const r = (raw ?? {}) as Partial<MemoryFile>;
  const list: unknown[] = Array.isArray(r.memories) ? r.memories : [];
  const memories = list.filter((x): x is Memory => {
    const m = x as Partial<Memory> | null;
    return !!m && typeof m.id === "string" && typeof m.text === "string" && typeof m.stability === "number";
  });
  return { ...EMPTY_MEMORY_FILE, memories, extractedUpTo: typeof r.extractedUpTo === "string" ? r.extractedUpTo : null };
}

/** An existing memory that says (nearly) the same thing, if any. */
export function findDuplicate(mems: Memory[], cand: Memory): Memory | undefined {
  const ct = new Set(tokens(cand.text));
  for (const m of mems) {
    if (m.vec && cand.vec && m.vecModel === cand.vecModel && cosine(decodeVec(m.vec), decodeVec(cand.vec)) >= 0.93) return m;
    if (jaccard(ct, new Set(tokens(m.text))) >= 0.7) return m;
  }
  return undefined;
}

/** Adds a memory, or - if she already knows it - strengthens the existing one instead. */
export function addOrMerge(mems: Memory[], cand: Memory, now: number): { memories: Memory[]; merged: boolean } {
  const dup = findDuplicate(mems, cand);
  if (!dup) return { memories: [...mems, cand], merged: false };
  const merged: Memory = {
    ...reinforce(dup, now, 1.3),
    importance: Math.max(dup.importance, cand.importance),
    pinned: dup.pinned || cand.pinned,
    source: Array.from(new Set([...(dup.source ?? []), ...(cand.source ?? [])])),
    vec: dup.vec ?? cand.vec,
    vecModel: dup.vec ? dup.vecModel : cand.vecModel,
  };
  return { memories: mems.map((m) => (m.id === dup.id ? merged : m)), merged: true };
}
