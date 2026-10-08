import { VIEWS, listAccessories, listOptions } from "./avatar";
import type { AccessorySlot, AvatarAssets, AvatarConfig } from "./avatar";
import { hintFor, isUnlocked } from "./progress";
import type { Stats } from "./progress";

export interface Entry {
  /** e.g. "outfits/summer" */
  id: string;
  name: string;
  label: string;
  unlocked: boolean;
  hint: string;
  isDefault: boolean;
  slot?: AccessorySlot;
}

export interface Wardrobe {
  skins: Entry[];
  outfits: Entry[];
  hairs: Entry[];
  accessories: Entry[];
}

const pretty = (s: string) => s.replace(/_/g, " ");

export function allItemIds(a: AvatarAssets): string[] {
  const o = listOptions(a);
  return [
    ...o.skins.map((n) => `base/${n}`),
    ...o.outfits.map((n) => `outfits/${n}`),
    ...o.hairstyles.map((n) => `hairstyles/${n}`),
    ...listAccessories(a).map((x) => `accessories/${x.name}`),
  ];
}

export function itemLabel(a: AvatarAssets, id: string): string {
  return a.items[id]?.name ?? pretty(id.split("/").pop() ?? id);
}

export function buildWardrobe(a: AvatarAssets, stats: Stats, now: Date, who: string): Wardrobe {
  const mk = (prefix: string, name: string, slot?: AccessorySlot): Entry => {
    const id = `${prefix}/${name}`;
    const unlocked = isUnlocked(id, a.items, stats, now);
    return {
      id,
      name,
      label: itemLabel(a, id),
      unlocked,
      hint: unlocked ? "" : hintFor(id, a.items, stats, now, who),
      isDefault: name === "default",
      slot,
    };
  };
  const order = (list: Entry[]) =>
    list.sort((x, y) => Number(y.isDefault) - Number(x.isDefault) || x.label.localeCompare(y.label));
  const o = listOptions(a);
  return {
    skins: order(o.skins.map((n) => mk("base", n))),
    outfits: order(o.outfits.map((n) => mk("outfits", n))),
    hairs: order(o.hairstyles.map((n) => mk("hairstyles", n))),
    accessories: order(listAccessories(a).map((x) => mk("accessories", x.name, x.slot))),
  };
}

/** Skin, outfit and hairstyle can never be empty or locked: fall back to the default. */
function pickRequired(list: Entry[], want: string): string {
  const exact = list.find((e) => e.name === want && e.unlocked);
  if (exact) return exact.name;
  const def = list.find((e) => e.isDefault);
  if (def) return def.name;
  return list.find((e) => e.unlocked)?.name ?? want;
}

/**
 * The one place the loadout rules are enforced. Whatever is saved (even a hand-edited
 * file, a deleted folder, or a still-locked item), the result always has a skin, an
 * outfit and a hairstyle, and only unlocked accessories.
 */
export function resolveLoadout(saved: AvatarConfig, w: Wardrobe): AvatarConfig {
  return {
    skin: pickRequired(w.skins, saved.skin),
    outfit: pickRequired(w.outfits, saved.outfit),
    hairstyle: pickRequired(w.hairs, saved.hairstyle),
    accessories: saved.accessories.filter((n) => w.accessories.some((e) => e.name === n && e.unlocked)),
    view: VIEWS[saved.view] ? saved.view : "full",
  };
}
