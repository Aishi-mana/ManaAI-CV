import { useEffect, useState } from "react";
import { BLINK, EMOTION_MAP } from "../core/avatar";
import type { Layer } from "../core/avatar";
import { useLipSync } from "../core/useLipSync";
import type { Speech } from "../core/useLipSync";

interface Props {
  layers: Layer[];
  emotion: string;
  speech: Speech | null;
}

/** The living paper doll: stacked PNG layers + blinking + lip sync + a gentle idle bob. */
export default function Avatar({ layers, emotion, speech }: Props) {
  const [blink, setBlink] = useState<"open" | "half" | "closed">("open");
  const vowel = useLipSync(speech);

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

  return (
    <div className="avatar">
      <div className="avatar-inner">
        {layers.map((l) => {
          if (l.slot === "static") return <img key={l.key} src={l.url} alt="" draggable={false} />;
          const on = l.slot === "eyes" ? l.variant === activeEyes : l.variant === activeMouth;
          // Eyes and mouths are all kept in the page and faded in/out, so swapping never flickers.
          return <img key={l.key} src={l.url} alt="" draggable={false} style={{ opacity: on ? 1 : 0 }} />;
        })}
      </div>
    </div>
  );
}
