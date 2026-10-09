/** Embedding helpers: compact storage (base64 float32), cosine similarity, and the llama-server call. */

export function normalize(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length);
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const n = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function encodeVec(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(bin);
}

const decoded = new Map<string, Float32Array>();

export function decodeVec(s: string): Float32Array {
  const hit = decoded.get(s);
  if (hit) return hit;
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const v = new Float32Array(bytes.buffer);
  if (decoded.size > 20_000) decoded.clear();
  decoded.set(s, v);
  return v;
}

/** Cosine similarity of two normalized vectors (just the dot product). */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Identifies which embedding model made a vector (the file name), so vectors from different models are never mixed. */
export function vecModelId(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Asks the embedding llama-server for vectors. Returns null if it isn't available. */
export async function embedTexts(port: number, texts: string[], timeoutMs = 4000): Promise<Float32Array[] | null> {
  if (!texts.length) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ input: texts, model: "embed" }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rows = json?.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) return null;
    const sorted = [...rows].sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((r: { embedding: number[] }) => normalize(r.embedding));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
