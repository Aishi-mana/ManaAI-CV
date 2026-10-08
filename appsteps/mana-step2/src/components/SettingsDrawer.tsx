import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { DEFAULT_PROMPT } from "../core/settings";
import type { Settings } from "../core/settings";
import { inTauri } from "../core/useLlama";

interface Props {
  settings: Settings;
  running: boolean;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export default function SettingsDrawer({ settings, running, onSave, onClose }: Props) {
  const [d, setD] = useState<Settings>(settings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setD((prev) => ({ ...prev, [key]: value }));

  async function browse(key: "exePath" | "modelPath" | "avatarDir") {
    try {
      const picked = await open({
        multiple: false,
        directory: key === "avatarDir",
        filters:
          key === "avatarDir"
            ? undefined
            : key === "modelPath"
              ? [{ name: "GGUF model", extensions: ["gguf"] }]
              : [{ name: "llama-server", extensions: ["exe"] }],
      });
      if (typeof picked === "string") set(key, picked);
    } catch {
      /* dialog cancelled or unavailable */
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="drawer" role="dialog" aria-label="Settings">
        <header className="drawer-head">
          <h2>Settings</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="drawer-body">
          <h3>Model</h3>

          <label className="field">
            <span>llama-server file</span>
            <div className="pathrow">
              <input value={d.exePath} onChange={(e) => set("exePath", e.target.value)} spellCheck={false} />
              {inTauri && (
                <button className="btn" onClick={() => browse("exePath")}>
                  Browse
                </button>
              )}
            </div>
          </label>

          <label className="field">
            <span>Model file (.gguf)</span>
            <div className="pathrow">
              <input value={d.modelPath} onChange={(e) => set("modelPath", e.target.value)} spellCheck={false} />
              {inTauri && (
                <button className="btn" onClick={() => browse("modelPath")}>
                  Browse
                </button>
              )}
            </div>
          </label>

          <div className="grid3">
            <label className="field">
              <span>Context size</span>
              <select value={d.ctxSize} onChange={(e) => set("ctxSize", Number(e.target.value))}>
                {[4096, 8192, 12288, 16384].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>GPU layers</span>
              <input type="number" min={0} max={999} value={d.gpuLayers} onChange={(e) => set("gpuLayers", Number(e.target.value))} />
            </label>
            <label className="field">
              <span>Port</span>
              <input type="number" min={1024} max={65535} value={d.port} onChange={(e) => set("port", Number(e.target.value))} />
            </label>
          </div>

          <label className="check">
            <input type="checkbox" checked={d.autoStart} onChange={(e) => set("autoStart", e.target.checked)} />
            <span>Start the model when the app opens</span>
          </label>

          {running && <p className="hint">Model changes apply after you stop and start the model again.</p>}

          <h3>Avatar</h3>

          <label className="field">
            <span>Avatar folder (contains base, eyes, mouth, hairstyles, ...)</span>
            <div className="pathrow">
              <input value={d.avatarDir} onChange={(e) => set("avatarDir", e.target.value)} spellCheck={false} />
              {inTauri && (
                <button className="btn" onClick={() => browse("avatarDir")}>
                  Browse
                </button>
              )}
            </div>
          </label>

          <h3>{d.charName || "Her"} and you</h3>

          <div className="grid2">
            <label className="field">
              <span>Your name</span>
              <input value={d.userName} onChange={(e) => set("userName", e.target.value)} />
            </label>
            <label className="field">
              <span>Her name</span>
              <input value={d.charName} onChange={(e) => set("charName", e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Creativity (temperature): {d.temperature.toFixed(2)}</span>
            <input
              type="range"
              min={0.2}
              max={1.4}
              step={0.05}
              value={d.temperature}
              onChange={(e) => set("temperature", Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Character card (use {"{{user}}"} and {"{{char}}"} for the names)</span>
            <textarea rows={14} value={d.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
          </label>
          <button className="btn" onClick={() => set("systemPrompt", DEFAULT_PROMPT)}>
            Reset character card
          </button>
        </div>

        <footer className="drawer-foot">
          <button
            className="btn primary"
            onClick={() => {
              onSave(d);
              onClose();
            }}
          >
            Save settings
          </button>
        </footer>
      </section>
    </>
  );
}
