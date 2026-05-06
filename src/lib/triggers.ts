import type { ParsedTrigger } from "@/types";

// Parse a user message to detect if it starts with an @trigger command.
// triggerNames is the list of currently enabled trigger keys (e.g. ["copywriter", "editor"]).
export function parseTrigger(
  text: string,
  triggerNames: string[]
): ParsedTrigger | null {
  if (triggerNames.length === 0) return null;

  // Build regex dynamically from enabled trigger names — @name at start of message
  // Sort by length descending so longer names match first (e.g. "editor" before "edit")
  const escaped = [...triggerNames]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `^@(${escaped.join("|")})\\s*([\\s\\S]*)`,
    "i"
  );

  const match = text.trim().match(pattern);
  if (!match) return null;

  return {
    type: match[1].toLowerCase(),
    promptText: match[2].trim(),
  };
}

// Check if a message starts with any @trigger
export function hasTrigger(text: string, triggerNames: string[]): boolean {
  return parseTrigger(text, triggerNames) !== null;
}
