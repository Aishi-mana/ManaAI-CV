import { useCallback, useEffect, useState } from "react";
import { loadAvatarAssets, revokeAssets } from "./avatar";
import type { AvatarAssets } from "./avatar";
import { inTauri } from "./useLlama";

export type AvatarStatus = "loading" | "ready" | "error";

/** Loads every image from the avatar folder (and reloads when the folder changes). */
export function useAvatarAssets(dir: string) {
  const [assets, setAssets] = useState<AvatarAssets | null>(null);
  const [status, setStatus] = useState<AvatarStatus>("loading");
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!inTauri) {
      setStatus("error");
      setError("The avatar loads inside the Mana window. Run it with: npm run tauri dev");
      return;
    }
    if (!dir.trim()) {
      setStatus("error");
      setError("Choose your avatar folder in Settings.");
      return;
    }
    let cancelled = false;
    let loaded: AvatarAssets | null = null;
    setStatus("loading");
    loadAvatarAssets(dir)
      .then((a) => {
        if (cancelled) {
          revokeAssets(a);
          return;
        }
        loaded = a;
        setAssets(a);
        setError("");
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setAssets(null);
        setError(String(e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
      if (loaded) revokeAssets(loaded);
    };
  }, [dir, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { assets, status, error, reload };
}
