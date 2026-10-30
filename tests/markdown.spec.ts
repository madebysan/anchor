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

test("markdown tables round-trip as markdown tables", () => {
  const table = [
    "| Feature | Ghost | Substack |",
    "| --- | --- | --- |",
    "| Pricing | Paid | Free with fee |",
    "| Custom domain | Yes | Paid add-on |",
  ].join("\n");
  const html = markdownToHtml(table);
  const markdown = htmlToMarkdown(html);

  expect(html).toContain("<table>");
  expect(markdown).toContain("| Feature | Ghost | Substack |");
  expect(markdown).toContain("| --- | --- | --- |");
  expect(markdown).toContain("| Pricing | Paid | Free with fee |");
});

test("raw html and unsafe markdown links are rendered inert", () => {
  const html = markdownToHtml([
    "<img src=x onerror=alert(1)>",
    "[unsafe](javascript:alert(1))",
    "[safe](https://example.com?a=1&b=2)",
    "![ignored](https://example.com/image.png)",
  ].join("\n\n"));

  expect(html).not.toContain("<img");
  expect(html).not.toContain("javascript:");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(html).toContain("<p>unsafe</p>");
  expect(html).toContain('<a href="https://example.com?a=1&amp;b=2">safe</a>');
  expect(html).toContain("<p>ignored</p>");
});
