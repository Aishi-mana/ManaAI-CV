import { useCallback, useEffect, useRef, useState } from "react";
import type { MemoryApi } from "../memory/useMemory";
import { getData, setData } from "../persist";
import type { Mood, TraitMap } from "../persona/types";
import { fillTemplate } from "../settings";
import type { Settings } from "../settings";
import type { Msg } from "../types";
import { eligibility, initiativeTurn, normalizeState, pickPlan, recordStart } from "./policy";
import type { InitiativeState, Plan } from "./policy";

const FAIL_BACKOFF_MS = 5 * 60_000;
const newJitter = () => 0.7 + Math.random() * 0.6;

export interface InitiativeDeps {
  settings: Settings;
  ready: boolean;
  isBusy: () => boolean;
  drawerOpen: () => boolean;
  /** when you last typed or sent something */
  lastInputAt: () => number;
  getMessages: () => Msg[];
  awayHours: () => number;
  mood: () => Mood;
  traits: () => TraitMap;
  memory: MemoryApi;
  /** she was left waiting with no answer */
  onIgnored: () => void;
  /** generates and shows her message; returns true if she managed to say something */
  start: (plan: Plan, instruction: string) => Promise<boolean>;
}

export type InitiativeStatus = "idle" | "waiting" | "gaveup";

/** Decides when Mana starts a conversation, and tracks her waiting for your answer. */
export function useInitiative(deps: InitiativeDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const initial = (() => {
    const s = normalizeState(getData("initiative"));
    const last = deps.getMessages().slice(-1)[0];
    // she is only "waiting" if her own opener is still the last thing in the chat
    return s.waitingSince !== null && !(last && last.role === "assistant" && last.initiative) ? { ...s, waitingSince: null } : s;
  })();
  const stateRef = useRef<InitiativeState>(initial);
  const [status, setStatus] = useState<InitiativeStatus>(() => {
    if (initial.waitingSince === null) return "idle";
    return Date.now() - initial.waitingSince >= deps.settings.initiativeWaitMin * 60_000 ? "gaveup" : "waiting";
  });
  const gaveUpRef = useRef(status === "gaveup");
  const startingRef = useRef(false);
  const greetedRef = useRef(false);
  const failUntilRef = useRef(0);
  const jitterRef = useRef(newJitter());

  const commit = useCallback((next: InitiativeState) => {
    stateRef.current = next;
    setData("initiative", next);
  }, []);

  const begin = useCallback(
    async (plan: Plan): Promise<boolean> => {
      if (startingRef.current) return false;
      startingRef.current = true;
      try {
        const d = depsRef.current;
        const t = Date.now();
        const instruction = initiativeTurn(plan, {
          userName: d.settings.userName,
          awayHours: d.awayHours(),
          hour: new Date(t).getHours(),
          memoryText: plan.memory ? fillTemplate(plan.memory.text, d.settings) : undefined,
        });
        const ok = await d.start(plan, instruction);
        if (ok) {
          commit(recordStart(stateRef.current, plan, t));
          gaveUpRef.current = false;
          setStatus("waiting");
          jitterRef.current = newJitter();
        } else {
          failUntilRef.current = Date.now() + FAIL_BACKOFF_MS;
        }
        return ok;
      } catch {
        failUntilRef.current = Date.now() + FAIL_BACKOFF_MS;
        return false;
      } finally {
        startingRef.current = false;
      }
    },
    [commit],
  );

  const makePlan = useCallback((): Plan => {
    const d = depsRef.current;
    return pickPlan({
      now: Date.now(),
      mems: d.memory.getMemories(),
      state: stateRef.current,
      mood: d.mood(),
      traits: d.traits(),
      awayHours: d.awayHours(),
    });
  }, []);

  /** You answered (or wrote something): she stops waiting. */
  const noteUserMessage = useCallback(() => {
    if (stateRef.current.waitingSince !== null) commit({ ...stateRef.current, waitingSince: null });
    gaveUpRef.current = false;
    jitterRef.current = newJitter();
    setStatus("idle");
  }, [commit]);

  /** The "start one now" test button. */
  const triggerNow = useCallback(async (): Promise<string> => {
    const d = depsRef.current;
    if (!d.ready) return "Start the model first.";
    if (d.isBusy() || startingRef.current) return "She is busy right now.";
    const ok = await begin(makePlan());
    return ok ? "" : "She couldn't think of anything to say. Try again in a moment.";
  }, [begin, makePlan]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const d = depsRef.current;
      const t = Date.now();
      const st = stateRef.current;

      // waited long enough with no answer: she feels a little ignored, then stays quiet
      if (st.waitingSince !== null && !gaveUpRef.current && t - st.waitingSince >= d.settings.initiativeWaitMin * 60_000) {
        gaveUpRef.current = true;
        setStatus("gaveup");
        d.onIgnored();
      }
      if (startingRef.current || t < failUntilRef.current) return;

      const base = {
        now: t,
        enabled: d.settings.initiativeEnabled,
        frequency: d.settings.initiativeFrequency,
        quietStart: d.settings.initiativeQuietStart,
        quietEnd: d.settings.initiativeQuietEnd,
        state: st,
        ready: d.ready,
        busy: d.isBusy(),
        drawerOpen: d.drawerOpen(),
        idleMs: t - d.lastInputAt(),
        jitter: jitterRef.current,
        mood: d.mood(),
      };

      // the first time the model is ready after opening the app: say hello if you were away a while
      if (!greetedRef.current && d.ready) {
        greetedRef.current = true;
        if (d.awayHours() >= 6 && eligibility({ ...base, skipIdle: true }).ok) void begin({ kind: "greet" });
        return;
      }
      if (eligibility(base).ok) void begin(makePlan());
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [begin, makePlan]);

  return { status, noteUserMessage, triggerNow };
}

export type InitiativeApi = ReturnType<typeof useInitiative>;
