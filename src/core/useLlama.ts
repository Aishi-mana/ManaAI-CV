import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./env";
import type { Settings } from "./settings";
import { checkHealth } from "./llm";

export { inTauri };

export type LlamaStatus = "stopped" | "starting" | "ready" | "error";

/**
 * Starts/stops llama-server through the Rust side and tracks when it is ready.
 * The chat model is required; the small embedding model (for memory search) is optional
 * and starts alongside it when a path is set in Settings.
 */
export function useLlama(settings: Settings) {
  const [status, setStatus] = useState<LlamaStatus>("stopped");
  const [detail, setDetail] = useState("");
  const [embedReady, setEmbedReady] = useState(false);
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
        const running = await invoke<boolean>("llama_running", { instance: "chat" });
        if (!running) {
          stopPolling();
          const log = await invoke<string>("llama_log_tail", { instance: "chat" });
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
          instance: "chat",
          exePath: s.exePath,
          modelPath: s.modelPath,
          port: s.port,
          ctxSize: s.ctxSize,
          gpuLayers: s.gpuLayers,
          extraArgs: ["--jinja"],
        });
      } catch (e) {
        setStatus("error");
        setDetail(String(e));
        return;
      }
      // Optional: the small embedding model, on the CPU. If it fails, memory just uses keyword search.
      if (s.memoryEnabled && s.embedPath) {
        try {
          await invoke("start_llama", {
            instance: "embed",
            exePath: s.exePath,
            modelPath: s.embedPath,
            port: s.embedPort,
            ctxSize: 2048,
            gpuLayers: 0,
            extraArgs: ["--embeddings"],
          });
        } catch {
          /* optional */
        }
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
      for (const instance of ["chat", "embed"]) {
        try {
          await invoke("stop_llama", { instance });
        } catch {
          /* ignore */
        }
      }
    }
    setStatus("stopped");
    setDetail("");
    setEmbedReady(false);
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

  // Is the embedding server up? (checked every few seconds while it should be running)
  useEffect(() => {
    if (!settings.memoryEnabled || !settings.embedPath || status === "stopped") {
      setEmbedReady(false);
      return;
    }
    let alive = true;
    const check = async () => {
      const ok = (await checkHealth(settingsRef.current.embedPort)) === "ok";
      if (alive) setEmbedReady(ok);
    };
    check();
    const t = window.setInterval(check, 4000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [settings.memoryEnabled, settings.embedPath, settings.embedPort, status]);

  return { status, detail, start, stop, embedReady };
}
