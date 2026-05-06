import type { ContextStrategy } from "@/types";

// What the editor passes to the router. The editor is responsible for
// extracting these from its current ProseMirror state — keeping the router
// pure and Tiptap-free.
export interface DocumentSnapshot {
  /** Plain text of the entire document, paragraphs separated by `\n\n`. */
  fullText: string;
  /** Block-level paragraphs in order, no separators. */
  paragraphs: string[];
  /** Headings in document order (h1-h6). */
  headings: { level: number; text: string }[];
}

export interface RoutedContext {
  /** The slice of the document the AI will see, formatted as a system message. */
  content: string;
  /** Character count of `content` — for the visible chip in CommentInput. */
  charCount: number;
  /** Human-readable label of the strategy used (matches the enum). */
  strategy: ContextStrategy;
  /** Whether the doc was truncated to fit the strategy's budget. */
  truncated: boolean;
}

// Hard ceiling for how big any single context can grow. Even `full-document`
// respects this so a runaway 200-page paste doesn't burn a whole budget.
const MAX_CHARS = 60_000;

// Find the index of the paragraph containing the passage. Substring match,
// first hit wins. Returns -1 if not found (e.g. user comment on doc-level).
function findPassageParagraphIdx(paragraphs: string[], passage: string): number {
  if (!passage) return -1;
  const trimmed = passage.trim();
  if (!trimmed) return -1;
  return paragraphs.findIndex((p) => p.includes(trimmed));
}

// Section boundaries: walks backward from the passage to find the nearest
// heading, then forward until the next heading at the same or higher level.
// Returns paragraph indices [start, end] inclusive.
function findSectionBounds(
  paragraphs: string[],
  headings: { level: number; text: string }[],
  passageIdx: number
): { start: number; end: number } {
  if (headings.length === 0 || passageIdx < 0) {
    return { start: 0, end: paragraphs.length - 1 };
  }

  // Walk back to the most recent heading paragraph, capturing its level.
  let openingHeadingLevel = 0;
  let start = 0;
  for (let i = passageIdx; i >= 0; i--) {
    const para = paragraphs[i];
    const matchedHeading = headings.find((h) => para.trim() === h.text.trim());
    if (matchedHeading) {
      openingHeadingLevel = matchedHeading.level;
      start = i;
      break;
    }
  }

  // Walk forward to the next heading at the same or higher level.
  let end = paragraphs.length - 1;
  for (let i = passageIdx + 1; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const matchedHeading = headings.find((h) => para.trim() === h.text.trim());
    if (matchedHeading && matchedHeading.level <= openingHeadingLevel) {
      end = i - 1;
      break;
    }
  }

  return { start, end };
}

function clamp(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  // Walk back to a sentence break or word boundary.
  let cutoff = max;
  while (cutoff > 0 && s[cutoff] !== " " && s[cutoff] !== "\n") cutoff--;
  if (cutoff === 0) cutoff = max;
  return { text: s.slice(0, cutoff) + "\n\n[... truncated ...]", truncated: true };
}

function formatOutline(headings: { level: number; text: string }[]): string {
  if (headings.length === 0) return "(no headings in document)";
  return headings
    .map((h) => `${"  ".repeat(Math.max(0, h.level - 1))}- ${h.text}`)
    .join("\n");
}

// The dispatcher. Given a strategy and a document snapshot, returns the
// slice of the document to send to the AI plus a count for the chip.
export function applyContextStrategy(
  strategy: ContextStrategy,
  doc: DocumentSnapshot,
  passage: string
): RoutedContext {
  const passageBlock = passage.trim()
    ? `## Highlighted Passage\n"${passage}"`
    : "";

  let body = "";
  let truncated = false;

  switch (strategy) {
    case "passage-only": {
      body = passageBlock;
      break;
    }

    case "tight": {
      const idx = findPassageParagraphIdx(doc.paragraphs, passage);
      if (idx === -1) {
        // No matchable passage (e.g. doc-level comment) — fall back to outline.
        body = `## Document Outline\n${formatOutline(doc.headings)}\n\n${passageBlock}`;
      } else {
        const before = doc.paragraphs[idx - 1] ?? "";
        const after = doc.paragraphs[idx + 1] ?? "";
        const window = [before, doc.paragraphs[idx], after].filter(Boolean).join("\n\n");
        body = `## Surrounding Context\n${window}\n\n${passageBlock}`;
      }
      break;
    }

    case "local-section": {
      const idx = findPassageParagraphIdx(doc.paragraphs, passage);
      if (idx === -1) {
        body = `## Document\n${doc.fullText}\n\n${passageBlock}`;
      } else {
        const { start, end } = findSectionBounds(doc.paragraphs, doc.headings, idx);
        const sectionText = doc.paragraphs.slice(start, end + 1).join("\n\n");
        const clamped = clamp(sectionText, MAX_CHARS / 2);
        truncated = clamped.truncated;
        body = `## Current Section\n${clamped.text}\n\n${passageBlock}`;
      }
      break;
    }

    case "tight-plus-thesis": {
      const thesis = doc.paragraphs[0] ?? "";
      const idx = findPassageParagraphIdx(doc.paragraphs, passage);
      if (idx === -1) {
        body = `## Document Opening\n${thesis}\n\n${passageBlock}`;
      } else {
        const before = doc.paragraphs[idx - 1] ?? "";
        const after = doc.paragraphs[idx + 1] ?? "";
        const window = [before, doc.paragraphs[idx], after].filter(Boolean).join("\n\n");
        const thesisBlock =
          thesis && thesis !== doc.paragraphs[idx]
            ? `## Document Opening\n${thesis}\n\n`
            : "";
        body = `${thesisBlock}## Surrounding Context\n${window}\n\n${passageBlock}`;
      }
      break;
    }

    case "outline-plus-passage": {
      body = `## Document Outline\n${formatOutline(doc.headings)}\n\n${passageBlock}`;
      break;
    }

    case "outline": {
      body = `## Document Outline\n${formatOutline(doc.headings)}`;
      break;
    }

    case "full-document": {
      const clamped = clamp(doc.fullText, MAX_CHARS);
      truncated = clamped.truncated;
      body = `## Document\n${clamped.text}\n\n${passageBlock}`;
      break;
    }
  }

  return {
    content: body.trim(),
    charCount: body.trim().length,
    strategy,
    truncated,
  };
}

// Friendly label for the chip UI.
export const STRATEGY_LABELS: Record<ContextStrategy, string> = {
  "passage-only": "Passage only",
  "tight": "Passage + 1 paragraph",
  "local-section": "Section",
  "tight-plus-thesis": "Passage + thesis",
  "outline-plus-passage": "Outline + passage",
  "outline": "Outline only",
  "full-document": "Full document",
};

// Description for tooltips / settings selector.
export const STRATEGY_DESCRIPTIONS: Record<ContextStrategy, string> = {
  "passage-only": "Send only the highlighted text. Cheapest, narrow scope.",
  "tight": "Highlighted text plus the paragraph before and after.",
  "local-section": "Highlighted text plus the section it lives in (between headings).",
  "tight-plus-thesis": "Surrounding paragraphs plus the document's opening for thesis context.",
  "outline-plus-passage": "Document headings plus the highlighted text — good for structural critique.",
  "outline": "Just the heading outline. Best for table-of-contents or restructuring tasks.",
  "full-document": "Send the entire document. Use for short docs only.",
};

// Subset shown in the Settings dropdown. The other strategies still work
// at the routing layer, but the UI exposes only the three that cover most
// real-world choices (cheap / context-aware / big-picture). Existing
// persona configs with hidden strategies are migrated on load (see
// settings.ts → CONTEXT_STRATEGY_MIGRATIONS).
export const VISIBLE_STRATEGIES: readonly ContextStrategy[] = [
  "passage-only",
  "local-section",
  "full-document",
];
