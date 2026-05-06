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

// Plain-note prefixes that opt the comment OUT of AI processing entirely.
// Anything starting with one of these is a note for yourself, not a request.
// Matched case-insensitively against the start of the trimmed message.
const NOTE_PREFIXES = [
  "note:",
  "note for me:",
  "todo:",
  "to-do:",
  "fyi:",
  "// ",
  "//",
];

export function isPlainNote(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return NOTE_PREFIXES.some((p) => trimmed.startsWith(p));
}
