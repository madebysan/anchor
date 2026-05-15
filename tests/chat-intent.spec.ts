import { expect, test } from "playwright/test";

import { classifyChatRequest } from "../src/lib/ai/chat-intent";

function classify(message: string, overrides: Partial<Parameters<typeof classifyChatRequest>[0]> = {}) {
  return classifyChatRequest({
    message,
    hasSelection: false,
    isChatThread: true,
    selectedText: "",
    ...overrides,
  });
}

test("chat edit requests default to whole-document edits without selection", () => {
  expect(classify("translate to spanish").intent).toBe("replace-document");
  expect(classify("rewrite the intro").intent).toBe("replace-document");
  expect(classify("make the intro better").intent).toBe("replace-document");
});

test("chat questions and summaries stay conversational", () => {
  expect(classify("What is this document about?").intent).toBe("answer-document-question");
  expect(classify("summarize this document").intent).toBe("answer-document-question");
});

test("insert requests use the caret instead of whole-document replacement", () => {
  expect(classify("add a sentence about the audience").intent).toBe("insert-at-caret");
  expect(classify("write a paragraph about the conclusion").intent).toBe("insert-at-caret");
});

test("global rename requests carry replacement instructions", () => {
  const result = classify("John is now called Martin. Update it everywhere in the doc.");

  expect(result.intent).toBe("replace-all");
  expect(result.replaceAllInstruction).toEqual({
    original: "John",
    replacement: "Martin",
  });
});

test("selected rename requests use selected text when the source is implied", () => {
  const result = classify("Update it everywhere else in the document", {
    hasSelection: true,
    selectedText: "John",
  });

  expect(result.intent).toBe("replace-all");
  expect(result.replaceAllInstruction).toEqual({
    original: "John",
    replacement: null,
  });
});

test("research and structural edits stay out of auto-apply", () => {
  expect(classify("research whether this is true; if true, rewrite it").intent).toBe("research-first");
  expect(classify("move this paragraph after the future work paragraph").intent).toBe("unsupported-structure");
});

test("selection comments still route to selected-passage edits", () => {
  expect(classify("make this punchier", {
    hasSelection: true,
    isChatThread: false,
    selectedText: "Original sentence.",
  }).intent).toBe("selected-passage");
});

test("non-chat no-selection edits still ask for a target", () => {
  expect(classify("rewrite this", {
    isChatThread: false,
  }).intent).toBe("needs-target");
});
