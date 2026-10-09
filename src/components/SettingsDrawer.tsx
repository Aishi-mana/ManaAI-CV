import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getDataDir, setDataDir } from "../core/persist";
import { DEFAULT_PROMPT } from "../core/settings";
import type { Settings } from "../core/settings";
import { inTauri } from "../core/useLlama";

interface Props {
  settings: Settings;
  running: boolean;
  ready: boolean;
  onTestInitiative: () => void;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export default function SettingsDrawer({ settings, running, ready, onTestInitiative, onSave, onClose }: Props) {
  const [d, setD] = useState<Settings>(settings);
  const [dataDir, setDataDirDraft] = useState(getDataDir());
  const dataDirChanged = dataDir.trim() !== getDataDir();
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setD((prev) => ({ ...prev, [key]: value }));

  async function browseDataDir() {
    try {
      const picked = await open({ multiple: false, directory: true });
      if (typeof picked === "string") setDataDirDraft(picked);
    } catch {
      /* cancelled */
    }
  }

  async function browse(key: "exePath" | "modelPath" | "avatarDir" | "embedPath") {
    try {
      const picked = await open({
        multiple: false,
        directory: key === "avatarDir",
        filters:
          key === "avatarDir"
            ? undefined
            : key === "modelPath" || key === "embedPath"
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

          <h3>Memory</h3>

          <label className="check">
            <input type="checkbox" checked={d.memoryEnabled} onChange={(e) => set("memoryEnabled", e.target.checked)} />
            <span>Let {d.charName || "her"} remember our conversations</span>
          </label>

          <label className="check">
            <input type="checkbox" checked={d.reflectionEnabled} onChange={(e) => set("reflectionEnabled", e.target.checked)} />
            <span>Let {d.charName || "her"} reflect and write her diary when we're quiet</span>
          </label>

          <label className="field">
            <span>Embedding model (optional, lets her find memories by meaning)</span>
            <div className="pathrow">
              <input value={d.embedPath} onChange={(e) => set("embedPath", e.target.value)} spellCheck={false} placeholder="for example bge-small-en-v1.5-q8_0.gguf" />
              {inTauri && (
                <button className="btn" onClick={() => browse("embedPath")}>
                  Browse
                </button>
              )}
            </div>
          </label>

          <label className="field">
            <span>Embedding port</span>
            <input type="number" min={1024} max={65535} value={d.embedPort} onChange={(e) => set("embedPort", Number(e.target.value))} />
          </label>

          <label className="field">
            <span>Data folder (settings, chat and memories are saved here)</span>
            <div className="pathrow">
              <input value={dataDir} onChange={(e) => setDataDirDraft(e.target.value)} spellCheck={false} />
              {inTauri && (
                <button className="btn" onClick={browseDataDir}>
                  Browse
                </button>
              )}
            </div>
          </label>
          {dataDirChanged && (
            <p className="hint">
              The new folder is used after you restart Mana. Your existing files are not moved: copy the contents of the old
              folder into the new one first if you want to keep them.
            </p>
          )}

          <h3>Starting conversations</h3>

          <label className="check">
            <input type="checkbox" checked={d.initiativeEnabled} onChange={(e) => set("initiativeEnabled", e.target.checked)} />
            <span>Let {d.charName || "her"} start conversations (ask you things, say hello)</span>
          </label>

          <div className="grid3">
            <label className="field">
              <span>How often</span>
              <select value={d.initiativeFrequency} onChange={(e) => set("initiativeFrequency", e.target.value as Settings["initiativeFrequency"])}>
                <option value="rare">Rarely</option>
                <option value="normal">Normal</option>
                <option value="often">Often</option>
              </select>
            </label>
            <label className="field">
              <span>Quiet from (hour)</span>
              <input type="number" min={0} max={23} value={d.initiativeQuietStart} onChange={(e) => set("initiativeQuietStart", Number(e.target.value))} />
            </label>
            <label className="field">
              <span>Quiet until (hour)</span>
              <input type="number" min={0} max={23} value={d.initiativeQuietEnd} onChange={(e) => set("initiativeQuietEnd", Number(e.target.value))} />
            </label>
          </div>

          <div className="grid2">
            <label className="field">
              <span>Wait for your answer (minutes)</span>
              <input type="number" min={1} max={60} value={d.initiativeWaitMin} onChange={(e) => set("initiativeWaitMin", Math.max(1, Number(e.target.value)))} />
            </label>
            <label className="check">
              <input type="checkbox" checked={d.initiativeSound} onChange={(e) => set("initiativeSound", e.target.checked)} />
              <span>Soft chime when she starts a chat</span>
            </label>
          </div>
          <p className="hint-soft">
            She only speaks up when you have been idle for a while and you are not in a menu, never during quiet hours, and she
            never sends a second message until you answer the first. Save first if you changed anything here.
          </p>
          <button
            className="btn"
            disabled={!ready}
            onClick={() => {
              onClose();
              onTestInitiative();
            }}
          >
            Let her start a chat now
          </button>

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
              if (dataDirChanged) setDataDir(dataDir);
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
