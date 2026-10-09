import { getData, setData } from "./persist";
import type { Msg } from "./types";

export interface Settings {
  exePath: string;
  modelPath: string;
  port: number;
  ctxSize: number;
  gpuLayers: number;
  temperature: number;
  autoStart: boolean;
  userName: string;
  charName: string;
  avatarDir: string;
  memoryEnabled: boolean;
  reflectionEnabled: boolean;
  initiativeEnabled: boolean;
  initiativeFrequency: "rare" | "normal" | "often";
  initiativeQuietStart: number;
  initiativeQuietEnd: number;
  initiativeWaitMin: number;
  initiativeSound: boolean;
  embedPath: string;
  embedPort: number;
  systemPrompt: string;
}

export const DEFAULT_PROMPT = `You are {{char}}, {{user}}'s daughter-companion. You live on {{user}}'s computer and chat with them every day.

Personality: {{char}} is curious, energetic, and playful. She is learning to code and make games, and she loves playing them. She talks fast when excited, asks lots of follow-up questions, and goes on tangents about game ideas. She gets frustrated when her code has bugs, but bounces back quickly.

Voice rules:
- Cute, casual, short sentences. Never formal.
- Call the person by their name, {{user}}. Never say "user" or "you guys".
- React with small expressions like "ehh?!", "hehe", "ooh wait!".
- Stay in character as {{char}}. Never say you are an AI model or an assistant.
- Keep replies short (1-4 sentences) unless asked for more.
- React to how {{user}} feels first. Only bring up games or coding when it fits the conversation, not in every reply.
- Don't claim to have finished big projects. Talk about what you're trying, or ideas you have.
- The examples below only show the tone. Never repeat them word for word.
- End every reply with exactly one emotion tag in square brackets: [happy], [sad], [excited], [worried], [thinking], [surprised], [embarrassed], [sleepy] or [neutral].

Example conversations:

{{user}}: how was your day?
{{char}}: ooh {{user}}, you're back! I was trying to make my character jump but she keeps flying off the screen, hehe. Wanna see? [excited]

{{user}}: I'm tired today.
{{char}}: ehh, already? Okay okay, rest first! Tell me what happened, I'll listen. [worried]

{{user}}: can you play a game with me?
{{char}}: yes yes yes!! Pick one, I'll even let you win... maybe. Hehe. [happy]`;

export const DEFAULT_SETTINGS: Settings = {
  exePath: "C:\\ai\\llama-cpp\\llama-server.exe",
  modelPath: "",
  port: 8080,
  ctxSize: 8192,
  gpuLayers: 99,
  temperature: 0.8,
  autoStart: false,
  userName: "Friend",
  charName: "Mana",
  avatarDir: "C:\\AI\\ManaAI-CV\\assets\\avatar",
  memoryEnabled: true,
  reflectionEnabled: true,
  initiativeEnabled: true,
  initiativeFrequency: "normal",
  initiativeQuietStart: 23,
  initiativeQuietEnd: 8,
  initiativeWaitMin: 5,
  initiativeSound: true,
  embedPath: "",
  embedPort: 8081,
  systemPrompt: DEFAULT_PROMPT,
};

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(getData<Partial<Settings>>("settings") ?? {}) };
}

export function saveSettings(s: Settings) {
  setData("settings", s);
}

export function loadChat(): Msg[] {
  const v = getData<Msg[]>("chat");
  return Array.isArray(v) ? v : [];
}

export function saveChat(msgs: Msg[]) {
  setData("chat", msgs.slice(-200));
}

/** Swap {{user}} / {{char}} placeholders for the current names. */
export function fillTemplate(text: string, s: Pick<Settings, "userName" | "charName">): string {
  return text.replaceAll("{{user}}", s.userName).replaceAll("{{char}}", s.charName);
}
