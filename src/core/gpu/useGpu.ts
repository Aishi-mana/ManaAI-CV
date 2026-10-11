import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../env";
import { setChatGate } from "../llm";
import { getData, setData } from "../persist";
import type { Settings } from "../settings";
import type { LlamaStatus } from "../useLlama";
import { believableMeasurement, estimateChatMB, parseOffloaded, planAdvice } from "./plan";
import { Scheduler, createChatGate } from "./scheduler";
import type { Snapshot } from "./scheduler";

export interface GpuInfo {
  name: string;
  totalMb: number;
  usedMb: number;
  freeMb: number;
}

/** What the scheduler needs from the model launcher. */
export interface LlamaControl {
  status: LlamaStatus;
  park: () => Promise<void>;
  unpark: () => Promise<boolean>;
}

interface GpuFile {
  version: 1;
  /** measured VRAM of the chat model, per "model|context|gpu layers" */
  measured: Record<string, number>;
  /** how many layers the model has / how many went to the GPU */
  layers: Record<string, { offloaded: number; total: number }>;
  /** results of the swap test */
  swaps: { at: number; parkSec: number; reloadSec: number }[];
}

function normalizeGpuFile(raw: unknown): GpuFile {
  const r = (raw ?? {}) as Partial<GpuFile>;
  return {
    version: 1,
    measured: r.measured && typeof r.measured === "object" ? r.measured : {},
    layers: r.layers && typeof r.layers === "object" ? r.layers : {},
    swaps: Array.isArray(r.swaps) ? r.swaps.slice(-5) : [],
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const signature = (s: Settings) => `${baseName(s.modelPath)}|${s.ctxSize}|${s.gpuLayers}`;

/** Runs the GPU scheduler for the app: watches VRAM, keeps the chat model's footprint up to date, and exposes the controls. */
export function useGpu(llama: LlamaControl, settings: Settings) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [info, setInfo] = useState<GpuInfo | null>(null);
  const [infoError, setInfoError] = useState("");
  const [file, setFile] = useState<GpuFile>(() => normalizeGpuFile(getData("gpu")));
  const [modelMB, setModelMB] = useState<number | null>(null);
  const [swap, setSwap] = useState({ running: false, message: "" });

  const llamaRef = useRef(llama);
  const settingsRef = useRef(settings);
  const infoRef = useRef<GpuInfo | null>(null);
  const fileRef = useRef(file);
  const mountedRef = useRef(false);
  const timingsRef = useRef<{ park?: number; reload?: number }>({});
  const schedRef = useRef<Scheduler | null>(null);
  llamaRef.current = llama;
  settingsRef.current = settings;

  if (!schedRef.current) {
    const sched = new Scheduler({
      budget: () => ({ totalMB: infoRef.current?.totalMb ?? 8192, freeMB: infoRef.current?.freeMb }),
      reserveMB: () => settingsRef.current.gpuReserveMB,
      restoreEnabled: () => settingsRef.current.gpuAutoRestore,
      onChange: () => {
        if (mountedRef.current) queueMicrotask(() => setSnap(sched.snapshot()));
      },
      onEvent: (e) => {
        if (e.id !== "chat") return;
        if (e.type === "unloaded") timingsRef.current.park = e.ms / 1000;
        else timingsRef.current.reload = e.ms / 1000;
      },
    });
    sched.register(
      {
        id: "chat",
        name: "Mana's brain (chat model)",
        vramMB: 6400,
        priority: 100,
        restore: true,
        keepWarmSec: 0,
        isWanted: () => ["ready", "starting", "parked"].includes(llamaRef.current.status),
        load: async () => {
          if (!(await llamaRef.current.unpark())) throw new Error("The chat model did not come back.");
        },
        unload: async () => {
          await llamaRef.current.park();
        },
      },
      llama.status === "ready" ? "loaded" : llama.status === "starting" ? "loading" : "unloaded",
    );
    schedRef.current = sched;
  }
  const sched = schedRef.current;

  const commitFile = useCallback((next: GpuFile) => {
    fileRef.current = next;
    setFile(next);
    setData("gpu", next);
  }, []);

  // start: show the first snapshot, route every chat request through the scheduler
  useEffect(() => {
    mountedRef.current = true;
    setSnap(sched.snapshot());
    setChatGate(createChatGate(sched));
    return () => {
      mountedRef.current = false;
      setChatGate(null);
    };
  }, [sched]);

  // keep the scheduler's idea of the chat model in step with what the user does (Start / Stop)
  useEffect(() => {
    if (llama.status === "ready") sched.sync("chat", "loaded");
    else if (llama.status === "starting") sched.sync("chat", "loading");
    else if (llama.status === "stopped" || llama.status === "error") sched.sync("chat", "unloaded");
    // "parked" is the scheduler's own doing
  }, [llama.status, sched]);

  // live VRAM readout
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const i = await invoke<GpuInfo>("gpu_info");
        if (!alive) return;
        infoRef.current = i;
        setInfo(i);
        setInfoError("");
      } catch (e) {
        if (!alive) return;
        infoRef.current = null;
        setInfo(null);
        setInfoError(String(e));
      }
    };
    void poll();
    const t = window.setInterval(poll, 4000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // estimate for the chat model: measured on this machine if known, otherwise file size + context
  useEffect(() => {
    if (!inTauri || !settings.modelPath) return;
    let alive = true;
    invoke<number>("file_size_mb", { path: settings.modelPath })
      .then((mb) => {
        if (!alive) return;
        setModelMB(mb);
        sched.setEstimate("chat", fileRef.current.measured[signature(settings)] ?? estimateChatMB(mb, settings.ctxSize));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings.modelPath, settings.ctxSize, settings.gpuLayers, sched, settings]);

  // after the model finished loading: measure how much VRAM it really took, and how many layers went to the GPU
  const beforeRef = useRef<number | null>(null);
  const prevStatus = useRef(llama.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = llama.status;
    if (llama.status === "starting" && prev !== "starting") beforeRef.current = infoRef.current?.usedMb ?? null;
    if (llama.status !== "ready" || prev !== "starting" || !inTauri) return;
    let alive = true;
    (async () => {
      await sleep(2500);
      if (!alive) return;
      const s = settingsRef.current;
      const sig = signature(s);
      const est = sched.snapshot().residents.find((r) => r.id === "chat")?.vramMB ?? 6400;
      let next = fileRef.current;
      let changed = false;
      try {
        const after = await invoke<GpuInfo>("gpu_info");
        infoRef.current = after;
        setInfo(after);
        const before = beforeRef.current;
        if (before !== null) {
          const delta = after.usedMb - before;
          if (believableMeasurement(delta, est)) {
            next = { ...next, measured: { ...next.measured, [sig]: delta } };
            sched.setEstimate("chat", delta);
            changed = true;
          }
        }
      } catch {
        /* no nvidia-smi: keep the estimate */
      }
      try {
        const log = await invoke<string>("llama_log_tail", { instance: "chat", maxBytes: 200_000 });
        const off = parseOffloaded(log);
        if (off) {
          next = { ...next, layers: { ...next.layers, [sig]: off } };
          changed = true;
        }
      } catch {
        /* ignore */
      }
      if (changed && alive) commitFile(next);
    })();
    return () => {
      alive = false;
    };
  }, [llama.status, sched, commitFile]);

  /**
   * Measures what a swap costs on this PC: parks the chat model as if something big needed the GPU,
   * waits a few seconds, and brings it back. (Nothing is actually drawn; it only measures.)
   */
  const swapTest = useCallback(async () => {
    if (swap.running) return;
    if (llamaRef.current.status !== "ready") {
      setSwap({ running: false, message: "Start the model first." });
      return;
    }
    const usable = sched.snapshot().usableMB;
    sched.register({
      id: "swaptest",
      name: "Swap test (pretend job)",
      vramMB: Math.max(2500, usable - 800),
      priority: 50,
      restore: false,
      keepWarmSec: 0,
      load: async () => {
        await sleep(300);
      },
      unload: async () => {},
    });
    timingsRef.current = {};
    setSwap({ running: true, message: "Parking the chat model..." });
    try {
      await sched.run("swaptest", async () => {
        setSwap({ running: true, message: "The chat model is parked. Pretending to draw for 4 seconds..." });
        await sleep(4000);
      });
      setSwap({ running: true, message: "Bringing the chat model back..." });
      const t0 = Date.now();
      while (Date.now() - t0 < 240_000) {
        if (sched.snapshot().residents.find((r) => r.id === "chat")?.state === "loaded") break;
        await sleep(300);
      }
      const t = timingsRef.current;
      if (t.park !== undefined && t.reload !== undefined) {
        commitFile({
          ...fileRef.current,
          swaps: [...fileRef.current.swaps, { at: Date.now(), parkSec: t.park, reloadSec: t.reload }].slice(-5),
        });
        setSwap({
          running: false,
          message: `Parking took ${t.park.toFixed(1)} s and bringing her back took ${t.reload.toFixed(1)} s, so she is away about ${(t.park + t.reload).toFixed(0)} s per swap.`,
        });
      } else {
        setSwap({ running: false, message: "The test did not finish cleanly. Check that the model is running and try again." });
      }
    } catch (e) {
      setSwap({ running: false, message: `The swap test failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      sched.unregister("swaptest");
    }
  }, [sched, swap.running, commitFile]);

  // plain-language "what fits together"
  const advice = useMemo(() => {
    const chatMB = snap?.residents.find((r) => r.id === "chat")?.vramMB ?? 6400;
    const usableMB = snap?.usableMB ?? 7000;
    const last = file.swaps[file.swaps.length - 1];
    return planAdvice({
      chatMB,
      usableMB,
      modelMB,
      chatLayers: file.layers[signature(settings)]?.total ?? null,
      swapSec: last ? last.parkSec + last.reloadSec : null,
    });
  }, [snap, file, modelMB, settings]);

  /** A short note for the top bar when the GPU is changing hands. */
  const busyText = useMemo(() => {
    if (!snap) return "";
    const moving = snap.residents.find((r) => r.state === "loading" || r.state === "unloading");
    if (moving) return `${moving.state === "unloading" ? "Parking" : "Loading"} ${moving.name}...`;
    return snap.queue.length ? "Waiting for the GPU..." : "";
  }, [snap]);

  return { snapshot: snap, info, infoError, advice, swap, swapTest, busyText, swaps: file.swaps, scheduler: sched };
}

export type GpuApi = ReturnType<typeof useGpu>;
