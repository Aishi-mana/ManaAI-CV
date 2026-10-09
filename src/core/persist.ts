import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./env";

/**
 * Everything Mana saves lives as small JSON files in one data folder
 * (settings.json, chat.json, stats.json, avatar.json, memory.json).
 * Copy the folder to back her up. Each save keeps the previous version as .json.bak.
 *
 * The app loads all files once at start into a cache, so the rest of the code can read
 * synchronously; writes are batched (400 ms) and saved in the background.
 * In a plain browser tab (no Tauri) it falls back to browser storage.
 */

export const DEFAULT_DATA_DIR = "C:\\AI\\ManaAI-CV\\data";
const DIR_KEY = "mana.dataDir";
const NAMES = ["settings", "chat", "stats", "avatar", "memory", "persona", "diary", "initiative"] as const;
export type DataName = (typeof NAMES)[number];

/** Where each file lived before the data folder existed (browser storage), for one-time migration. */
const LEGACY: Record<DataName, string> = {
  settings: "mana.settings.v1",
  chat: "mana.chat.v1",
  stats: "mana.stats.v1",
  avatar: "mana.avatar.v1",
  memory: "mana.data.memory",
  persona: "mana.data.persona",
  diary: "mana.data.diary",
  initiative: "mana.data.initiative",
};

const cache = new Map<DataName, unknown>();
const timers = new Map<DataName, number>();
let dir = DEFAULT_DATA_DIR;
let useDisk = false;
let errorHandler: ((msg: string) => void) | null = null;
let hooked = false;

export function getDataDir(): string {
  try {
    return localStorage.getItem(DIR_KEY) || DEFAULT_DATA_DIR;
  } catch {
    return DEFAULT_DATA_DIR;
  }
}

export function setDataDir(d: string) {
  try {
    localStorage.setItem(DIR_KEY, d.trim() || DEFAULT_DATA_DIR);
  } catch {
    /* ignore */
  }
}

export function onPersistError(fn: (msg: string) => void) {
  errorHandler = fn;
}

function readLocal(name: DataName): unknown {
  try {
    const raw = localStorage.getItem(LEGACY[name]);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeLocal(name: DataName, value: unknown) {
  try {
    localStorage.setItem(LEGACY[name], JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export interface BootResult {
  ok: boolean;
  error?: string;
  dir: string;
  migrated: DataName[];
  notes: string[];
}

export async function bootData(): Promise<BootResult> {
  dir = getDataDir();
  const migrated: DataName[] = [];
  const notes: string[] = [];
  let error: string | undefined;
  useDisk = inTauri;

  for (const name of NAMES) {
    let value: unknown;
    if (useDisk) {
      try {
        const txt = await invoke<string | null>("data_read", { dir, name: `${name}.json` });
        if (txt != null) {
          try {
            value = JSON.parse(txt);
          } catch {
            notes.push(`${name}.json was damaged, so I tried its backup.`);
            const bak = await invoke<string | null>("data_read", { dir, name: `${name}.json.bak` });
            if (bak != null) {
              try {
                value = JSON.parse(bak);
              } catch {
                notes.push(`The backup of ${name}.json was damaged too.`);
              }
            }
          }
        }
      } catch (e) {
        error = String(e);
        useDisk = false; // fall back to browser storage for everything
      }
    }
    if (value === undefined) {
      const legacy = readLocal(name);
      if (legacy !== undefined) {
        value = legacy;
        migrated.push(name);
      }
    }
    if (value !== undefined) cache.set(name, value);
  }

  if (useDisk) for (const name of migrated) scheduleWrite(name);

  if (!hooked && typeof window !== "undefined") {
    hooked = true;
    window.addEventListener("beforeunload", flushData);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushData();
    });
  }
  return { ok: !error, error, dir, migrated, notes };
}

export function getData<T>(name: DataName): T | undefined {
  return cache.get(name) as T | undefined;
}

export function setData(name: DataName, value: unknown) {
  cache.set(name, value);
  if (useDisk) scheduleWrite(name);
  else writeLocal(name, value);
}

function scheduleWrite(name: DataName) {
  const t = timers.get(name);
  if (t !== undefined) window.clearTimeout(t);
  timers.set(name, window.setTimeout(() => void writeNow(name), 400));
}

async function writeNow(name: DataName) {
  timers.delete(name);
  try {
    await invoke("data_write", { dir, name: `${name}.json`, content: JSON.stringify(cache.get(name)) });
  } catch (e) {
    errorHandler?.(`Couldn't save ${name}: ${e}`);
  }
}

/** Save everything that is waiting right now (called when the window hides or closes). */
export function flushData() {
  for (const name of Array.from(timers.keys())) {
    const t = timers.get(name);
    if (t !== undefined) window.clearTimeout(t);
    void writeNow(name);
  }
}
