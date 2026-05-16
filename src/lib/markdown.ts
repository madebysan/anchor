import { marked } from "marked";
import TurndownService from "turndown";

// Configure marked for our use case: GFM (tables, strikethrough), no
// auto-linking that mangles raw URLs, and breaks=false so single newlines
// stay as text wrapping rather than <br> spam.
marked.setOptions({
  gfm: true,
  breaks: false,
});

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
