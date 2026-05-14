import { expect, test } from "playwright/test";

import { applyContextStrategy, type DocumentSnapshot } from "../src/lib/ai/context-router";

const doc: DocumentSnapshot = {
  fullText: "One\n\nduplicate passage\n\nTwo\n\nduplicate passage",
  sourceMarkdown: "# One\n\nduplicate passage\n\n# Two\n\nduplicate passage",
  paragraphs: ["One", "duplicate passage", "Two", "duplicate passage"],
  blocks: [
    {
      text: "One",
      pmFrom: 1,
      pmTo: 4,
      sourceFrom: 2,
      sourceTo: 5,
    },
    {
      text: "duplicate passage",
      pmFrom: 6,
      pmTo: 23,
      sourceFrom: 7,
      sourceTo: 24,
    },
    {
      text: "Two",
      pmFrom: 25,
      pmTo: 28,
      sourceFrom: 29,
      sourceTo: 32,
    },
    {
      text: "duplicate passage",
      pmFrom: 30,
      pmTo: 47,
      sourceFrom: 34,
      sourceTo: 51,
    },
  ],
  headings: [
    { level: 1, text: "One" },
    { level: 1, text: "Two" },
  ],
};

test("source offsets disambiguate duplicate highlighted text", () => {
  const routed = applyContextStrategy(
    "local-section",
    doc,
    "duplicate passage",
    { sourceFrom: 34, sourceTo: 51 },
  );

  expect(routed.content).toContain("Two");
  expect(routed.content).not.toContain("One");
});
