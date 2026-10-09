export const TRAITS = ["cheerfulness", "shyness", "clinginess", "curiosity", "sass"] as const;
export type Trait = (typeof TRAITS)[number];
export type TraitMap = Record<Trait, number>;

/** How she feels right now. valence -1 (sad) .. 1 (happy); the others 0..1. */
export interface Mood {
  valence: number;
  energy: number;
  lonely: number;
  worry: number;
  at: number;
}

export interface Persona {
  version: 1;
  /** where each trait rests (you can change these) */
  baseline: TraitMap;
  /** how far each trait has drifted from its baseline (limited to +/- 0.2) */
  drift: TraitMap;
  mood: Mood;
  lastChatAt: number | null;
  lastReflectionAt: number | null;
}

export interface DiaryEntry {
  id: string;
  at: number;
  /** uses {{user}} / {{char}} placeholders */
  text: string;
  emotion: string | null;
  mood: string;
}

export interface DiaryFile {
  version: 1;
  entries: DiaryEntry[];
}

/** What happened since her last reflection. */
export interface DayStats {
  userMessages: number;
  tags: Record<string, number>;
  /** the longest silence (hours) before one of your messages */
  maxGapHours: number;
  /** you talked about coding or games */
  practice: boolean;
}
