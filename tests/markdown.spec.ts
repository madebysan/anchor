import { expect, test } from "playwright/test";

import { htmlToMarkdown, markdownToHtml } from "../src/lib/markdown";

test("markdown headings and emphasis round-trip through editor html", () => {
  const html = markdownToHtml("# Title\n\nThis is **bold** and _italic_.");
  const markdown = htmlToMarkdown(html);

  expect(markdown).toContain("# Title");
  expect(markdown).toContain("**bold**");
  expect(markdown).toContain("_italic_");
});

test("fenced code blocks survive markdown conversion", () => {
  const html = markdownToHtml("```ts\nconst value = 1;\n```");
  const markdown = htmlToMarkdown(html);

  expect(markdown).toContain("```ts");
  expect(markdown).toContain("const value = 1;");
});
