import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatOnce } from "../llm";
import type { MemoryApi } from "../memory/useMemory";
import { FAINT_BELOW, retrievability } from "../memory/strength";
import { getData, setData } from "../persist";
import type { Stats } from "../progress";
import { fillTemplate } from "../settings";
import type { Settings } from "../settings";
import { uid } from "../types";
import type { Msg } from "../types";
import { buildDiaryMessages, normalizeDiary, parseDiary } from "./diary";
import { afterGoodNews, afterReplyTag, afterUserMessage, describeMood, settleMood } from "./mood";
import { personaSection } from "./prompt";
import type { Returning } from "./prompt";
import { applyDayToStats, dayStats, driftFromDay } from "./reflect";
import { applyDrift, currentTraits, normalizePersona, resetDrift, setBaseline, stageOf } from "./traits";
import type { DiaryEntry, Persona, Trait } from "./types";

const HOUR = 3_600_000;
const MIN_MESSAGES = 4; // she only reflects on a day with at least this many of your messages
const MIN_GAP_H = 6; // at most one automatic reflection per 6 hours
const IDLE_MIN = 10; // reflect after this many quiet minutes
const RETRY_MS = 10 * 60_000; // wait this long after a failed attempt

export interface InnerLifeDeps {
  settings: Settings;
  ready: boolean;
  stats: Stats;
  getMessages: () => Msg[];
  lastActivityAt: () => number;
  isBusy: () => boolean;
  memory: MemoryApi;
  /** applies a change to the shared progress and returns anything newly unlocked */
  updateStats: (fn: (s: Stats) => Stats) => string[];
}

/** Mana's inner life: mood, slowly drifting personality, bond, and the "sleep" that writes her diary. */
export function useInnerLife(deps: InnerLifeDeps) {
  const [persona, setPersona] = useState<Persona>(() => normalizePersona(getData("persona"), Date.now()));
  const [diary, setDiary] = useState<DiaryEntry[]>(() => normalizeDiary(getData("diary")));
  const [now, setNow] = useState(Date.now());
  const [reflecting, setReflecting] = useState(false);
  const [note, setNote] = useState("");
  const personaRef = useRef(persona);
  const diaryRef = useRef(diary);
  const depsRef = useRef(deps);
  const reflectingRef = useRef(false);
  const lastAttemptRef = useRef(0);
  depsRef.current = deps;

  const commitPersona = useCallback((next: Persona) => {
    personaRef.current = next;
    setPersona(next);
    setData("persona", next);
  }, []);
  const commitDiary = useCallback((entries: DiaryEntry[]) => {
    diaryRef.current = entries;
    setDiary(entries);
    setData("diary", { version: 1, entries });
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const traits = useMemo(() => currentTraits(persona), [persona]);
  const mood = useMemo(() => settleMood(persona.mood, traits, persona.lastChatAt, now), [persona, traits, now]);
  const moodInfo = useMemo(() => describeMood(mood), [mood]);

  // ---- events during chat
  /** You sent a message. Returns how long you were away (for her prompt). */
  const noteUserMessage = useCallback((): Returning => {
    const p = personaRef.current;
    const t = Date.now();
    const settled = settleMood(p.mood, currentTraits(p), p.lastChatAt, t);
    const awayHours = p.lastChatAt ? (t - p.lastChatAt) / HOUR : 0;
    commitPersona({ ...p, mood: afterUserMessage(settled, awayHours, t), lastChatAt: t });
    return { awayHours, lonelyBefore: settled.lonely };
  }, [commitPersona]);

  /** She finished a reply with this emotion tag. */
  const noteReply = useCallback(
    (tag: string | null) => {
      const p = personaRef.current;
      const t = Date.now();
      const settled = settleMood(p.mood, currentTraits(p), p.lastChatAt, t);
      commitPersona({ ...p, mood: afterReplyTag(settled, tag, t) });
    },
    [commitPersona],
  );

  /** She asked something and got no answer for a few minutes: she feels a little ignored. */
  const noteIgnored = useCallback(() => {
    const p = personaRef.current;
    const t = Date.now();
    const m = settleMood(p.mood, currentTraits(p), p.lastChatAt, t);
    commitPersona({
      ...p,
      mood: { ...m, lonely: Math.min(1, m.lonely + 0.12), valence: Math.max(-1, m.valence - 0.06), at: t },
    });
  }, [commitPersona]);

  const noteGoodNews = useCallback(() => {
    const p = personaRef.current;
    const t = Date.now();
    commitPersona({ ...p, mood: afterGoodNews(settleMood(p.mood, currentTraits(p), p.lastChatAt, t), t) });
  }, [commitPersona]);

  /** Her inner state as sentences for the system prompt. */
  const promptBlock = useCallback((returning?: Returning): string => {
    const p = personaRef.current;
    const t = Date.now();
    const m = settleMood(p.mood, currentTraits(p), p.lastChatAt, t);
    return personaSection(p, m, depsRef.current.stats.bond, t, returning);
  }, []);

  // ---- the sleep cycle
  const reflect = useCallback(
    async (manual: boolean): Promise<string> => {
      const d = depsRef.current;
      const s = d.settings;
      if (reflectingRef.current) return "She is already reflecting.";
      if (!d.ready) return "Start the model first.";
      reflectingRef.current = true;
      setReflecting(true);
      lastAttemptRef.current = Date.now();
      try {
        // make sure today's conversation has become memories first
        await d.memory.maybeExtract(d.getMessages(), true);

        const t = Date.now();
        const p = personaRef.current;
        const since = p.lastReflectionAt ?? 0;
        const msgs = d.getMessages().filter((m) => (m.at ?? 0) > since);
        const stats = dayStats(msgs, p.lastReflectionAt, t);
        if (!manual && stats.userMessages < MIN_MESSAGES) return "";

        d.memory.consolidate();
        const all = d.memory.getMemories();
        const todays = all
          .filter((m) => m.created > since)
          .sort((a, b) => b.importance - a.importance)
          .slice(0, 8)
          .map((m) => fillTemplate(m.text, s));
        const faint = all.filter((m) => !m.pinned && m.importance >= 4 && retrievability(m, t) < FAINT_BELOW);
        const faintMemory = faint.length ? fillTemplate(faint[Math.floor(Math.random() * faint.length)].text, s) : undefined;

        const m = settleMood(p.mood, currentTraits(p), p.lastChatAt, t);
        const gap = stats.maxGapHours;
        const awayText =
          gap >= 20 ? ` after you two had been apart for about ${gap >= 36 ? `${Math.round(gap / 24)} days` : `${Math.round(gap)} hours`}` : "";
        const raw = await chatOnce({
          port: s.port,
          messages: buildDiaryMessages(fillTemplate(s.systemPrompt, s), {
            userName: s.userName,
            charName: s.charName,
            dateLabel: new Date(t).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
            moodPhrase: fillTemplate(describeMood(m).phrase, s),
            bondPhrase: fillTemplate(stageOf(d.stats.bond).stage.phrase, s),
            userMessages: stats.userMessages,
            awayText,
            memories: todays,
            faintMemory,
          }),
          temperature: 0.9,
          maxTokens: 400,
        });
        const entry = parseDiary(raw, s.userName, s.charName);
        if (!entry) return "She couldn't think of what to write. She'll try again later.";

        commitDiary(
          [{ id: uid(), at: t, text: entry.text, emotion: entry.emotion, mood: describeMood(m).label }, ...diaryRef.current].slice(0, 400),
        );
        // use the freshest persona: you may have chatted while she was writing
        commitPersona({ ...applyDrift(personaRef.current, driftFromDay(stats)), lastReflectionAt: t });
        const unlocked = d.updateStats((st) => applyDayToStats(st, stats, t));
        if (unlocked.length) {
          const cur = personaRef.current;
          commitPersona({ ...cur, mood: afterGoodNews(settleMood(cur.mood, currentTraits(cur), cur.lastChatAt, t), t) });
        }
        return manual ? "Done. She wrote in her diary." : "";
      } catch (e) {
        return `She couldn't reflect right now (${e instanceof Error ? e.message : String(e)}).`;
      } finally {
        reflectingRef.current = false;
        setReflecting(false);
      }
    },
    [commitDiary, commitPersona],
  );

  const reflectNow = useCallback(async () => {
    setNote("");
    setNote(await reflect(true));
  }, [reflect]);

  // Automatic: after a quiet while, if there was a real conversation since the last reflection.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const d = depsRef.current;
      if (!d.settings.reflectionEnabled || !d.ready || d.isBusy() || reflectingRef.current) return;
      const t = Date.now();
      if (t - lastAttemptRef.current < RETRY_MS) return;
      const p = personaRef.current;
      if (p.lastReflectionAt && t - p.lastReflectionAt < MIN_GAP_H * HOUR) return;
      if (t - d.lastActivityAt() < IDLE_MIN * 60_000) return;
      const since = p.lastReflectionAt ?? 0;
      const n = d.getMessages().filter((m) => m.role === "user" && (m.at ?? 0) > since).length;
      if (n >= MIN_MESSAGES) void reflect(false);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [reflect]);

  // ---- editing from the window
  const changeBaseline = useCallback((t: Trait, v: number) => commitPersona(setBaseline(personaRef.current, t, v)), [commitPersona]);
  const clearDrift = useCallback(() => commitPersona(resetDrift(personaRef.current)), [commitPersona]);
  const deleteEntry = useCallback((id: string) => commitDiary(diaryRef.current.filter((e) => e.id !== id)), [commitDiary]);

  return {
    persona,
    traits,
    mood,
    moodInfo,
    diary,
    now,
    reflecting,
    note,
    noteUserMessage,
    noteReply,
    noteGoodNews,
    noteIgnored,
    promptBlock,
    reflectNow,
    changeBaseline,
    clearDrift,
    deleteEntry,
  };
}

export type InnerLifeApi = ReturnType<typeof useInnerLife>;
