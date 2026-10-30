import { Marked } from "marked";

// Claude's replies are Markdown. Render them for the chat, but print any raw
// HTML as text: replies can quote note content, and nothing in a reply should
// become live markup in the app window.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const chatMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
  },
});

export function renderChatMarkdown(markdown: string): string {
  return chatMarked.parse(markdown, { async: false }) as string;
}
