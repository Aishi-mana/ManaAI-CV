import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Msg } from "../core/types";
import { cleanReply } from "../core/emotion";

interface Props {
  messages: Msg[];
  busy: boolean;
  ready: boolean;
  charName: string;
  onSend: (text: string) => void;
  onStop: () => void;
  /** you are typing (so she won't interrupt) */
  onActivity?: () => void;
}

export default function ChatPanel({ messages, busy, ready, charName, onSend, onStop, onActivity }: Props) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function submit() {
    const text = draft.trim();
    if (!text || busy || !ready) return;
    setDraft("");
    onSend(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <>
      <div className="messages" role="log" aria-live="polite">
        {messages.length === 0 && (
          <p className="empty">
            {ready
              ? `Say hi to ${charName}.`
              : "Start the model with the button above, then say hi."}
          </p>
        )}

        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="row me">
                <div className="bubble me">{m.content}</div>
              </div>
            );
          }
          const { text, emotion } = cleanReply(m.content);
          const waiting = busy && !text && !m.error;
          return (
            <div key={m.id} className="row mana">
              <div className="bubble mana">
                {waiting ? (
                  <span className="dots" aria-label={`${charName} is typing`}>
                    <i /> <i /> <i />
                  </span>
                ) : (
                  text
                )}
                {m.error && <div className="msg-error">{m.error}</div>}
              </div>
              {emotion && !busy && <span className="tag">{emotion}</span>}
              {m.initiative && <span className="tag">{charName} started this</span>}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onActivity?.();
          }}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={ready ? `Message ${charName}  (Enter to send, Shift+Enter for a new line)` : "The model is not running yet"}
          aria-label="Message"
        />
        {busy ? (
          <button className="btn" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="btn primary" onClick={submit} disabled={!ready || !draft.trim()}>
            Send
          </button>
        )}
      </div>
    </>
  );
}
