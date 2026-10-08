import { useEffect, useRef, useState } from "react";
import { nextMouth } from "./avatar";
import type { Vowel } from "./avatar";

export interface Speech {
  id: string;
  text: string;
}

const TICK_MS = 95;

/**
 * Returns the vowel mouth to show right now (or null = closed/rest mouth).
 * She "speaks" a reply at a steady pace after it appears. Messages that were
 * already there when the app opened are not replayed.
 */
export function useLipSync(speech: Speech | null): Vowel | null {
  const [shape, setShape] = useState<Vowel | null>(null);
  const textRef = useRef("");
  const idRef = useRef<string | null>(null);
  const posRef = useRef(0);
  const mountedRef = useRef(false);

  if (speech) {
    if (idRef.current !== speech.id) {
      idRef.current = speech.id;
      posRef.current = mountedRef.current ? 0 : speech.text.length;
    }
    textRef.current = speech.text;
  } else {
    textRef.current = "";
  }

  useEffect(() => {
    mountedRef.current = true;
    const timer = window.setInterval(() => {
      const r = nextMouth(textRef.current, posRef.current);
      posRef.current = r.pos;
      setShape(r.shape);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return shape;
}
