import { useMemo, useState } from "react";
import { FAINT_BELOW, retrievability } from "../core/memory/strength";
import { ago } from "../core/memory/text";
import type { Memory } from "../core/memory/types";
import type { MemoryApi } from "../core/memory/useMemory";
import { fillTemplate } from "../core/settings";
import type { Settings } from "../core/settings";
import { vecModelId } from "../core/memory/vectors";

type Filter = "all" | "pinned" | "fading" | "faint";
type Row = { m: Memory; r: number };

interface Props {
  api: MemoryApi;
  settings: Settings;
  embedReady: boolean;
  onClose: () => void;
}

export default function MemoryViewer({ api, settings, embedReady, onClose }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftImp, setDraftImp] = useState(5);
  const [newText, setNewText] = useState("");
  const [newImp, setNewImp] = useState(7);
  const [newPinned, setNewPinned] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);

  const now = Date.now();
  const model = vecModelId(settings.embedPath);
  const indexed = api.memories.filter((m) => m.vec && m.vecModel === model).length;
  const name = settings.charName || "Her";

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return api.memories
      .map((m: Memory): Row => ({ m, r: retrievability(m, Date.now()) }))
      .filter(({ m, r }: Row) => {
        if (filter === "pinned" && !m.pinned) return false;
        if (filter === "fading" && (m.pinned || r >= 0.5 || r < FAINT_BELOW)) return false;
        if (filter === "faint" && (m.pinned || r >= FAINT_BELOW)) return false;
        return !q || fillTemplate(m.text, settings).toLowerCase().includes(q);
      })
      .sort((a: Row, b: Row) => Number(b.m.pinned) - Number(a.m.pinned) || b.m.created - a.m.created);
  }, [api.memories, filter, search, settings]);

  const pinnedCount = api.memories.filter((m) => m.pinned).length;
  const faintCount = api.memories.filter((m) => !m.pinned && retrievability(m, now) < FAINT_BELOW).length;

  function startEdit(m: Memory) {
    setEditing(m.id);
    setDraft(fillTemplate(m.text, settings));
    setDraftImp(m.importance);
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="drawer wide" role="dialog" aria-label="Memories">
        <header className="drawer-head">
          <h2>{name}'s memories</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </header>

        <div className="drawer-body">
          <p className="progress-card">
            <b>{api.memories.length}</b> memories &middot; <b>{pinnedCount}</b> pinned &middot; <b>{faintCount}</b> faint
            {api.extracting && <em className="soft"> &middot; writing new ones...</em>}
          </p>
          <p className="hint-soft">
            {settings.embedPath
              ? embedReady
                ? `Searching by meaning is on (${indexed} of ${api.memories.length} indexed${api.indexing ? ", indexing..." : ""}).`
                : "Waiting for the embedding model to start (press Start model). Until then it uses keyword matching."
              : "Searching by keywords only. Add an embedding model in Settings to search by meaning."}
          </p>
          {!settings.memoryEnabled && <p className="msg-error">Memory is turned off in Settings, so nothing new is being remembered.</p>}

          <fieldset className="mem-add">
            <legend>Tell {name} something to remember</legend>
            <textarea
              rows={2}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder={`For example: ${settings.userName}'s birthday is in March.`}
            />
            <div className="chips">
              <label className="field inline">
                <span>Importance</span>
                <select value={newImp} onChange={(e) => setNewImp(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={newPinned} onChange={(e) => setNewPinned(e.target.checked)} />
                <span>Always remember (pin)</span>
              </label>
              <button
                className="btn primary"
                disabled={!newText.trim()}
                onClick={() => {
                  api.addManual(newText, newImp, newPinned);
                  setNewText("");
                  setNewPinned(false);
                }}
              >
                Add
              </button>
            </div>
          </fieldset>

          {api.lastRecall.length > 0 && (
            <fieldset className="mem-add">
              <legend>Came to mind for the last message</legend>
              <ul className="mem-recalled">
                {api.lastRecall.map((r) => (
                  <li key={r.memory.id}>
                    {fillTemplate(r.memory.text, settings)}
                    <span className="soft"> (match {r.rel.toFixed(2)}, score {r.score.toFixed(2)}{r.vague ? ", vague" : ""})</span>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <div className="mem-tools">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search memories" aria-label="Search memories" />
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show">
              <option value="all">All</option>
              <option value="pinned">Pinned</option>
              <option value="fading">Fading</option>
              <option value="faint">Faint</option>
            </select>
          </div>

          <ul className="mem-list">
            {rows.length === 0 && <li className="hint-soft">Nothing here yet. Memories appear as you chat.</li>}
            {rows.map(({ m, r }: Row) => {
              const faint = !m.pinned && r < FAINT_BELOW;
              const pct = Math.round(r * 100);
              return (
                <li key={m.id} className={`mem${faint ? " faint" : ""}`}>
                  {editing === m.id ? (
                    <>
                      <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
                      <div className="chips">
                        <label className="field inline">
                          <span>Importance</span>
                          <select value={draftImp} onChange={(e) => setDraftImp(Number(e.target.value))}>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n}>{n}</option>)}
                          </select>
                        </label>
                        <button
                          className="btn primary"
                          onClick={() => {
                            api.edit(m.id, { text: draft, importance: draftImp });
                            setEditing(null);
                          }}
                        >
                          Save
                        </button>
                        <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mem-text">{fillTemplate(m.text, settings)}</div>
                      <div className="mem-meta">
                        {m.pinned && <span className="badge">pinned</span>}
                        <span>{m.emotion}</span>
                        <span>importance {m.importance}/10</span>
                        <span>{ago(now, m.created)}</span>
                        <span>recalled {m.recallCount}x</span>
                        {faint && <span className="badge faint">faint</span>}
                      </div>
                      <div className="bar" title={m.pinned ? "Pinned: never fades" : `${pct}% strong`}>
                        <i style={{ width: `${pct}%` }} />
                      </div>
                      <div className="chips">
                        <button className="chip" onClick={() => api.togglePin(m.id)}>{m.pinned ? "Unpin" : "Pin"}</button>
                        <button className="chip" onClick={() => startEdit(m)}>Edit</button>
                        <button className="chip" onClick={() => api.remove(m.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {api.memories.length > 0 && (
            <div className="danger-zone">
              {confirmForget ? (
                <>
                  <span>Forget all {api.memories.length} memories, including pinned ones?</span>
                  <button className="btn" onClick={() => { api.clearAll(); setConfirmForget(false); }}>Yes, forget everything</button>
                  <button className="btn" onClick={() => setConfirmForget(false)}>No</button>
                </>
              ) : (
                <button className="btn" onClick={() => setConfirmForget(true)}>Forget everything</button>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
