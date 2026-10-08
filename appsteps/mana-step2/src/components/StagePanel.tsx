import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "./Avatar";
import { EMOTION_MAP, buildLayers, listOptions, loadAvatarConfig, normalizeConfig, saveAvatarConfig } from "../core/avatar";
import type { AvatarConfig } from "../core/avatar";
import { uid } from "../core/types";
import { useAvatarAssets } from "../core/useAvatar";
import type { Speech } from "../core/useLipSync";

interface Props {
  charName: string;
  emotion: string | null;
  busy: boolean;
  speech: Speech | null;
  avatarDir: string;
}

const pretty = (s: string) => s.replace(/_/g, " ");

export default function StagePanel({ charName, emotion, busy, speech, avatarDir }: Props) {
  const { assets, status, error, reload } = useAvatarAssets(avatarDir);
  const options = useMemo(() => (assets ? listOptions(assets) : null), [assets]);
  const [saved, setSaved] = useState<AvatarConfig>(loadAvatarConfig);
  const cfg = useMemo(() => (options ? normalizeConfig(saved, options) : saved), [saved, options]);
  const layers = useMemo(() => (assets ? buildLayers(assets, cfg) : []), [assets, cfg]);

  // Test controls (preview an emotion / make her say something) - they yield to real chat.
  const [preview, setPreview] = useState<string | null>(null);
  const [testSpeech, setTestSpeech] = useState<Speech | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (busy) {
      setPreview(null);
      setTestSpeech(null);
    }
  }, [busy]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  function update(next: AvatarConfig) {
    setSaved(next);
    saveAvatarConfig(next);
  }
  function showEmotion(e: string) {
    setPreview(e);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPreview(null), 4000);
  }
  function sayTest() {
    showEmotion("happy");
    setTestSpeech({ id: uid(), text: `hi hi! I'm ${charName}, it's so nice to meet you, hehe! Do you want to play a game?` });
  }
  function toggleAccessory(name: string) {
    const has = cfg.accessories.includes(name);
    update({ ...cfg, accessories: has ? cfg.accessories.filter((n) => n !== name) : [...cfg.accessories, name] });
  }

  const liveEmotion = preview ?? (busy && !speech?.text ? "thinking" : (emotion ?? "neutral"));
  const liveSpeech = testSpeech ?? speech;

  return (
    <aside className="stage" aria-label={`${charName}'s avatar area`}>
      <h1 className="stage-name">{charName}</h1>
      <p className="stage-feel">{busy ? "typing..." : emotion ? `feeling ${emotion}` : "waiting for you"}</p>

      <div className="avatar-area">
        {status === "ready" && layers.length > 0 ? (
          <Avatar layers={layers} emotion={liveEmotion} speech={liveSpeech} />
        ) : (
          <p className="avatar-msg">
            {status === "loading" ? "Loading her avatar..." : error || "No images found in the avatar folder."}
          </p>
        )}
      </div>

      <details className="dressup">
        <summary>Dress up and test</summary>

        {options && options.accessories.length > 0 && (
          <fieldset>
            <legend>Accessories</legend>
            {options.accessories.map((n) => (
              <label key={n} className="check">
                <input type="checkbox" checked={cfg.accessories.includes(n)} onChange={() => toggleAccessory(n)} />
                <span>{pretty(n)}</span>
              </label>
            ))}
          </fieldset>
        )}

        {options && options.hairstyles.length > 1 && (
          <label className="field">
            <span>Hairstyle</span>
            <select value={cfg.hairstyle} onChange={(e) => update({ ...cfg, hairstyle: e.target.value })}>
              {options.hairstyles.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        )}

        {options && options.outfits.length > 1 && (
          <label className="field">
            <span>Outfit</span>
            <select value={cfg.outfit} onChange={(e) => update({ ...cfg, outfit: e.target.value })}>
              {options.outfits.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        )}

        <fieldset>
          <legend>Preview an emotion</legend>
          <div className="chips">
            {Object.keys(EMOTION_MAP).map((e) => (
              <button key={e} className="chip" onClick={() => showEmotion(e)}>{e}</button>
            ))}
          </div>
        </fieldset>

        <div className="chips">
          <button className="btn" onClick={sayTest} disabled={status !== "ready"}>Test lip sync</button>
          <button className="btn" onClick={reload}>Reload images</button>
        </div>
        {assets && <p className="hint-soft">{assets.files.length} images loaded</p>}
      </details>
    </aside>
  );
}
