const STOP = (
  "a an the and or but if so of to in on at by for with from as is are was were be been am do does did have has had " +
  "i me my mine you your yours we our us it its this that these those he she they them his her their what which who " +
  "how when where why can could will would should shall may might just not no yes ok okay oh hey hi hello please " +
  "really very also too then than there here about into out up down over again still more some any all lol hehe " +
  "haha today yesterday tomorrow now like get got going go want wanna gonna don didn doesn isn wasn won ll ve re " +
  "let one thing things say said tell told"
).split(/\s+/);

function stem(w: string): string {
  let s = w;
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

const STOP_STEMS = new Set(STOP.map(stem));

/** Lowercase, split into words, drop filler words, and trim endings (likes/liked/liking -> lik). */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\{\{(user|char)\}\}/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1)
    .map(stem)
    .filter((w) => w.length > 1 && !STOP_STEMS.has(w));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * How well each doc matches the query by shared (rare-word-weighted) words, 0-1.
 * 60% = how much of the query the doc covers, 40% = how much of the doc the query covers.
 */
export function keywordRel(query: string, docs: string[]): number[] {
  const q = Array.from(new Set(tokens(query)));
  const dtoks = docs.map((d) => new Set(tokens(d)));
  const N = docs.length;
  if (!q.length || !N) return docs.map(() => 0);

  const df = new Map<string, number>();
  for (const set of dtoks) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => {
    const n = df.get(t) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  // words that appear in no memory at all shouldn't count against a match
  const known = q.filter((t) => df.has(t));
  const qMass = known.reduce((a, t) => a + idf(t), 0);
  const qSet = new Set(q);

  return dtoks.map((set) => {
    if (!known.length || set.size === 0) return 0;
    let matched = 0;
    for (const t of known) if (set.has(t)) matched += idf(t);
    if (matched === 0) return 0;
    let dMass = 0;
    let dMatched = 0;
    for (const t of set) {
      const w = idf(t);
      dMass += w;
      if (qSet.has(t)) dMatched += w;
    }
    return 0.6 * (matched / qMass) + 0.4 * (dMatched / dMass);
  });
}

/** "3 days ago", "yesterday", "2 months ago" ... */
export function ago(now: number, then: number): string {
  const min = Math.floor((now - then) / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  const y = Math.round(d / 365);
  return y <= 1 ? "about a year ago" : `${y} years ago`;
}
