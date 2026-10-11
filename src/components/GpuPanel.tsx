import type { GpuApi } from "../core/gpu/useGpu";
import type { Settings } from "../core/settings";

interface Props {
  gpu: GpuApi;
  settings: Settings;
  onClose: () => void;
}

const mb = (n: number) => `${Math.round(n).toLocaleString()} MB`;
const gb = (n: number) => `${(n / 1024).toFixed(1)} GB`;

const STATE_LABEL: Record<string, string> = {
  loaded: "Loaded",
  loading: "Loading...",
  unloading: "Unloading...",
  unloaded: "Not loaded",
  error: "Problem",
};

export default function GpuPanel({ gpu, settings, onClose }: Props) {
  const { snapshot: snap, info, infoError, advice, swap, swaps } = gpu;
  const usedPct = info ? Math.min(100, Math.round((info.usedMb / info.totalMb) * 100)) : 0;
  const last = swaps[swaps.length - 1];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="drawer wide" role="dialog" aria-label="GPU">
        <header className="drawer-head">
          <h2>GPU and memory</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </header>

        <div className="drawer-body">
          <p className="hint-soft">
            Your graphics card has a limited amount of memory (VRAM). The chat model, and later her voice and drawing, can't all fit
            at once, so this decides who is loaded and swaps them when needed. She is never cut off in the middle of a reply.
          </p>

          <h3>{info ? info.name : "Graphics card"}</h3>
          {info ? (
            <>
              <div className="vram" title={`${usedPct}% used`}>
                <i style={{ width: `${usedPct}%` }} />
              </div>
              <p className="hint-soft">
                {mb(info.usedMb)} used of {mb(info.totalMb)} ({mb(info.freeMb)} free). {mb(settings.gpuReserveMB)} is always kept free for Windows
                and other programs (change it in Settings).
              </p>
            </>
          ) : (
            <p className="hint-soft">
              Can't read the GPU{infoError ? ` (${infoError})` : ""}. The scheduler uses your settings instead of live numbers.
            </p>
          )}

          <h3>Loaded now</h3>
          <ul className="mem-list">
            {snap?.residents.map((r) => (
              <li key={r.id} className="mem">
                <div className="mem-text">{r.name}</div>
                <div className="mem-meta">
                  <span className={`badge ${r.state === "loaded" ? "" : "faint"}`}>{STATE_LABEL[r.state] ?? r.state}</span>
                  <span>about {gb(r.vramMB)}</span>
                  {r.leases > 0 && <span>in use</span>}
                  {r.evicted && <span>will come back</span>}
                </div>
                {r.error && <div className="msg-error">{r.error}</div>}
              </li>
            ))}
            {snap && snap.residents.length === 0 && <li className="hint-soft">Nothing registered.</li>}
          </ul>
          {snap && snap.queue.length > 0 && (
            <p className="hint-soft">Waiting: {snap.queue.map((q) => q.label).join(", ")}</p>
          )}

          <h3>What fits together</h3>
          <p className="hint-soft">
            Based on your chat model (about {gb(snap?.residents.find((r) => r.id === "chat")?.vramMB ?? 0)}) and{" "}
            {gb(snap?.usableMB ?? 0)} of usable memory. Sizes for the upcoming features are typical values.
          </p>
          <ul className="mem-list">
            {advice.map((a) => (
              <li key={a.id} className={`mem${a.fits ? "" : " faint"}`}>
                <div className="mem-text">
                  {a.name} <span className="soft">(about {gb(a.mb)})</span>
                </div>
                <div className="mem-meta">
                  <span className={`badge ${a.fits ? "" : "faint"}`}>{a.fits ? "Fits" : "Doesn't fit"}</span>
                </div>
                <div className="hint-soft">{a.summary}</div>
              </li>
            ))}
          </ul>

          <h3>Swap test</h3>
          <fieldset className="mem-add">
            <legend>How long does a swap take on this PC?</legend>
            <p className="hint-soft">
              Parks the chat model for a few seconds, like it would for drawing, then brings it back. She is unavailable for the
              whole test (usually under a minute). Nothing is drawn, it only measures.
            </p>
            <div className="chips">
              <button className="btn primary" disabled={swap.running} onClick={gpu.swapTest}>
                {swap.running ? "Testing..." : "Run swap test"}
              </button>
            </div>
            {swap.message && <p className="hint-soft">{swap.message}</p>}
            {last && !swap.message && (
              <p className="hint-soft">
                Last test: parking {last.parkSec.toFixed(1)} s, bringing her back {last.reloadSec.toFixed(1)} s.
              </p>
            )}
          </fieldset>

          {snap && snap.log.length > 0 && (
            <>
              <h3>Recent activity</h3>
              <ul className="gpu-log">
                {[...snap.log].reverse().slice(0, 8).map((l) => (
                  <li key={l.at + l.text}>
                    <span className="soft">{new Date(l.at).toLocaleTimeString()}</span> {l.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </>
  );
}
