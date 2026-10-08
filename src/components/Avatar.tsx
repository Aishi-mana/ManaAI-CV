import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { BLINK, EMOTION_MAP } from "../core/avatar";
import type { Layer } from "../core/avatar";
import { useLipSync } from "../core/useLipSync";
import type { Speech } from "../core/useLipSync";

interface Props {
  layers: Layer[];
  emotion: string;
  speech: Speech | null;
  view: { scale: number; y: number };
  onWheelZoom: (deltaY: number) => void;
}

/** The living paper doll: stacked PNG layers + blinking + lip sync + idle bob + zoomable view. */
export default function Avatar({ layers, emotion, speech, view, onWheelZoom }: Props) {
  const [blink, setBlink] = useState<"open" | "half" | "closed">("open");
  const [ratio, setRatio] = useState(0.66);
  const vowel = useLipSync(speech);

  // Match the display box to the canvas shape so zooming lines up with the picture.
  const firstUrl = layers[0]?.url;
  useEffect(() => {
    if (!firstUrl) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
    };
    img.src = firstUrl;
  }, [firstUrl]);

  useEffect(() => {
    let alive = true;
    const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
    (async () => {
      while (alive) {
        await sleep(3000 + Math.random() * 3500);
        if (!alive) break;
        setBlink("half");
        await sleep(60);
        setBlink("closed");
        await sleep(90);
        setBlink("half");
        await sleep(60);
        setBlink("open");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const look = EMOTION_MAP[emotion] ?? EMOTION_MAP.neutral;
  const activeEyes = blink === "closed" ? BLINK.closed : blink === "half" ? BLINK.half : look.eyes;
  const activeMouth = vowel ? `mouth_${vowel}` : look.mouth;

  const fitStyle = { "--ratio": ratio } as CSSProperties;
  const zoomStyle = { "--vs": view.scale, "--vy": `${view.y}%` } as CSSProperties;

  return (
    <div className="avatar" onWheel={(e) => onWheelZoom(e.deltaY)} title="Scroll to zoom">
      <div className="avatar-fit" style={fitStyle}>
        <div className="avatar-zoom" style={zoomStyle}>
          <div className="avatar-inner">
            {layers.map((l) => {
              if (l.slot === "static") return <img key={l.key} src={l.url} alt="" draggable={false} />;
              const on = l.slot === "eyes" ? l.variant === activeEyes : l.variant === activeMouth;
              // Eyes and mouths are all kept in the page and faded in/out, so swapping never flickers.
              return <img key={l.key} src={l.url} alt="" draggable={false} style={{ opacity: on ? 1 : 0 }} />;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
