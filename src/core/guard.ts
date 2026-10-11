/**
 * Catches a model that gets stuck in a loop ("Manaaaaaaaaa...", "hey hey hey hey ...") and trims the loop
 * down to a short natural-looking start.
 */

export interface Trimmed {
  text: string;
  /** a loop was found (and cut) */
  runaway: boolean;
}

const CHAR_RUN = /(\S)\1{11,}/u; // aaaaaaaaaaaa (12+ in a row; a cute "yaaaay" is fine)
const WORD_RUN = /([\p{L}\p{N}']{1,16})(?:[\s,.!?~-]+\1(?![\p{L}\p{N}']))\1?(?:[\s,.!?~-]+\1(?![\p{L}\p{N}'])){5,}/iu; // hey hey hey hey hey hey hey
const SHORT_RUN = /(\p{L}{2,3})\1{9,}/u; // hahahahahahahahahaha (10+)
const PHRASE_RUN = /(.{4,40}?)\1{4,}/su; // the same phrase 5+ times

export function trimRunaway(text: string): Trimmed {
  let index = -1;
  let keep = 0;
  const found = (i: number, k: number) => {
    if (index < 0 || i < index) {
      index = i;
      keep = k;
    }
  };

  const c = CHAR_RUN.exec(text);
  if (c) found(c.index, 3);

  const w = WORD_RUN.exec(text);
  if (w) {
    const word = w[1];
    const sep = w[0].slice(word.length).match(/^[\s,.!?~-]+/)?.[0] ?? " ";
    found(w.index, word.length * 2 + sep.length);
  }

  const s = SHORT_RUN.exec(text);
  if (s) found(s.index, s[1].length * 3);

  const p = PHRASE_RUN.exec(text);
  if (p) found(p.index, p[1].length * 2);

  if (index < 0) return { text, runaway: false };
  return { text: text.slice(0, index + keep).trimEnd(), runaway: true };
}

export const findRunaway = (text: string): boolean => trimRunaway(text).runaway;
