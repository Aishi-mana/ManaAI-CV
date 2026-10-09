export type MemoryKind = "event" | "fact" | "note";

export interface Memory {
  id: string;
  /** Uses {{user}} / {{char}} instead of real names, so renaming never leaves stale memories. */
  text: string;
  kind: MemoryKind;
  emotion: string;
  /** 1-10: how big a deal it was */
  importance: number;
  created: number;
  /** last time it was recalled or reinforced (the fading clock restarts here) */
  lastRecalled: number;
  recallCount: number;
  /** in days: how slowly it fades. Grows every time it is recalled. */
  stability: number;
  /** pinned memories never fade and are always in her prompt */
  pinned: boolean;
  /** ids of the chat messages it came from */
  source?: string[];
  /** embedding (normalized float32, base64) and the model that made it */
  vec?: string;
  vecModel?: string;
  /** typed in by hand */
  manual?: boolean;
  /** pinned by her sleep cycle (not by you) */
  autoPinned?: boolean;
  /** you unpinned it, so the sleep cycle must not pin it again */
  noAutoPin?: boolean;
}

export interface MemoryFile {
  version: 1;
  memories: Memory[];
  /** id of the last chat message that has already been turned into memories */
  extractedUpTo: string | null;
}

export const EMPTY_MEMORY_FILE: MemoryFile = { version: 1, memories: [], extractedUpTo: null };

export interface Recalled {
  memory: Memory;
  /** how well it matches what was just said, 0-1 */
  rel: number;
  score: number;
  /** faded: she only half remembers it */
  vague: boolean;
  /** how strong it is right now, 0-1 */
  retrievability: number;
}
