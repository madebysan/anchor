import { marked, type RendererObject, type RendererThis, type Tokens } from "marked";
import TurndownService from "turndown";

type MarkedRendererThis = RendererThis<string, string>;

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

const safeRenderer = {
  html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
  },
  link(
    this: MarkedRendererThis,
    { href, title, tokens }: Tokens.Link,
  ): string {
    const label = this.parser.parseInline(tokens);
    const safeHref = sanitizeMarkdownUrl(href);
    if (!safeHref) return label;

    const titleAttribute = title
      ? ` title="${escapeHtml(title)}"`
      : "";
    return `<a href="${escapeHtml(safeHref)}"${titleAttribute}>${label}</a>`;
  },
  image({ text }: Tokens.Image): string {
    return escapeHtml(text);
  },
} satisfies RendererObject<string, string>;

// Configure marked for our use case: GFM (tables, strikethrough), no
// auto-linking that mangles raw URLs, and breaks=false so single newlines
// stay as text wrapping rather than <br> spam.
marked.setOptions({
  gfm: true,
  breaks: false,
});
marked.use({ renderer: safeRenderer });

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  bulletListMarker: "-",
});

// Drop empty paragraphs Tiptap leaves behind so disk stays clean.
turndown.addRule("strip-empty-paragraphs", {
  filter: (node) =>
    node.nodeName === "P" && node.textContent?.trim() === "",
  replacement: () => "",
});

turndown.addRule("tables", {
  filter: "table",
  replacement: (_content, node) => {
    if (node.nodeName !== "TABLE") return "";

    const table = node as HTMLElement;
    const rows = Array.from(table.querySelectorAll("tr"));
    const parsedRows = rows.map((row) =>
      Array.from(row.children)
        .filter((cell) => cell.nodeName === "TH" || cell.nodeName === "TD")
        .map((cell) => sanitizeTableCell(cell.textContent ?? "")),
    );
    if (parsedRows.length === 0) return "";

    const columnCount = Math.max(...parsedRows.map((row) => row.length));
    const normalizedRows = parsedRows.map((row) => normalizeTableRow(row, columnCount));
    const [firstRow, ...bodyRows] = normalizedRows;
    const separator = Array.from({ length: columnCount }, () => "---");
    const markdownRows = [
      renderMarkdownTableRow(firstRow),
      renderMarkdownTableRow(separator),
      ...bodyRows.map(renderMarkdownTableRow),
    ];

    return `\n\n${markdownRows.join("\n")}\n\n`;
  },
});

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

function normalizeTableRow(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

function renderMarkdownTableRow(row: string[]): string {
  return `| ${row.join(" | ")} |`;
}

function sanitizeTableCell(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function sanitizeMarkdownUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || hasUnsafeUrlCharacter(trimmed)) return null;

  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const protocol = new URL(trimmed).protocol.toLowerCase();
    return SAFE_LINK_PROTOCOLS.has(protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

function hasUnsafeUrlCharacter(value: string): boolean {
  for (const character of value) {
    const codeUnit = character.charCodeAt(0);
    if (codeUnit <= 0x1f || codeUnit === 0x7f || character.trim() === "") {
      return true;
    }
  }
  return false;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
