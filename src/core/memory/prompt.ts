import { ago } from "./text";
import type { Memory, Recalled } from "./types";

const PINNED_CHAR_BUDGET = 1600;

/**
 * The memory part of her system prompt. Memories keep {{user}}/{{char}} placeholders;
 * the caller fills them in with the current names.
 */
export function memorySection(pinned: Memory[], recalled: Recalled[], now: number): string {
  const parts: string[] = [];

  const keep: string[] = [];
  let used = 0;
  for (const m of [...pinned].sort((a, b) => b.importance - a.importance)) {
    if (used + m.text.length > PINNED_CHAR_BUDGET) break;
    keep.push(`- ${m.text}`);
    used += m.text.length;
  }
  if (keep.length) parts.push(`Things {{char}} always remembers:\n${keep.join("\n")}`);

  if (recalled.length) {
    const lines = recalled.map((r) => {
      const when = ago(now, r.memory.created);
      return `- (${when}${r.vague ? ", you only vaguely remember this" : ""}) ${r.memory.text}`;
    });
    parts.push(`Memories that just came to mind:\n${lines.join("\n")}`);
  }

  if (!parts.length) return "";
  return (
    "\n\n" +
    parts.join("\n\n") +
    "\n\nUse your memories naturally, the way a real person remembers things. Never list them or say you were given them. If a memory is vague, say you only half remember it. If nothing fits the conversation, ignore them."
  );
}
