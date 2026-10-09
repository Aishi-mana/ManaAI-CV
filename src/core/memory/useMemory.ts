import { useCallback, useEffect, useRef, useState } from "react";
import { chatOnce } from "../llm";
import { getData, setData } from "../persist";
import { fillTemplate } from "../settings";
import type { Settings } from "../settings";
import type { Msg } from "../types";
import { consolidate as consolidateMemories } from "./maintain";
import { buildExtractionMessages, guessKind, parseExtraction, toPlaceholders } from "./extract";
import { memorySection } from "./prompt";
import { hasCue, recall } from "./recall";
import { addOrMerge, newMemory, normalizeFile } from "./store";
import { initialStability, reinforce } from "./strength";
import type { MemoryFile, Recalled } from "./types";
import { embedTexts, encodeVec, vecModelId } from "./vectors";

const REINFORCE_COOLDOWN = 6 * 3_600_000; // don't strengthen the same memory more than once per 6 hours
const EXTRACT_EVERY = 6; // write memories after this many new messages
const EXTRACT_CHUNK = 14; // messages looked at per pass

/**
 * Mana's memory: recalls things for each reply, writes new memories from the conversation,
 * and keeps everything saved in memory.json.
 */
export function useMemory(settings: Settings, llmReady: boolean, embedReady: boolean) {
  const [file, setFile] = useState<MemoryFile>(() => normalizeFile(getData("memory")));
  const [lastRecall, setLastRecall] = useState<Recalled[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const fileRef = useRef(file);
  const settingsRef = useRef(settings);
  const readyRef = useRef(llmReady);
  const extractingRef = useRef(false);
  const indexingRef = useRef(false);
  settingsRef.current = settings;
  readyRef.current = llmReady;

  const commit = useCallback((next: MemoryFile) => {
    fileRef.current = next;
    setFile(next);
    setData("memory", next);
  }, []);

  /** The memory part of her prompt for what was just said (also strengthens what comes to mind). */
  const recallFor = useCallback(
    async (userText: string, prevBot: string): Promise<string> => {
      const s = settingsRef.current;
      if (!s.memoryEnabled) {
        setLastRecall([]);
        return "";
      }
      try {
        const now = Date.now();
        const model = vecModelId(s.embedPath);
        let qv: Float32Array | null = null;
        if (s.embedPath) {
          const v = await embedTexts(s.embedPort, [fillTemplate(userText, s)], 1500);
          if (v && v[0]) qv = v[0];
        }
        const recalled = recall(fileRef.current.memories, `${userText}\n${prevBot.slice(0, 200)}`, now, {
          k: 4,
          cue: hasCue(userText),
          queryVec: qv,
          vecModel: model,
        });
        setLastRecall(recalled);

        const hit = new Map(recalled.map((r) => [r.memory.id, r]));
        if (hit.size) {
          const cur = fileRef.current;
          commit({
            ...cur,
            memories: cur.memories.map((m) => {
              const r = hit.get(m.id);
              if (!r) return m;
              return r.vague || now - m.lastRecalled > REINFORCE_COOLDOWN ? reinforce(m, now) : m;
            }),
          });
        }
        return memorySection(fileRef.current.memories.filter((m) => m.pinned), recalled, now);
      } catch {
        return "";
      }
    },
    [commit],
  );

  const pendingOf = (msgs: Msg[]) => {
    const cursor = fileRef.current.extractedUpTo;
    const idx = cursor ? msgs.findIndex((m) => m.id === cursor) : -1;
    return msgs.slice(idx + 1).filter((m) => m.content.trim() && !m.error);
  };
  const pendingCount = useCallback((msgs: Msg[]) => pendingOf(msgs).length, []);

  /** Turns the not-yet-remembered part of the chat into memories (every few messages, or when forced). */
  const maybeExtract = useCallback(
    async (msgs: Msg[], force = false): Promise<void> => {
      if (!settingsRef.current.memoryEnabled || extractingRef.current || !readyRef.current) return;
      const need = force ? 2 : EXTRACT_EVERY;
      if (pendingOf(msgs).length < need) return;

      extractingRef.current = true;
      setExtracting(true);
      try {
        for (let pass = 0; pass < 5; pass++) {
          const pending = pendingOf(msgs);
          if (pending.length < need) break;
          const chunk = pending.slice(0, EXTRACT_CHUNK);
          const s = settingsRef.current;

          const raw = await chatOnce({
            port: s.port,
            messages: buildExtractionMessages(chunk, s.userName, s.charName),
            temperature: 0.2,
            maxTokens: 350,
          });
          const cands = parseExtraction(raw, s.userName, s.charName);

          const model = vecModelId(s.embedPath);
          const vecs = s.embedPath && cands.length ? await embedTexts(s.embedPort, cands.map((c) => fillTemplate(c.text, s)), 4000) : null;

          const now = Date.now();
          let mems = fileRef.current.memories;
          cands.forEach((c, i) => {
            const v = vecs ? vecs[i] : undefined;
            const m = newMemory(
              {
                text: c.text,
                importance: c.importance,
                emotion: c.emotion,
                kind: guessKind(c.text),
                source: chunk.map((x) => x.id),
                vec: v ? encodeVec(v) : undefined,
                vecModel: v ? model : undefined,
              },
              now,
            );
            mems = addOrMerge(mems, m, now).memories;
          });
          commit({ ...fileRef.current, memories: mems, extractedUpTo: chunk[chunk.length - 1].id });
        }
      } catch {
        /* server busy or down: try again later, and don't move the cursor */
      } finally {
        extractingRef.current = false;
        setExtracting(false);
      }
    },
    [commit],
  );

  /** After clearing the chat, start counting from the new messages. */
  const resetCursor = useCallback(() => commit({ ...fileRef.current, extractedUpTo: null }), [commit]);

  /** Gives every memory an embedding (for searching by meaning). Returns how many were indexed. */
  const indexVectors = useCallback(async (): Promise<number> => {
    const s = settingsRef.current;
    if (!s.embedPath || indexingRef.current) return 0;
    const model = vecModelId(s.embedPath);
    const todo = fileRef.current.memories.filter((m) => !m.vec || m.vecModel !== model);
    if (!todo.length) return 0;

    indexingRef.current = true;
    setIndexing(true);
    let done = 0;
    try {
      for (let i = 0; i < todo.length; i += 16) {
        const batch = todo.slice(i, i + 16);
        const vecs = await embedTexts(s.embedPort, batch.map((m) => fillTemplate(m.text, s)), 8000);
        if (!vecs) break;
        const byId = new Map(batch.map((m, j) => [m.id, encodeVec(vecs[j])]));
        const cur = fileRef.current;
        commit({
          ...cur,
          memories: cur.memories.map((m) => (byId.has(m.id) ? { ...m, vec: byId.get(m.id), vecModel: model } : m)),
        });
        done += batch.length;
      }
    } finally {
      indexingRef.current = false;
      setIndexing(false);
    }
    return done;
  }, [commit]);

  // Index automatically whenever the embedding model is up and some memories have no vector yet.
  useEffect(() => {
    if (embedReady && settings.embedPath) void indexVectors();
  }, [embedReady, settings.embedPath, file.memories.length, indexVectors]);

  // ---- editing from the Memories window
  const addManual = useCallback(
    (text: string, importance: number, pinned: boolean) => {
      const t = text.trim();
      if (!t) return;
      const s = settingsRef.current;
      const m = newMemory(
        { text: toPlaceholders(t, s.userName, s.charName), importance, kind: guessKind(t), manual: true, pinned },
        Date.now(),
      );
      commit({ ...fileRef.current, memories: [...fileRef.current.memories, m] });
    },
    [commit],
  );

  const edit = useCallback(
    (id: string, patch: { text?: string; importance?: number }) => {
      const s = settingsRef.current;
      const cur = fileRef.current;
      commit({
        ...cur,
        memories: cur.memories.map((m) => {
          if (m.id !== id) return m;
          const next = { ...m };
          if (patch.text !== undefined && patch.text.trim() && patch.text.trim() !== m.text) {
            next.text = toPlaceholders(patch.text.trim(), s.userName, s.charName);
            next.vec = undefined; // re-indexed automatically
            next.vecModel = undefined;
          }
          if (patch.importance !== undefined) {
            next.importance = Math.min(10, Math.max(1, Math.round(patch.importance)));
            next.stability = Math.max(m.stability, initialStability(next.importance, m.emotion));
          }
          return next;
        }),
      });
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      const cur = fileRef.current;
      commit({ ...cur, memories: cur.memories.filter((m) => m.id !== id) });
    },
    [commit],
  );

  const togglePin = useCallback(
    (id: string) => {
      const cur = fileRef.current;
      commit({
        ...cur,
        memories: cur.memories.map((m) => {
          if (m.id !== id) return m;
          // unpinning something the sleep cycle pinned means "don't pin it again"
          return m.pinned
            ? { ...m, pinned: false, autoPinned: false, noAutoPin: true }
            : { ...m, pinned: true, autoPinned: false, noAutoPin: false, lastRecalled: Date.now() };
        }),
      });
    },
    [commit],
  );

  const clearAll = useCallback(() => commit({ ...fileRef.current, memories: [] }), [commit]);

  const getMemories = useCallback(() => fileRef.current.memories, []);

  /** Her tidying: merge near-duplicates and pin lasting facts. */
  const consolidate = useCallback((): { merged: number; promoted: number } => {
    const cur = fileRef.current;
    const r = consolidateMemories(cur.memories);
    if (r.merged || r.promoted) commit({ ...cur, memories: r.memories });
    return { merged: r.merged, promoted: r.promoted };
  }, [commit]);

  return {
    memories: file.memories,
    lastRecall,
    extracting,
    indexing,
    recallFor,
    maybeExtract,
    pendingCount,
    resetCursor,
    indexVectors,
    addManual,
    edit,
    remove,
    togglePin,
    clearAll,
    getMemories,
    consolidate,
  };
}

export type MemoryApi = ReturnType<typeof useMemory>;
