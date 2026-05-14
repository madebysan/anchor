import { expect, test } from "playwright/test";

import { DEFAULT_SETTINGS, DEFAULT_TRIGGERS } from "../src/lib/settings";

test("default personas keep rewrite and feedback modes distinct", () => {
  expect(DEFAULT_SETTINGS.defaultPersona).toBe("editor");
  expect(DEFAULT_TRIGGERS.editor.mode).toBe("rewrite");
  expect(DEFAULT_TRIGGERS.copywriter.mode).toBe("rewrite");
  expect(DEFAULT_TRIGGERS.researcher.mode).toBe("feedback");
  expect(DEFAULT_TRIGGERS.challenger.mode).toBe("feedback");
});

test("persona context defaults stay token-aware", () => {
  expect(DEFAULT_TRIGGERS.editor.contextStrategy).toBe("passage-only");
  expect(DEFAULT_TRIGGERS.copywriter.contextStrategy).toBe("local-section");
  expect(DEFAULT_TRIGGERS.researcher.contextStrategy).toBe("local-section");
  expect(DEFAULT_TRIGGERS.challenger.contextStrategy).toBe("full-document");
});
