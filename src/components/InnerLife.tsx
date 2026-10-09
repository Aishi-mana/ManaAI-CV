import { useState } from "react";
import { ago } from "../core/memory/text";
import type { Stats } from "../core/progress";
import { fillTemplate } from "../core/settings";
import type { Settings } from "../core/settings";
import type { InnerLifeApi } from "../core/persona/useInnerLife";
import { STAGES, TRAIT_LABEL, MAX_DRIFT, stageOf } from "../core/persona/traits";
import { TRAITS } from "../core/persona/types";

type Tab = "mood" | "traits" | "diary";

interface Props {
  api: InnerLifeApi;
  settings: Settings;
  stats: Stats;
  ready: boolean;
  onClose: () => void;
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function InnerLife({ api, settings, stats, ready, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("mood");
  const name = settings.charName || "She";
  const { stage, next } = stageOf(stats.bond);
  const last = api.persona.lastReflectionAt;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="drawer wide" role="dialog" aria-label="Mood and diary">
        <header className="drawer-head">
          <h2>{name}'s inner life</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </header>

        <div className="drawer-body">
          <div className="tabs" role="tablist">
            {(["mood", "traits", "diary"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className="tab" onClick={() => setTab(t)}>
                {t === "mood" ? "Mood" : t === "traits" ? "Personality" : `Diary (${api.diary.length})`}
              </button>
            ))}
          </div>

          {tab === "mood" && (
            <>
              <p className="mood-now">
                {name} feels <b>{fillTemplate(api.moodInfo.phrase, settings)}</b> right now.
              </p>
              <Meter label="Energy" value={api.mood.energy} />
              <Meter label="Mood" value={(api.mood.valence + 1) / 2} />
              <Meter label="Missing you" value={api.mood.lonely} />

              <p className="progress-card">
                Bond: <b>{stage.label}</b> ({Math.floor(stats.bond)}
                {next ? ` / ${next.min} for "${next.label}"` : ""})
              </p>
              <p className="hint-soft">
                Her mood changes quickly: with the time of day, how long you have been away, and how the chat goes.
                The bond only grows, a little for every day you spend together. Stages: {STAGES.map((s) => `${s.label} (${s.min})`).join(", ")}.
              </p>

              <fieldset className="mem-add">
                <legend>Her sleep cycle</legend>
                <p className="hint-soft">
                  {settings.reflectionEnabled
                    ? "When you have been quiet for about 10 minutes after a real conversation, she tidies her memories, writes in her diary, and her personality shifts a tiny bit."
                    : "Automatic reflection is turned off in Settings."}
                  {last ? ` Last time: ${ago(Date.now(), last)}.` : " She hasn't reflected yet."}
                </p>
                <div className="chips">
                  <button className="btn primary" disabled={!ready || api.reflecting} onClick={api.reflectNow}>
                    {api.reflecting ? "Reflecting..." : "Let her rest and reflect now"}
                  </button>
                </div>
                {!ready && <p className="hint-soft">Start the model first.</p>}
                {api.note && <p className="hint-soft">{api.note}</p>}
              </fieldset>
            </>
          )}

          {tab === "traits" && (
            <>
              <p className="hint-soft">
                Set where each trait rests. Over days, how you two talk nudges them, but never more than {MAX_DRIFT} from
                the value you set, and never fast. The sliders are the resting value; "now" includes the drift.
              </p>
              <ul className="traits">
                {TRAITS.map((t) => {
                  const base = api.persona.baseline[t];
                  const drift = api.persona.drift[t];
                  return (
                    <li key={t}>
                      <label className="field">
                        <span>
                          {TRAIT_LABEL[t]}: resting {base.toFixed(2)}, now {api.traits[t].toFixed(2)} ({drift >= 0 ? "+" : ""}
                          {drift.toFixed(2)})
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={base}
                          onChange={(e) => api.changeBaseline(t, Number(e.target.value))}
                          aria-label={`${TRAIT_LABEL[t]} resting value`}
                        />
                      </label>
                      <Meter label="now" value={api.traits[t]} />
                    </li>
                  );
                })}
              </ul>
              <button className="btn" onClick={api.clearDrift}>Reset drift</button>
            </>
          )}

          {tab === "diary" && (
            <ul className="mem-list">
              {api.diary.length === 0 && (
                <li className="hint-soft">
                  Nothing yet. She writes an entry after a day of chatting, or press "Let her rest and reflect now" on the Mood tab.
                </li>
              )}
              {api.diary.map((e) => (
                <li key={e.id} className="mem">
                  <div className="mem-meta">
                    <span>{new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                    <span>{e.mood}</span>
                    {e.emotion && <span>{e.emotion}</span>}
                  </div>
                  <div className="mem-text diary-text">{fillTemplate(e.text, settings)}</div>
                  <div className="chips">
                    <button className="chip" onClick={() => api.deleteEntry(e.id)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
