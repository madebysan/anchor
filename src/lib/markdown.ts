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

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
