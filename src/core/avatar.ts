import { invoke } from "@tauri-apps/api/core";
import mapData from "./avatar-map.json";
import type { ItemCatalog } from "./progress";

export type Vowel = "a" | "e" | "i" | "o" | "u";

export const EMOTION_MAP = mapData.emotions as Record<string, { eyes: string; mouth: string }>;
export const BLINK = mapData.blink as { half: string; closed: string };
export const VIEWS = mapData.views as Record<string, { label: string; scale: number; y: number }>;

/** Accessory depths, bottom to top. */
export const SLOTS = ["back", "behind-body", "behind-front-hair", "top"] as const;
export type AccessorySlot = (typeof SLOTS)[number];
const SLOT_OVERRIDE = (mapData.accessorySlots ?? {}) as Record<string, string>;
const isSlot = (s: string): s is AccessorySlot => (SLOTS as readonly string[]).includes(s);

export interface AvatarAssets {
  /** Relative paths with forward slashes, e.g. "eyes/eye_happy.png" */
  files: string[];
  /** lowercase relative path -> blob URL */
  urls: Map<string, string>;
  /** from items.json (names and unlock rules); empty if the file doesn't exist */
  items: ItemCatalog;
  itemsError?: string;
}

export interface AvatarConfig {
  skin: string;
  hairstyle: string;
  outfit: string;
  accessories: string[];
  view: string;
}

export interface Accessory {
  name: string;
  rel: string;
  slot: AccessorySlot;
}

export interface AvatarOptions {
  skins: string[];
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

export const DEFAULT_AVATAR: AvatarConfig = { skin: "default", hairstyle: "default", outfit: "default", accessories: [], view: "full" };
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

/** Reads every image (and items.json) in the avatar folder through the Rust side. */
export async function loadAvatarAssets(dir: string): Promise<AvatarAssets> {
  const files = await invoke<string[]>("scan_avatar", { dir });
  const urls = new Map<string, string>();
  let items: ItemCatalog = {};
  let itemsError: string | undefined;
  await Promise.all(
    files.map(async (rel) => {
      const data = await invoke<ArrayBuffer | number[]>("read_avatar_image", { dir, rel });
      const bytes = data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
      if (rel.toLowerCase() === "items.json") {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bytes));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) items = parsed as ItemCatalog;
          else itemsError = "items.json must be an object like { \"outfits/summer\": { ... } }";
        } catch (e) {
          itemsError = `items.json could not be read: ${e}`;
        }
        return;
      }
      urls.set(rel.toLowerCase(), URL.createObjectURL(new Blob([bytes], { type: mimeFor(rel) })));
    }),
  );
  return { files: files.filter((f) => f.toLowerCase() !== "items.json"), urls, items, itemsError };
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

/**
 * Every accessory with the depth it sits at. A depth comes from, in order:
 * the accessorySlots table in avatar-map.json, the sub-folder it lives in
 * (accessories/behind-body/wings.png), or "top".
 */
export function listAccessories(a: AvatarAssets): Accessory[] {
  const out: Accessory[] = [];
  for (const rel of a.files) {
    const p = rel.split("/");
    if (p[0].toLowerCase() !== "accessories") continue;
    let folderSlot: AccessorySlot | undefined;
    if (p.length === 3) {
      const f = p[1].toLowerCase();
      if (!isSlot(f)) continue; // unknown sub-folder: ignore
      folderSlot = f;
    } else if (p.length !== 2) {
      continue;
    }
    const name = stem(p[p.length - 1]);
    const override = SLOT_OVERRIDE[name.toLowerCase()];
    const slot: AccessorySlot = override && isSlot(override) ? override : (folderSlot ?? "top");
    out.push({ name, rel, slot });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

export function listOptions(a: AvatarAssets): AvatarOptions {
  const skins = new Set<string>();
  const hairstyles = new Set<string>();
  const outfits = new Set<string>();
  for (const f of a.files) {
    const p = f.split("/");
    const top = p[0].toLowerCase();
    if (top === "base") {
      if (p.length === 2) skins.add("default"); // loose files in base/ are the default skin
      else if (p.length >= 3) skins.add(p[1]);
    } else if (top === "hairstyles" && p.length >= 3) hairstyles.add(p[1]);
    else if (top === "outfits" && p.length >= 3) outfits.add(p[1]);
  }
  return {
    skins: Array.from(skins),
    hairstyles: Array.from(hairstyles),
    outfits: Array.from(outfits),
    accessories: listAccessories(a).map((x) => x.name),
  };
}

/** Files of one skin. "default" is the loose files in base/ (or base/default/). */
export function skinFiles(a: AvatarAssets, skin: string): string[] {
  if (skin.toLowerCase() === "default") return [...filesIn(a, "base"), ...filesIn(a, "base/default")];
  return filesIn(a, `base/${skin}`);
}

/**
 * Her body and outfit are required. If either is missing she is not drawn at all
 * (instead of being drawn bare), and this explains why.
 */
export function requiredProblem(a: AvatarAssets, cfg: AvatarConfig): string | null {
  if (skinFiles(a, cfg.skin).length === 0) return `Her base body is missing (looked for base/${cfg.skin === "default" ? "body.png" : cfg.skin}). I won't draw her without it.`;
  if (filesIn(a, `outfits/${cfg.outfit}`).length === 0) return `Her outfit is missing (expected outfits/${cfg.outfit}/outfit.png), so I won't draw her.`;
  return null;
}

/**
 * Bottom-to-top draw order:
 *   [back accessories] hair back, [behind-body accessories], outfit back, body, outfit,
 *   mouths, eyes, [behind-front-hair accessories], hair front + extras (ahoge), [top accessories]
 */
export function buildLayers(a: AvatarAssets, cfg: AvatarConfig): Layer[] {
  if (requiredProblem(a, cfg)) return [];
  const out: Layer[] = [];
  const add = (rel: string, slot: Layer["slot"] = "static") => {
    const url = a.urls.get(rel.toLowerCase());
    if (url) out.push({ key: rel, url, slot, variant: stem(lastPart(rel)).toLowerCase() });
  };
  const chosen = listAccessories(a).filter((x) => cfg.accessories.includes(x.name));
  const addAccessories = (slot: AccessorySlot) => chosen.filter((x) => x.slot === slot).forEach((x) => add(x.rel));

  const hair = filesIn(a, `hairstyles/${cfg.hairstyle}`);
  const outfit = filesIn(a, `outfits/${cfg.outfit}`);
  const frontRank = (f: string) => (/front/i.test(lastPart(f)) ? 0 : 1);

  addAccessories("back");
  hair.filter(isBehind).forEach((f) => add(f));
  addAccessories("behind-body");
  outfit.filter(isBehind).forEach((f) => add(f));
  skinFiles(a, cfg.skin).forEach((f) => add(f));
  outfit.filter((f) => !isBehind(f)).forEach((f) => add(f));
  filesIn(a, "mouth").forEach((f) => add(f, "mouth"));
  filesIn(a, "eyes").forEach((f) => add(f, "eyes"));
  addAccessories("behind-front-hair");
  hair
    .filter((f) => !isBehind(f))
    .sort((x, y) => frontRank(x) - frontRank(y) || x.localeCompare(y))
    .forEach((f) => add(f));
  addAccessories("top");

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
