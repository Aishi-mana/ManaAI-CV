import { useEffect, useMemo, useRef, useState } from "react";
import ChatPanel from "./components/ChatPanel";
import SettingsDrawer from "./components/SettingsDrawer";
import StagePanel from "./components/StagePanel";
import Wardrobe from "./components/Wardrobe";
import { loadAvatarConfig, saveAvatarConfig } from "./core/avatar";
import type { AvatarConfig } from "./core/avatar";
import { cleanReply } from "./core/emotion";
import { buildPayload, streamChat } from "./core/llm";
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

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [messages, setMessages] = useState<Msg[]>(loadChat);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWardrobe, setShowWardrobe] = useState(false);
  const [savedCfg, setSavedCfg] = useState<AvatarConfig>(loadAvatarConfig);
  const abortRef = useRef<AbortController | null>(null);

  const llama = useLlama(settings);
  const avatar = useAvatarAssets(settings.avatarDir);
  const progress = useProgress(avatar.assets);

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

  const lastBot = [...messages].reverse().find((m) => m.role === "assistant");
  const lastClean = lastBot ? cleanReply(lastBot.content) : null;
  const emotion = lastClean ? lastClean.emotion : null;
  const speech = lastBot && lastClean ? { id: lastBot.id, text: lastClean.text } : null;

  async function send(text: string) {
    const userMsg: Msg = { id: uid(), role: "user", content: text };
    const botMsg: Msg = { id: uid(), role: "assistant", content: "" };
    const history = [...messages, userMsg];

    // Count this message toward your time together; this may unlock something.
    const unlocked = progress.update(bumpMessage);
    const assets = avatar.assets;
    const extra =
      assets && unlocked.length
        ? `\n\n[Just now you and ${settings.userName} reached something special together, and you unlocked new things for your look: ${unlocked.map((id) => itemLabel(assets, id)).join(", ")}. You are very happy about it. Mention it briefly and warmly in this reply.]`
        : "";

    setMessages([...history, botMsg]);
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = "";

    try {
      await streamChat({
        port: settings.port,
        temperature: settings.temperature,
        signal: ctrl.signal,
        messages: buildPayload(fillTemplate(settings.systemPrompt, settings) + extra, history),
        onToken: (t) => {
          acc += t;
          const snapshot = acc;
          setMessages((prev) => prev.map((m) => (m.id === botMsg.id ? { ...m, content: snapshot } : m)));
        },
      });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      if (!aborted) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((prev) => prev.map((m) => (m.id === botMsg.id ? { ...m, content: acc, error: msg } : m)));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      // Drop an empty reply (stopped before any text arrived).
      setMessages((prev) => prev.filter((m) => !(m.id === botMsg.id && !m.content && !m.error)));
    }
  }

  function clearChat() {
    if (busy) return;
    if (messages.length === 0 || window.confirm("Clear this whole conversation?")) setMessages([]);
  }

  const running = llama.status === "starting" || llama.status === "ready";
  const freshAssets = avatar.assets;

  return (
    <div className="app">
      <StagePanel
        charName={settings.charName}
        emotion={emotion}
        busy={busy}
        speech={speech}
        avatar={avatar}
        cfg={cfg}
        onCfg={changeCfg}
        onOpenWardrobe={() => setShowWardrobe(true)}
      />

      <main className="main">
        <header className="topbar">
          <span className={`pill ${llama.status}`}>{STATUS_LABEL[llama.status]}</span>
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
          <button className="btn" onClick={clearChat} disabled={busy}>
            Clear chat
          </button>
          <button className="btn" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </header>

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
        />
      </main>

      {showSettings && (
        <SettingsDrawer
          settings={settings}
          running={running}
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
    </div>
  );
}
