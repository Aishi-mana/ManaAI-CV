import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "./Avatar";
import { EMOTION_MAP, VIEWS, buildLayers, requiredProblem } from "../core/avatar";
import type { AvatarConfig } from "../core/avatar";
import { uid } from "../core/types";
import type { AvatarState } from "../core/useAvatar";
import type { Speech } from "../core/useLipSync";

interface Props {
  charName: string;
  emotion: string | null;
  busy: boolean;
  /** she asked you something and is waiting for your answer */
  waiting?: boolean;
  speech: Speech | null;
  avatar: AvatarState;
  cfg: AvatarConfig;
  onCfg: (c: AvatarConfig) => void;
  onOpenWardrobe: () => void;
}

export default function StagePanel({ charName, emotion, busy, waiting, speech, avatar, cfg, onCfg, onOpenWardrobe }: Props) {
  const { assets, status, error, reload } = avatar;
  const layers = useMemo(() => (assets ? buildLayers(assets, cfg) : []), [assets, cfg]);
  const problem = assets ? requiredProblem(assets, cfg) : null;

  // Zoom: a preset (full / half / bust) or a custom scale from the mouse wheel.
  const [view, setView] = useState(() => {
    const v = VIEWS[cfg.view] ?? VIEWS.full;
    return { scale: v.scale, y: v.y };
  });
  const activeView = Object.keys(VIEWS).find((k) => VIEWS[k].scale === view.scale && VIEWS[k].y === view.y);

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

  function pickView(key: string) {
    const v = VIEWS[key];
    if (!v) return;
    setView({ scale: v.scale, y: v.y });
    onCfg({ ...cfg, view: key });
  }
  function wheelZoom(deltaY: number) {
    setView((v) => {
      const next = v.scale * (deltaY < 0 ? 1.1 : 1 / 1.1);
      return { ...v, scale: Math.min(5, Math.max(1, Math.round(next * 1000) / 1000)) };
    });
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

  const liveEmotion = preview ?? (busy && !speech?.text ? "thinking" : (emotion ?? "neutral"));
  const liveSpeech = testSpeech ?? speech;

  return (
    <aside className="stage" aria-label={`${charName}'s avatar area`}>
      <h1 className="stage-name">{charName}</h1>
      <p className="stage-feel">{busy ? "typing..." : waiting ? "waiting for your answer..." : emotion ? `feeling ${emotion}` : "waiting for you"}</p>

      <div className="avatar-area">
        {status === "ready" && !problem && layers.length > 0 ? (
          <Avatar layers={layers} emotion={liveEmotion} speech={liveSpeech} view={view} onWheelZoom={wheelZoom} />
        ) : (
          <p className="avatar-msg">
            {status === "loading" ? "Loading her avatar..." : problem || error || "No images found in the avatar folder."}
          </p>
        )}
      </div>

      <div className="views" role="group" aria-label="Avatar view">
        {Object.keys(VIEWS).map((k) => (
          <button key={k} className="chip" aria-pressed={activeView === k} onClick={() => pickView(k)}>
            {VIEWS[k].label}
          </button>
        ))}
        <button className="chip" onClick={onOpenWardrobe} disabled={!assets}>Wardrobe</button>
      </div>

      <details className="dressup">
        <summary>Test</summary>
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
