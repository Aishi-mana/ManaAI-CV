import { invoke } from "@tauri-apps/api/core";
import mapData from "./avatar-map.json";

export type Vowel = "a" | "e" | "i" | "o" | "u";

export const EMOTION_MAP = mapData.emotions as Record<string, { eyes: string; mouth: string }>;
export const BLINK = mapData.blink as { half: string; closed: string };
const BEHIND_HAIR = (mapData.accessoriesBehindHair as string[]).map((s) => s.toLowerCase());

export interface AvatarAssets {
  /** Relative paths with forward slashes, e.g. "eyes/eye_happy.png" */
  files: string[];
  /** lowercase relative path -> blob URL */
  urls: Map<string, string>;
}

export interface AvatarConfig {
  hairstyle: string;
  outfit: string;
  accessories: string[];
}

export interface AvatarOptions {
  hairstyles: string[];
  outfits: string[];
  accessories: string[];
}

export interface Layer {
  key: string;
  url: string;
  slot: "static" | "eyes" | "mouth";
  /** file name without extension, lowercase (e.g. "eye_happy") */
  variant: string;
}

export const DEFAULT_AVATAR: AvatarConfig = { hairstyle: "default", outfit: "default", accessories: [] };
const CONFIG_KEY = "mana.avatar.v1";

export function loadAvatarConfig(): AvatarConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_AVATAR, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_AVATAR };
}

export function saveAvatarConfig(c: AvatarConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- loading

function mimeFor(rel: string): string {
  const l = rel.toLowerCase();
  if (l.endsWith(".webp")) return "image/webp";
  if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

/** Reads every image in the avatar folder through the Rust side and turns it into a blob URL. */
export async function loadAvatarAssets(dir: string): Promise<AvatarAssets> {
  const files = await invoke<string[]>("scan_avatar", { dir });
  const urls = new Map<string, string>();
  await Promise.all(
    files.map(async (rel) => {
      const data = await invoke<ArrayBuffer | number[]>("read_avatar_image", { dir, rel });
      const bytes = data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
      urls.set(rel.toLowerCase(), URL.createObjectURL(new Blob([bytes], { type: mimeFor(rel) })));
    }),
  );
  return { files, urls };
}

export function revokeAssets(a: AvatarAssets) {
  a.urls.forEach((u) => URL.revokeObjectURL(u));
}

// ---------------------------------------------------------------- layout rules

const stem = (name: string) => name.replace(/\.[^.]+$/, "");
const lastPart = (rel: string) => rel.split("/").pop() ?? rel;
/** "hair_back", "outfit_back" ... go behind the body / other layers */
const isBehind = (rel: string) => /(^|_)back($|_)/i.test(stem(lastPart(rel)));

/** Files directly inside a folder (not in sub-folders), sorted by name. */
function filesIn(a: AvatarAssets, folder: string): string[] {
  const prefix = folder.toLowerCase() + "/";
  return a.files
    .filter((f) => {
      const l = f.toLowerCase();
      return l.startsWith(prefix) && !l.slice(prefix.length).includes("/");
    })
    .sort();
}

export function listOptions(a: AvatarAssets): AvatarOptions {
  const hairstyles = new Set<string>();
  const outfits = new Set<string>();
  const accessories: string[] = [];
  for (const f of a.files) {
    const p = f.split("/");
    const top = p[0].toLowerCase();
    if (top === "hairstyles" && p.length >= 3) hairstyles.add(p[1]);
    else if (top === "outfits" && p.length >= 3) outfits.add(p[1]);
    else if (top === "accessories" && p.length === 2) accessories.push(stem(p[1]));
  }
  return { hairstyles: Array.from(hairstyles), outfits: Array.from(outfits), accessories };
}

/** Makes sure the saved choices still exist in the folder. */
export function normalizeConfig(c: AvatarConfig, o: AvatarOptions): AvatarConfig {
  return {
    hairstyle: o.hairstyles.includes(c.hairstyle) ? c.hairstyle : (o.hairstyles[0] ?? c.hairstyle),
    outfit: o.outfits.includes(c.outfit) ? c.outfit : (o.outfits[0] ?? c.outfit),
    accessories: c.accessories.filter((n) => o.accessories.includes(n)),
  };
}

/**
 * Bottom-to-top draw order:
 *   hair back, outfit back, body, outfit, mouths, eyes,
 *   accessories that sit behind the hair (glasses), hair front + extras (ahoge), other accessories
 */
export function buildLayers(a: AvatarAssets, cfg: AvatarConfig): Layer[] {
  const out: Layer[] = [];
  const add = (rel: string, slot: Layer["slot"] = "static") => {
    const url = a.urls.get(rel.toLowerCase());
    if (url) out.push({ key: rel, url, slot, variant: stem(lastPart(rel)).toLowerCase() });
  };
  const accessoryFile = (name: string) =>
    filesIn(a, "accessories").find((f) => stem(lastPart(f)).toLowerCase() === name.toLowerCase());

  const hair = filesIn(a, `hairstyles/${cfg.hairstyle}`);
  const outfit = filesIn(a, `outfits/${cfg.outfit}`);
  const frontRank = (f: string) => (/front/i.test(lastPart(f)) ? 0 : 1);

  hair.filter(isBehind).forEach((f) => add(f));
  outfit.filter(isBehind).forEach((f) => add(f));
  filesIn(a, "base").forEach((f) => add(f));
  outfit.filter((f) => !isBehind(f)).forEach((f) => add(f));
  filesIn(a, "mouth").forEach((f) => add(f, "mouth"));
  filesIn(a, "eyes").forEach((f) => add(f, "eyes"));

  const behind = cfg.accessories.filter((n) => BEHIND_HAIR.includes(n.toLowerCase()));
  const front = cfg.accessories.filter((n) => !BEHIND_HAIR.includes(n.toLowerCase()));
  behind.forEach((n) => { const f = accessoryFile(n); if (f) add(f); });
  hair.filter((f) => !isBehind(f)).sort((x, y) => frontRank(x) - frontRank(y) || x.localeCompare(y)).forEach((f) => add(f));
  front.forEach((n) => { const f = accessoryFile(n); if (f) add(f); });

  return out;
}

// ---------------------------------------------------------------- lip sync

const VOWELS = "aeiou";

/**
 * Reads the next "mouth beat" from the text she is saying.
 * A vowel shows that vowel's mouth; any run of consonants/spaces/punctuation
 * is one closed-mouth beat, so speech looks like open-close-open-close.
 */
export function nextMouth(text: string, pos: number): { shape: Vowel | null; pos: number } {
  if (pos >= text.length) return { shape: null, pos: text.length };
  const ch = text[pos].toLowerCase();
  if (VOWELS.includes(ch)) return { shape: ch as Vowel, pos: pos + 1 };
  let i = pos;
  while (i < text.length && !VOWELS.includes(text[i].toLowerCase())) i++;
  return { shape: null, pos: i };
}
