import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { inTauri } from "../env";

/** A short, soft two-note chime made with the browser's audio (no sound files needed). */
export function playChime() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    [
      [660, 0],
      [880, 0.15],
    ].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.1, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.45);
    });
    window.setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* sound is optional */
  }
}

/** Flashes the taskbar button if the window isn't in front, so you notice she wrote. */
export async function flashTaskbar() {
  if (!inTauri || document.hasFocus()) return;
  try {
    await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
  } catch {
    /* optional */
  }
}
