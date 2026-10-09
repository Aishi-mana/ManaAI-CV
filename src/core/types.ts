export interface Msg {
  id: string;
  role: "user" | "assistant";
  /** Raw text exactly as the model produced it (includes the [emotion] tag). */
  content: string;
  error?: string;
  /** when it was sent (ms). Older messages from before this existed have none. */
  at?: number;
  /** she started this conversation herself */
  initiative?: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
