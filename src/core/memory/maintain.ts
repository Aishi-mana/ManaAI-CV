import { jaccard, tokens } from "./text";
import type { Memory } from "./types";

const MERGE_AT = 0.75; // how alike two memories must be to count as the same
const MAX_AUTO_PINS = 12;

function mergeInto(a: Memory, b: Memory): Memory {
  return {
    ...a,
    importance: Math.max(a.importance, b.importance),
    recallCount: a.recallCount + b.recallCount,
    stability: Math.max(a.stability, b.stability),
    lastRecalled: Math.max(a.lastRecalled, b.lastRecalled),
    pinned: a.pinned || b.pinned,
    noAutoPin: a.noAutoPin || b.noAutoPin,
    source: Array.from(new Set([...(a.source ?? []), ...(b.source ?? [])])),
    vec: a.vec ?? b.vec,
    vecModel: a.vec ? a.vecModel : b.vecModel,
  };
}

/**
 * Her "tidying up" while she sleeps:
 *  1. memories that say (nearly) the same thing are merged into the older one
 *  2. lasting facts that matter (importance 8+, or 6+ and recalled 4+ times) become "always remembered"
 *     (unless you unpinned them before)
 */
export function consolidate(mems: Memory[]): { memories: Memory[]; merged: number; promoted: number } {
  const order = [...mems].sort((a, b) => a.created - b.created);
  const toks = new Map<string, Set<string>>(order.map((m): [string, Set<string>] => [m.id, new Set(tokens(m.text))]));
  const index = new Map<string, string[]>();
  const kept = new Map<string, Memory>();
  let merged = 0;

  for (const m of order) {
    const ts = toks.get(m.id) ?? new Set<string>();
    const counts = new Map<string, number>();
    for (const t of ts) for (const id of index.get(t) ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);

    let target: Memory | undefined;
    for (const [id, c] of counts) {
      if (c < Math.min(2, ts.size)) continue;
      if (jaccard(ts, toks.get(id) ?? new Set<string>()) >= MERGE_AT) {
        target = kept.get(id);
        break;
      }
    }
    if (target) {
      kept.set(target.id, mergeInto(target, m));
      merged++;
    } else {
      kept.set(m.id, m);
      for (const t of ts) {
        const arr = index.get(t) ?? [];
        arr.push(m.id);
        index.set(t, arr);
      }
    }
  }

  let list = order.filter((m) => kept.has(m.id)).map((m) => kept.get(m.id) as Memory);

  let pins = list.filter((m) => m.autoPinned && m.pinned).length;
  let promoted = 0;
  list = list.map((m) => {
    if (m.pinned || m.noAutoPin || m.kind !== "fact" || pins >= MAX_AUTO_PINS) return m;
    if (m.importance >= 8 || (m.importance >= 6 && m.recallCount >= 4)) {
      pins++;
      promoted++;
      return { ...m, pinned: true, autoPinned: true };
    }
    return m;
  });

  return { memories: list, merged, promoted };
}
