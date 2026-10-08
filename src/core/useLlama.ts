import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./settings";
import { checkHealth } from "./llm";

export type LlamaStatus = "stopped" | "starting" | "ready" | "error";

/** True when running inside the Tauri window (false in a plain browser tab). */
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Starts/stops llama-server through the Rust side and tracks when it is ready. */
export function useLlama(settings: Settings) {
  const [status, setStatus] = useState<LlamaStatus>("stopped");
  const [detail, setDetail] = useState("");
  const timer = useRef<number | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const stopPolling = () => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };

  const waitUntilReady = useCallback(() => {
    stopPolling();
    const startedAt = Date.now();
    timer.current = window.setInterval(async () => {
      const s = settingsRef.current;
      if ((await checkHealth(s.port)) === "ok") {
        stopPolling();
        setStatus("ready");
        setDetail("");
        return;
      }
      if (inTauri) {
        const running = await invoke<boolean>("llama_running");
        if (!running) {
          stopPolling();
          const log = await invoke<string>("llama_log_tail");
          setStatus("error");
          setDetail("llama-server stopped. Last lines of its log:\n\n" + log);
          return;
        }
      }
      if (Date.now() - startedAt > 180_000) {
        stopPolling();
        setStatus("error");
        setDetail("Timed out waiting for the model to load (3 minutes).");
      }
    }, 1000);
  }, []);

  const start = useCallback(async () => {
    const s = settingsRef.current;
    if (inTauri) {
      if (!s.exePath || !s.modelPath) {
        setStatus("error");
        setDetail("Open Settings and choose the llama-server file and a model first.");
        return;
      }
      setStatus("starting");
      setDetail("Loading the model onto your GPU...");
      try {
        await invoke("start_llama", {
          exePath: s.exePath,
          modelPath: s.modelPath,
          port: s.port,
          ctxSize: s.ctxSize,
          gpuLayers: s.gpuLayers,
        });
      } catch (e) {
        setStatus("error");
        setDetail(String(e));
        return;
      }
    } else {
      setStatus("starting");
      setDetail(`Browser mode: waiting for a llama-server already running on port ${s.port}...`);
    }
    waitUntilReady();
  }, [waitUntilReady]);

  const stop = useCallback(async () => {
    stopPolling();
    if (inTauri) {
      try {
        await invoke("stop_llama");
      } catch {
        /* ignore */
      }
    }
    setStatus("stopped");
    setDetail("");
  }, []);

  // On launch: adopt a server that is already up, or auto-start if enabled.
  useEffect(() => {
    (async () => {
      const s = settingsRef.current;
      if ((await checkHealth(s.port)) === "ok") {
        setStatus("ready");
        return;
      }
      if (s.autoStart && inTauri && s.exePath && s.modelPath) start();
    })();
    return () => stopPolling();
  }, [start]);

  return { status, detail, start, stop };
}
