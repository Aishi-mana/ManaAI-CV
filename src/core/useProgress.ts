import { useCallback, useRef, useState } from "react";
import type { AvatarAssets } from "./avatar";
import { loadStats, newlyUnlocked, saveStats } from "./progress";
import type { Stats } from "./progress";
import { allItemIds } from "./wardrobe";

/**
 * Your shared progress with Mana. update(fn) applies a change and returns the ids of
 * anything that just unlocked, so the app can celebrate (and tell her) right away.
 */
export function useProgress(assets: AvatarAssets | null) {
  const [stats, setStats] = useState<Stats>(loadStats);
  const [fresh, setFresh] = useState<string[]>([]);
  const statsRef = useRef(stats);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  const update = useCallback((fn: (s: Stats) => Stats): string[] => {
    const before = statsRef.current;
    const after = fn(before);
    statsRef.current = after;
    setStats(after);
    saveStats(after);
    const a = assetsRef.current;
    const ids = a ? newlyUnlocked(a.items, new Set(allItemIds(a)), before, after, new Date()) : [];
    if (ids.length) setFresh((f) => [...f, ...ids]);
    return ids;
  }, []);

  const dismiss = useCallback(() => setFresh([]), []);
  return { stats, update, fresh, dismiss };
}
