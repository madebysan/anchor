export type ChatIntent =
  | "answer-document-question"
  | "insert-at-caret"
  | "needs-target"
  | "replace-all"
  | "replace-document"
  | "research-first"
  | "selected-passage"
  | "unsupported-structure";

export interface ReplaceAllInstruction {
  original: string;
  replacement: string | null;
}

interface ClassifyChatRequestInput {
  message: string;
  hasSelection: boolean;
  isChatThread: boolean;
  selectedText: string;
}

interface ChatRequestClassification {
  intent: ChatIntent;
  replaceAllInstruction: ReplaceAllInstruction | null;
}

const DOCUMENT_EDIT_VERBS =
  /^(translate|rewrite|polish|copyedit|edit|fix|update|change|delete|remove|shorten|expand)\b/;
const INSERTION_VERBS =
  /^(insert|add|write|draft|compose|append|prepend|put)\b/;
const QUESTION_STARTERS =
  /^(what|why|how|when|where|who|which|can you explain|tell me|summarize)\b/;
const QUALITY_EDIT_PATTERN =
  /\b(make|improve|polish|clean up|tighten|revise)\b.*\b(better|clearer|stronger|shorter|longer|punchier|section|intro|paragraph|argument|copy)\b/;

export function classifyChatRequest({
  message,
  hasSelection,
  isChatThread,
  selectedText,
}: ClassifyChatRequestInput): ChatRequestClassification {
  const normalized = message.trim().toLowerCase();
  const replaceAllInstruction = parseReplaceAllInstruction(message, selectedText);

  if (isResearchFirstRequest(normalized)) {
    return { intent: "research-first", replaceAllInstruction };
  }

  if (isUnsupportedStructureRequest(normalized)) {
    return { intent: "unsupported-structure", replaceAllInstruction };
  }

  if (replaceAllInstruction) {
    return { intent: "replace-all", replaceAllInstruction };
  }

  if (hasSelection) {
    return { intent: "selected-passage", replaceAllInstruction };
  }

  if (isInsertionRequest(normalized)) {
    return { intent: "insert-at-caret", replaceAllInstruction };
  }

  if (isChatThread && isDocumentEditRequest(normalized)) {
    return { intent: "replace-document", replaceAllInstruction };
  }

  if (!isChatThread && isDocumentEditRequest(normalized)) {
    return { intent: "needs-target", replaceAllInstruction };
  }

  return { intent: "answer-document-question", replaceAllInstruction };
}

function stripInstructionToken(value: string): string {
  return value
    .trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`.,;:!?]+$/g, "")
    .trim();
}

function parseReplaceAllInstruction(
  message: string,
  selectedText: string,
): ReplaceAllInstruction | null {
  const trimmed = message.trim();
  const quoted = [...trimmed.matchAll(/["“']([^"”']{1,80})["”']/g)].map((match) =>
    stripInstructionToken(match[1]),
  );

  if (
    quoted.length >= 2 &&
    /\b(everywhere|throughout|whole document|entire document|all occurrences|all instances|every occurrence|every instance|rename|replace|called|renamed)\b/i.test(trimmed)
  ) {
    return { original: quoted[0], replacement: quoted[1] };
  }

  const patterns = [
    /\b(.+?)\s+is\s+now\s+called\s+(.+?)(?:\s|,|\.|;|$)/i,
    /\brename\s+(.+?)\s+to\s+(.+?)(?:\s|,|\.|;|$)/i,
    /\breplace\s+(.+?)\s+with\s+(.+?)(?:\s|,|\.|;|$)/i,
    /\bchange\s+(.+?)\s+to\s+(.+?)(?:\s|,|\.|;|$)/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const original = stripInstructionToken(match[1]);
    const replacement = stripInstructionToken(match[2]);
    if (original && replacement) return { original, replacement };
  }

  if (
    selectedText &&
    /\b(replace|rename|update|change|called|renamed)\b/i.test(trimmed) &&
    /\b(everywhere|everywhere else|throughout|whole document|entire document|all occurrences|all instances|every occurrence|every instance|rest of (the )?(doc|document))\b/i.test(trimmed)
  ) {
    return { original: selectedText, replacement: null };
  }

  return null;
}

function isResearchFirstRequest(normalized: string): boolean {
  return (
    /\b(research|verify|check|look up|confirm)\b.*\b(if|then|replace|rewrite|update|change|edit)\b/.test(normalized) ||
    /\b(if|once)\b.*\b(true|verified|confirmed)\b.*\b(replace|rewrite|update|change|edit)\b/.test(normalized)
  );
}

function isUnsupportedStructureRequest(normalized: string): boolean {
  return /\b(move|relocate)\b.*\b(paragraph|section|sentence|block|text|this)\b.*\b(before|after|above|below)\b/.test(normalized);
}

function isInsertionRequest(normalized: string): boolean {
  return (
    INSERTION_VERBS.test(normalized) ||
    /^create\s+(a|an|the)?\s*(paragraph|section|sentence|bullet|list|note)\b/.test(normalized)
  );
}

function isDocumentEditRequest(normalized: string): boolean {
  if (QUESTION_STARTERS.test(normalized) || normalized.endsWith("?")) {
    return false;
  }

  return DOCUMENT_EDIT_VERBS.test(normalized) || QUALITY_EDIT_PATTERN.test(normalized);
}
