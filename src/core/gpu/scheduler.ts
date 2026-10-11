/**
 * The GPU scheduler: decides which big GPU programs ("residents": the chat model, later voice and
 * drawing) are loaded at any moment, so they never fight over VRAM.
 *
 * - Anything that wants to use a resident asks for a lease (acquire / run). Jobs on the same resident
 *   can overlap; a resident is never unloaded while someone holds a lease.
 * - If a resident isn't loaded, the scheduler loads it, first unloading others if they don't fit
 *   (lowest priority, then least recently used, first). Unloading waits for running work to finish.
 * - Once the GPU is idle, anything that was pushed out and is marked `restore` (the chat model) is brought back.
 * - A request that arrives later can't starve one that arrived earlier and is waiting to evict the same resident.
 */

export type ResidentState = "unloaded" | "loading" | "loaded" | "unloading" | "error";

export interface ResidentDef {
  id: string;
  name: string;
  /** estimated VRAM when loaded (MB); can be corrected later with setEstimate */
  vramMB: number;
  /** higher = more important to keep loaded; eviction takes the lowest first */
  priority: number;
  /** bring it back after something else pushed it out */
  restore: boolean;
  /** stay loaded this many seconds after its last use, then unload (0 = until pushed out) */
  keepWarmSec: number;
  /** false when the user switched it off on purpose (then it is never restored or auto-loaded) */
  isWanted?: () => boolean;
  load(): Promise<void>;
  unload(): Promise<void>;
}

interface Resident {
  def: ResidentDef;
  state: ResidentState;
  leases: number;
  lastUsed: number;
  evicted: boolean;
  /** a load/unload started by the scheduler is in progress */
  op: boolean;
  error?: string;
  cancelWarm?: () => void;
}

export interface Lease {
  release: () => void;
}

type Kind = "lease" | "restore" | "unload";

interface Request {
  seq: number;
  id: string;
  kind: Kind;
  label: string;
  priority: number;
  resolve: (l: Lease) => void;
  reject: (e: Error) => void;
}

export interface Budget {
  totalMB: number;
  /** live free VRAM from nvidia-smi, if known */
  freeMB?: number;
}

export interface SchedulerEvent {
  type: "loaded" | "unloaded";
  id: string;
  ms: number;
  /** it was pushed out to make room for something else */
  evicted: boolean;
}

export interface SchedulerOptions {
  budget: () => Budget;
  /** MB to always keep free (Windows, browser, ...) */
  reserveMB: () => number;
  restoreEnabled?: () => boolean;
  now?: () => number;
  /** returns a cancel function */
  setTimer?: (fn: () => void, ms: number) => () => void;
  onChange?: () => void;
  onEvent?: (e: SchedulerEvent) => void;
}

export interface Snapshot {
  totalMB: number;
  usableMB: number;
  loadedMB: number;
  residents: { id: string; name: string; state: ResidentState; vramMB: number; priority: number; leases: number; evicted: boolean; error?: string }[];
  queue: { label: string; id: string; kind: Kind }[];
  log: { at: number; text: string }[];
}

type Plan =
  | { ok: true; evict: string[]; waitFor: string[]; willEvict: string[] }
  | { ok: false; reason: string };

const NOOP_LEASE: Lease = { release: () => {} };

export class Scheduler {
  private residents = new Map<string, Resident>();
  private queue: Request[] = [];
  private seq = 0;
  private pumping = false;
  private again = false;
  private logLines: { at: number; text: string }[] = [];

  constructor(private opts: SchedulerOptions) {}

  private now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }
  private changed() {
    this.opts.onChange?.();
  }
  private log(text: string) {
    this.logLines = [...this.logLines, { at: this.now(), text }].slice(-30);
  }

  // ------------------------------------------------------------------ setup

  register(def: ResidentDef, initial: ResidentState = "unloaded") {
    this.residents.set(def.id, { def, state: initial, leases: 0, lastUsed: this.now(), evicted: false, op: false });
    this.changed();
  }

  unregister(id: string) {
    this.residents.get(id)?.cancelWarm?.();
    this.residents.delete(id);
    this.queue = this.queue.filter((q) => q.id !== id);
    this.changed();
  }

  setEstimate(id: string, mb: number) {
    const r = this.residents.get(id);
    if (r && mb > 0) {
      r.def.vramMB = Math.round(mb);
      this.changed();
    }
  }

  /** Tell the scheduler about a change it didn't cause (the user pressed Start/Stop, a server was already running). */
  sync(id: string, state: ResidentState) {
    const r = this.residents.get(id);
    if (!r || r.op || r.state === state) return;
    r.state = state;
    if (state === "loaded") r.evicted = false;
    if (state === "unloaded" && r.def.isWanted && !r.def.isWanted()) r.evicted = false;
    this.changed();
    void this.pump();
  }

  // ------------------------------------------------------------------ using the GPU

  /** Waits until the resident is loaded and returns a lease. Release it when you are done. */
  acquire(id: string, opts: { label?: string; priority?: number; signal?: AbortSignal } = {}): Promise<Lease> {
    const r = this.residents.get(id);
    if (!r) return Promise.reject(new Error(`Unknown GPU resident: ${id}`));
    return new Promise<Lease>((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new Error("Cancelled"));
      const req: Request = {
        seq: ++this.seq,
        id,
        kind: "lease",
        label: opts.label ?? r.def.name,
        priority: opts.priority ?? r.def.priority,
        resolve,
        reject,
      };
      opts.signal?.addEventListener(
        "abort",
        () => {
          const i = this.queue.indexOf(req);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(new Error("Cancelled"));
            this.changed();
          }
        },
        { once: true },
      );
      this.queue.push(req);
      this.changed();
      void this.pump();
    });
  }

  async run<T>(id: string, fn: () => Promise<T>, opts: { label?: string; priority?: number; signal?: AbortSignal } = {}): Promise<T> {
    const lease = await this.acquire(id, opts);
    try {
      return await fn();
    } finally {
      lease.release();
    }
  }

  snapshot(): Snapshot {
    const { totalMB } = this.opts.budget();
    const all = [...this.residents.values()];
    return {
      totalMB,
      usableMB: totalMB - this.opts.reserveMB(),
      loadedMB: all.filter((r) => r.state === "loaded" || r.state === "loading").reduce((a, r) => a + r.def.vramMB, 0),
      residents: all.map((r) => ({
        id: r.def.id,
        name: r.def.name,
        state: r.state,
        vramMB: r.def.vramMB,
        priority: r.def.priority,
        leases: r.leases,
        evicted: r.evicted,
        error: r.error,
      })),
      queue: this.queue.map((q) => ({ label: q.label, id: q.id, kind: q.kind })),
      log: this.logLines,
    };
  }

  // ------------------------------------------------------------------ internals

  private grant(req: Request, r: Resident) {
    if (req.kind !== "lease") {
      r.evicted = false;
      req.resolve(NOOP_LEASE);
      return;
    }
    r.leases++;
    r.lastUsed = this.now();
    r.cancelWarm?.();
    r.cancelWarm = undefined;
    let released = false;
    req.resolve({
      release: () => {
        if (released) return;
        released = true;
        r.leases = Math.max(0, r.leases - 1);
        r.lastUsed = this.now();
        this.afterRelease(r);
      },
    });
  }

  private afterRelease(r: Resident) {
    if (r.leases === 0 && r.state === "loaded" && r.def.keepWarmSec > 0 && this.opts.setTimer) {
      r.cancelWarm?.();
      r.cancelWarm = this.opts.setTimer(() => {
        r.cancelWarm = undefined;
        if (r.leases === 0 && r.state === "loaded") {
          this.queue.push({ seq: ++this.seq, id: r.def.id, kind: "unload", label: `unload ${r.def.name}`, priority: -1, resolve: () => {}, reject: () => {} });
          void this.pump();
        }
      }, r.def.keepWarmSec * 1000);
    }
    this.changed();
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.again = false;
        while (await this.step()) {
          /* keep going while something changed */
        }
        const before = this.queue.length;
        this.maybeRestore();
        if (this.queue.length > before) this.again = true;
      } while (this.again);
    } finally {
      this.pumping = false;
      this.changed();
    }
  }

  /** Brings back things that were pushed out, but only once the GPU is idle (so batches of jobs run together). */
  private maybeRestore() {
    if (this.opts.restoreEnabled && !this.opts.restoreEnabled()) return;
    const busy = [...this.residents.values()].some((r) => r.leases > 0);
    for (const r of this.residents.values()) {
      if (!r.def.restore || !r.evicted || r.state !== "unloaded") continue;
      if (r.def.isWanted && !r.def.isWanted()) {
        r.evicted = false;
        continue;
      }
      if (busy || this.queue.some((q) => q.kind === "lease" && q.id !== r.def.id)) continue;
      if (this.queue.some((q) => q.id === r.def.id && q.kind === "restore")) continue;
      this.queue.push({ seq: ++this.seq, id: r.def.id, kind: "restore", label: `bring back ${r.def.name}`, priority: r.def.priority, resolve: () => {}, reject: () => {} });
    }
  }

  private drop(req: Request) {
    const i = this.queue.indexOf(req);
    if (i >= 0) this.queue.splice(i, 1);
  }

  private plan(id: string): Plan {
    const target = this.residents.get(id) as Resident;
    const need = target.def.vramMB;
    const { totalMB, freeMB } = this.opts.budget();
    const reserve = this.opts.reserveMB();
    const usable = totalMB - reserve;
    if (need > usable) {
      return { ok: false, reason: `${target.def.name} needs about ${need} MB, but only ${usable} MB of your ${totalMB} MB is usable (${reserve} MB is kept free).` };
    }

    const holding = [...this.residents.values()].filter(
      (r) => r !== target && (r.state === "loaded" || r.state === "loading" || r.state === "unloading"),
    );
    let free = usable - holding.reduce((a, r) => a + r.def.vramMB, 0);
    if (freeMB !== undefined) free = Math.min(free, freeMB - reserve);
    if (free >= need) return { ok: true, evict: [], waitFor: [], willEvict: [] };

    const candidates = holding
      .filter((r) => r.state === "loaded")
      .sort((a, b) => a.def.priority - b.def.priority || a.lastUsed - b.lastUsed);
    const chosen: Resident[] = [];
    let freed = 0;
    for (const c of candidates) {
      chosen.push(c);
      freed += c.def.vramMB;
      if (free + freed >= need) break;
    }
    if (free + freed < need) {
      const transient = holding.filter((r) => r.state !== "loaded");
      if (transient.length) return { ok: true, evict: [], waitFor: transient.map((t) => t.def.id), willEvict: [] };
      return { ok: false, reason: `There isn't enough free GPU memory for ${target.def.name} (about ${need} MB needed, ${Math.max(0, Math.round(free + freed))} MB available). Another program may be using the GPU.` };
    }
    return {
      ok: true,
      evict: chosen.filter((c) => c.leases === 0).map((c) => c.def.id),
      waitFor: chosen.filter((c) => c.leases > 0).map((c) => c.def.id),
      willEvict: chosen.map((c) => c.def.id),
    };
  }

  private async unloadResident(id: string, byEviction: boolean) {
    const r = this.residents.get(id);
    if (!r || r.state !== "loaded") return;
    r.cancelWarm?.();
    r.cancelWarm = undefined;
    r.state = "unloading";
    r.op = true;
    this.changed();
    const t0 = this.now();
    try {
      await r.def.unload();
      r.state = "unloaded";
      r.error = undefined;
    } catch (e) {
      r.state = "error";
      r.error = e instanceof Error ? e.message : String(e);
    }
    r.op = false;
    if (byEviction) r.evicted = true;
    const ms = this.now() - t0;
    this.log(`${byEviction ? "Made room: unloaded" : "Unloaded"} ${r.def.name} (${(ms / 1000).toFixed(1)} s)`);
    this.opts.onEvent?.({ type: "unloaded", id, ms, evicted: byEviction });
    this.changed();
  }

  private async loadResident(id: string) {
    const r = this.residents.get(id) as Resident;
    r.state = "loading";
    r.op = true;
    this.changed();
    const t0 = this.now();
    try {
      await r.def.load();
      r.state = "loaded";
      r.error = undefined;
      r.evicted = false;
      r.lastUsed = this.now();
    } catch (e) {
      r.state = "error";
      r.error = e instanceof Error ? e.message : String(e);
      r.op = false;
      this.log(`Could not load ${r.def.name}: ${r.error}`);
      this.changed();
      throw e;
    }
    r.op = false;
    const ms = this.now() - t0;
    this.log(`Loaded ${r.def.name} (${(ms / 1000).toFixed(1)} s)`);
    this.opts.onEvent?.({ type: "loaded", id, ms, evicted: false });
    this.changed();
  }

  /** Handles at most one queued request. Returns true if something changed (so the queue is scanned again). */
  private async step(): Promise<boolean> {
    const sorted = [...this.queue].sort((a, b) => b.priority - a.priority || a.seq - b.seq);

    // Pass 1: who is waiting to push out whom? (so later requests can't keep a resident busy forever)
    const evicting = new Map<string, number>();
    for (const req of sorted) {
      const r = this.residents.get(req.id);
      if (!r || req.kind === "unload" || r.state === "loaded" || r.state === "loading" || r.state === "unloading") continue;
      if (req.kind === "lease" && r.def.isWanted && !r.def.isWanted()) continue;
      const p = this.plan(req.id);
      // anyone who intends to push a resident out (now or once it is idle) gets precedence over later users of it
      if (p.ok && p.willEvict.length) {
        for (const w of p.willEvict) evicting.set(w, Math.min(evicting.get(w) ?? Infinity, req.seq));
      }
    }

    // Pass 2: act on the first request that can move
    for (const req of sorted) {
      const r = this.residents.get(req.id);
      if (!r) {
        this.drop(req);
        req.reject(new Error(`Unknown GPU resident: ${req.id}`));
        return true;
      }
      const blocker = evicting.get(req.id);
      if (blocker !== undefined && blocker < req.seq) continue;

      if (req.kind === "unload") {
        this.drop(req);
        if (r.state === "loaded" && r.leases === 0) await this.unloadResident(req.id, false);
        return true;
      }
      if (r.state === "loaded") {
        this.drop(req);
        this.grant(req, r);
        return true;
      }
      if (r.state === "loading" || r.state === "unloading") continue;

      // unloaded (or failed earlier): it has to be loaded
      if (req.kind === "lease" && r.def.isWanted && !r.def.isWanted()) {
        this.drop(req);
        req.reject(new Error(`${r.def.name} is switched off.`));
        return true;
      }
      const p = this.plan(req.id);
      if (!p.ok) {
        this.drop(req);
        r.evicted = false;
        this.log(p.reason);
        req.reject(new Error(p.reason));
        return true;
      }
      if (p.waitFor.length) continue;

      for (const id of p.evict) await this.unloadResident(id, true);
      try {
        await this.loadResident(req.id);
      } catch (e) {
        this.drop(req);
        r.evicted = false;
        req.reject(e instanceof Error ? e : new Error(String(e)));
        return true;
      }
      this.drop(req);
      this.grant(req, r);
      return true;
    }
    return false;
  }
}

/**
 * Wraps a request to the chat model so the scheduler knows it is in use.
 * It fails open: if the scheduler can't help (model switched off, no room...), the request just runs
 * as it would without a scheduler, so chat never breaks because of it.
 */
export function createChatGate(s: Scheduler, id = "chat") {
  return async function gate<T>(fn: () => Promise<T>): Promise<T> {
    let lease: Lease;
    try {
      lease = await s.acquire(id, { label: "chat" });
    } catch {
      return fn();
    }
    try {
      return await fn();
    } finally {
      lease.release();
    }
  };
}
