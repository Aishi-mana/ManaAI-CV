import { useEffect, useMemo, useRef, useState } from "react";
import ChatPanel from "./components/ChatPanel";
import MemoryViewer from "./components/MemoryViewer";
import SettingsDrawer from "./components/SettingsDrawer";
import StagePanel from "./components/StagePanel";
import InnerLife from "./components/InnerLife";
import Wardrobe from "./components/Wardrobe";
import { loadAvatarConfig, saveAvatarConfig } from "./core/avatar";
import type { AvatarConfig } from "./core/avatar";
import { cleanReply } from "./core/emotion";
import { buildPayload, streamChat } from "./core/llm";
import { useMemory } from "./core/memory/useMemory";
import { playChime, flashTaskbar } from "./core/initiative/signals";
import { useInitiative } from "./core/initiative/useInitiative";
import type { Plan } from "./core/initiative/policy";
import { describeMood } from "./core/persona/mood";
import { useInnerLife } from "./core/persona/useInnerLife";
import { bootData, onPersistError } from "./core/persist";
import type { BootResult } from "./core/persist";
import { bumpMessage } from "./core/progress";
import { fillTemplate, loadChat, loadSettings, saveChat, saveSettings } from "./core/settings";
import type { Settings } from "./core/settings";
import { uid } from "./core/types";
import type { Msg } from "./core/types";
import { useAvatarAssets } from "./core/useAvatar";
import { useLlama } from "./core/useLlama";
import { useProgress } from "./core/useProgress";
import { buildWardrobe, itemLabel, resolveLoadout } from "./core/wardrobe";

const STATUS_LABEL = {
  stopped: "Model off",
  starting: "Loading",
  ready: "Ready",
  error: "Problem",
} as const;

/** Loads everything from the data folder first, then shows the app. */
export default function App() {
  const [boot, setBoot] = useState<BootResult | null>(null);

  useEffect(() => {
    bootData()
      .then(setBoot)
      .catch((e) => setBoot({ ok: false, error: String(e), dir: "", migrated: [], notes: [] }));
  }, []);

  if (!boot) return <div className="boot">Loading Mana...</div>;
  return <MainApp boot={boot} />;
}

function MainApp({ boot }: { boot: BootResult }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [messages, setMessages] = useState<Msg[]>(loadChat);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWardrobe, setShowWardrobe] = useState(false);
  const [showMemories, setShowMemories] = useState(false);
  const [showInner, setShowInner] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [savedCfg, setSavedCfg] = useState<AvatarConfig>(loadAvatarConfig);
  const [saveError, setSaveError] = useState("");
  const [bootNote, setBootNote] = useState(() => {
    const bits: string[] = [...boot.notes];
    if (!boot.ok) bits.push(`Couldn't use the data folder (${boot.error}). Mana is using temporary browser storage until you fix the path in Settings.`);
    else if (boot.migrated.length) bits.push(`Your saved ${boot.migrated.join(", ")} moved into the data folder: ${boot.dir}`);
    return bits.join(" ");
  });
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const busyRef = useRef(false);
  busyRef.current = busy;
  const lastActivityRef = useRef(Math.max(0, ...messages.map((m) => m.at ?? 0)));
  const toldRef = useRef(new Set<string>());
  const lastInputRef = useRef(Date.now()); // when you last typed or sent something
  const drawerOpenRef = useRef(false);

  useEffect(() => onPersistError(setSaveError), []);

  const llama = useLlama(settings);
  const avatar = useAvatarAssets(settings.avatarDir);
  const progress = useProgress(avatar.assets);
  const memory = useMemory(settings, llama.status === "ready", llama.embedReady);
  const inner = useInnerLife({
    settings,
    ready: llama.status === "ready",
    stats: progress.stats,
    getMessages: () => messagesRef.current,
    lastActivityAt: () => lastActivityRef.current,
    isBusy: () => busyRef.current,
    memory,
    updateStats: progress.update,
  });

  // Starts conversations herself (asks you things, says hello) when the moment is right.
  const initiative = useInitiative({
    settings,
    ready: llama.status === "ready",
    isBusy: () => busyRef.current,
    drawerOpen: () => drawerOpenRef.current,
    lastInputAt: () => lastInputRef.current,
    getMessages: () => messagesRef.current,
    awayHours: () => (inner.persona.lastChatAt ? (Date.now() - inner.persona.lastChatAt) / 3_600_000 : 0),
    mood: () => inner.mood,
    traits: () => inner.traits,
    memory,
    onIgnored: inner.noteIgnored,
    start: startInitiative,
  });
  drawerOpenRef.current = showSettings || showWardrobe || showMemories || showInner;

  // What she may wear right now (depends on what you two have unlocked), and what she IS wearing.
  const wardrobe = useMemo(
    () => (avatar.assets ? buildWardrobe(avatar.assets, progress.stats, new Date(), settings.charName) : null),
    [avatar.assets, progress.stats, settings.charName],
  );
  const cfg = useMemo(() => (wardrobe ? resolveLoadout(savedCfg, wardrobe) : savedCfg), [wardrobe, savedCfg]);

  function changeCfg(next: AvatarConfig) {
    setSavedCfg(next);
    saveAvatarConfig(next);
  }

  useEffect(() => {
    if (!busy) saveChat(messages);
  }, [messages, busy]);

  // If you stop chatting for a minute, turn what's left of the conversation into memories.
  useEffect(() => {
    if (busy || llama.status !== "ready" || !settings.memoryEnabled) return;
    const t = window.setTimeout(() => void memory.maybeExtract(messagesRef.current, true), 60_000);
    return () => window.clearTimeout(t);
  }, [messages, busy, llama.status, settings.memoryEnabled, memory.maybeExtract]);

  // Her face: right after she speaks it shows her reply's emotion; after a quiet moment, her mood.
  const moodEmotion = describeMood(inner.mood).emotion;
  const lastBot = [...messages].reverse().find((m) => m.role === "assistant");
  const lastClean = lastBot ? cleanReply(lastBot.content) : null;
  const emotion = lastClean ? lastClean.emotion : null;
  const speech = lastBot && lastClean ? { id: lastBot.id, text: lastClean.text } : null;
  const settled = inner.now - lastActivityRef.current > 45_000;
  const waiting = initiative.status === "waiting";
  const shownEmotion = !emotion || settled ? (waiting ? "thinking" : moodEmotion) : emotion;

  /**
   * Streams one reply from her into the chat. Used for answering you and for her own openers.
   * `tail` is a hidden instruction turn that is not saved in the chat. Returns true if she said something.
   */
  async function respond(o: {
    history: Msg[];
    botMsg: Msg;
    recallText: string;
    extraSystem: string;
    tail?: string;
    /** on failure remove the message instead of showing an error (for things she starts herself) */
    quiet?: boolean;
  }): Promise<boolean> {
    setMessages([...o.history, o.botMsg]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = "";
    let failed = false;

    try {
      // What comes to mind (and the things she always remembers).
      const memoryBlock = await memory.recallFor(o.recallText, lastClean?.text ?? "");
      const turns: Msg[] = o.tail ? [...o.history, { id: "hidden", role: "user", content: o.tail }] : o.history;
      await streamChat({
        port: settings.port,
        temperature: settings.temperature,
        signal: ctrl.signal,
        messages: buildPayload(fillTemplate(settings.systemPrompt + memoryBlock + o.extraSystem, settings), turns),
        onToken: (t) => {
          acc += t;
          const snapshot = acc;
          setMessages((prev) => prev.map((m) => (m.id === o.botMsg.id ? { ...m, content: snapshot } : m)));
        },
      });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (!aborted) {
        failed = true;
        if (!o.quiet) {
          const msg = e instanceof Error ? e.message : String(e);
          setMessages((prev) => prev.map((m) => (m.id === o.botMsg.id ? { ...m, content: acc, error: msg } : m)));
        }
      }
    } finally {
      abortRef.current = null;
      if (acc) inner.noteReply(cleanReply(acc).emotion);
      lastActivityRef.current = Date.now();
      setBusy(false);
      // Drop an empty reply (stopped before any text arrived, or a failed opener).
      setMessages((prev) =>
        prev.filter((m) => !(m.id === o.botMsg.id && (!m.content || (failed && o.quiet)) && !(m.error && !o.quiet))),
      );
      // Every few messages, write what happened into her memory (in the background).
      window.setTimeout(() => void memory.maybeExtract(messagesRef.current), 800);
    }
    return !failed && acc.trim().length > 0;
  }

  async function send(text: string) {
    const sentAt = Date.now();
    const userMsg: Msg = { id: uid(), role: "user", content: text, at: sentAt };
    const botMsg: Msg = { id: uid(), role: "assistant", content: "", at: sentAt };
    lastActivityRef.current = sentAt;
    lastInputRef.current = sentAt;

    // You answered: she stops waiting. Her mood reacts to you coming back; counting the message may unlock something.
    initiative.noteUserMessage();
    const returning = inner.noteUserMessage();
    const unlocked = progress.update(bumpMessage);
    if (unlocked.length) inner.noteGoodNews();
    const personaBlock = inner.promptBlock(returning);

    // Tell her about new unlocks (including ones from her sleep cycle) once.
    const assets = avatar.assets;
    const toTell = Array.from(new Set([...progress.fresh, ...unlocked])).filter((id) => !toldRef.current.has(id));
    toTell.forEach((id) => toldRef.current.add(id));
    const extra =
      assets && toTell.length
        ? `\n\n[Just now you and ${settings.userName} reached something special together, and you unlocked new things for your look: ${toTell.map((id) => itemLabel(assets, id)).join(", ")}. You are very happy about it. Mention it briefly and warmly in this reply.]`
        : "";

    await respond({ history: [...messages, userMsg], botMsg, recallText: text, extraSystem: personaBlock + extra });
  }

  /** She starts a conversation herself. Returns true if she said something. */
  async function startInitiative(plan: Plan, instruction: string): Promise<boolean> {
    if (busyRef.current || llama.status !== "ready") return false;
    const botMsg: Msg = { id: uid(), role: "assistant", content: "", at: Date.now(), initiative: true };
    const ok = await respond({
      history: messagesRef.current,
      botMsg,
      recallText: plan.memory ? fillTemplate(plan.memory.text, settings) : "",
      extraSystem: inner.promptBlock(),
      tail: instruction,
      quiet: true,
    });
    if (ok) {
      if (settings.initiativeSound) playChime();
      void flashTaskbar();
    }
    return ok;
  }

  async function clearChat() {
    setConfirmClear(false);
    if (busy) return;
    // Save what hasn't been remembered yet, then start fresh. Memories are kept.
    if (llama.status === "ready" && memory.pendingCount(messagesRef.current) >= 2) {
      await memory.maybeExtract(messagesRef.current, true);
    }
    memory.resetCursor();
    setMessages([]);
  }

  const running = llama.status === "starting" || llama.status === "ready";
  const freshAssets = avatar.assets;

  return (
    <div className="app">
      <StagePanel
        charName={settings.charName}
        emotion={shownEmotion}
        busy={busy}
        waiting={waiting}
        speech={speech}
        avatar={avatar}
        cfg={cfg}
        onCfg={changeCfg}
        onOpenWardrobe={() => setShowWardrobe(true)}
      />

      <main className="main">
        <header className="topbar">
          <span className={`pill ${llama.status}`}>{STATUS_LABEL[llama.status]}</span>
          {memory.extracting && <span className="soft">Writing memories...</span>}
          <div className="spacer" />
          {running ? (
            <button className="btn" onClick={llama.stop}>
              Stop model
            </button>
          ) : (
            <button className="btn primary" onClick={llama.start}>
              Start model
            </button>
          )}
          {confirmClear ? (
            <>
              <span className="soft">Clear this conversation? Memories are kept.</span>
              <button className="btn" onClick={clearChat}>Yes, clear</button>
              <button className="btn" onClick={() => setConfirmClear(false)}>No</button>
            </>
          ) : (
            <button className="btn" onClick={() => (messages.length ? setConfirmClear(true) : undefined)} disabled={busy}>
              Clear chat
            </button>
          )}
          <button className="btn" onClick={() => setShowMemories(true)}>
            Memories ({memory.memories.length})
          </button>
          <button className="btn" onClick={() => setShowInner(true)}>
            Mood &amp; diary
          </button>
          <button className="btn" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </header>

        {bootNote && (
          <div className="banner note" role="status">
            <span>{bootNote}</span>
            <button className="btn" onClick={() => setBootNote("")}>Dismiss</button>
          </div>
        )}

        {saveError && (
          <div className="banner error" role="alert">
            <span>{saveError}</span>
            <button className="btn" onClick={() => setSaveError("")}>Dismiss</button>
          </div>
        )}

        {llama.detail && (llama.status === "error" || llama.status === "starting") && (
          <div className={`banner ${llama.status}`} role="status">
            {llama.detail}
          </div>
        )}

        {freshAssets && progress.fresh.length > 0 && (
          <div className="banner unlock" role="status">
            <span>
              {settings.charName} unlocked: {progress.fresh.map((id) => itemLabel(freshAssets, id)).join(", ")}!
            </span>
            <button
              className="btn"
              onClick={() => {
                setShowWardrobe(true);
                progress.dismiss();
              }}
            >
              Open wardrobe
            </button>
            <button className="btn" onClick={progress.dismiss}>
              Dismiss
            </button>
          </div>
        )}

        <ChatPanel
          messages={messages}
          busy={busy}
          ready={llama.status === "ready"}
          charName={settings.charName}
          onSend={send}
          onStop={() => abortRef.current?.abort()}
          onActivity={() => {
            lastInputRef.current = Date.now();
          }}
        />
      </main>

      {showSettings && (
        <SettingsDrawer
          settings={settings}
          running={running}
          ready={llama.status === "ready"}
          onTestInitiative={() => void initiative.triggerNow()}
          onSave={(s) => {
            setSettings(s);
            saveSettings(s);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showWardrobe && wardrobe && (
        <Wardrobe
          data={wardrobe}
          cfg={cfg}
          stats={progress.stats}
          charName={settings.charName}
          itemsError={avatar.assets?.itemsError}
          onChange={changeCfg}
          onClose={() => setShowWardrobe(false)}
        />
      )}

      {showInner && (
        <InnerLife api={inner} settings={settings} stats={progress.stats} ready={llama.status === "ready"} onClose={() => setShowInner(false)} />
      )}

      {showMemories && (
        <MemoryViewer api={memory} settings={settings} embedReady={llama.embedReady} onClose={() => setShowMemories(false)} />
      )}
    </div>
  );
}
