/** Rough VRAM numbers and plain-language advice about what fits on the GPU together. */

export interface Planned {
  id: string;
  name: string;
  mb: number;
  /** must be loaded together with the chat model (swapping it in and out per use would be far too slow) */
  continuous: boolean;
}

/** Features that are coming. The sizes are typical values; real numbers are measured when they exist. */
export const PLANNED: Planned[] = [
  { id: "vision", name: "Reading pictures (vision add-on)", mb: 1100, continuous: true },
  { id: "voice", name: "Voice (GPT-SoVITS)", mb: 3000, continuous: true },
  { id: "image", name: "Drawing (SDXL)", mb: 6500, continuous: false },
];

/** Model file + the memory that grows with the context + a little working space. */
export function estimateChatMB(fileMB: number, ctx: number): number {
  return Math.round(fileMB + ctx * 0.15 + 400);
}

/** llama-server prints "offloaded 37/37 layers to GPU" when it loads. */
export function parseOffloaded(log: string): { offloaded: number; total: number } | null {
  const m = log.match(/offloaded\s+(\d+)\s*\/\s*(\d+)\s+layers\s+to\s+GPU/i);
  return m ? { offloaded: Number(m[1]), total: Number(m[2]) } : null;
}

/** Only trust a measured footprint if it is in a believable range around the estimate. */
export function believableMeasurement(measuredMB: number, estimateMB: number): boolean {
  return measuredMB > 200 && measuredMB >= estimateMB * 0.5 && measuredMB <= estimateMB * 1.8;
}

export interface Advice {
  id: string;
  name: string;
  mb: number;
  fits: boolean;
  /** spare MB if it fits, missing MB if not */
  marginMB: number;
  /** how many of the chat model's GPU layers would have to move to the CPU to make it fit (null = unknown) */
  layersToMove: number | null;
  summary: string;
}

const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;

/** What fits next to the chat model, and what to do about what doesn't. */
export function planAdvice(o: {
  chatMB: number;
  usableMB: number;
  /** the chat model file size (MB) and how many layers it has (from the load log) */
  modelMB: number | null;
  chatLayers: number | null;
  /** measured seconds for a park-and-reload, if the swap test was run */
  swapSec: number | null;
}): Advice[] {
  const free = o.usableMB - o.chatMB;
  const mbPerLayer = o.modelMB && o.chatLayers ? o.modelMB / o.chatLayers : null;
  return PLANNED.map((p) => {
    const fits = p.mb <= free;
    const margin = Math.round(Math.abs(free - p.mb));
    const layersToMove = !fits && mbPerLayer ? Math.ceil((p.mb - free) / mbPerLayer) : null;
    let summary: string;
    if (fits) {
      summary = `Fits next to the chat model (about ${gb(margin)} to spare).`;
    } else if (p.mb > o.usableMB) {
      summary = `Too big for this GPU even on its own (needs ${gb(p.mb)}, ${gb(o.usableMB)} usable).`;
    } else if (!p.continuous) {
      const swap = o.swapSec ? `about ${Math.round(o.swapSec)} s` : "some seconds";
      summary = `Doesn't fit next to the chat model (short by ${gb(margin)}). That's fine: she can park the chat model while she draws, then bring it back (${swap} for a swap). It's only used when she's drawing.`;
    } else {
      const moveText =
        layersToMove !== null && o.chatLayers && layersToMove < o.chatLayers * 0.5
          ? `lower "GPU layers" in Settings by about ${layersToMove} (the chat model gets a bit slower)`
          : `use a smaller chat model`;
      summary = `Doesn't fit next to the chat model (short by ${gb(margin)}), and it has to stay loaded while it's used, so swapping would be far too slow. Options: ${moveText}, or run it on the CPU.`;
    }
    return { id: p.id, name: p.name, mb: p.mb, fits, marginMB: margin, layersToMove, summary };
  });
}

/**
 * May a heavy GPU job (drawing, ...) start now? Never mid-reply, and not right after you were active,
 * so she doesn't disappear for a swap while you are chatting.
 */
export function heavyAllowed(o: { busy: boolean; idleMs: number; minIdleMs?: number }): { ok: boolean; reason: string } {
  if (o.busy) return { ok: false, reason: "she is in the middle of a reply" };
  if (o.idleMs < (o.minIdleMs ?? 120_000)) return { ok: false, reason: "you were active a moment ago" };
  return { ok: true, reason: "" };
}
