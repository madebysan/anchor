import { expect, test } from "playwright/test";

import { createAiErrorMessage, parseAiErrorMessage } from "../src/lib/ai-errors";

test("formats bare Claude exit status without duplicated status wording", () => {
  const content = createAiErrorMessage(
    new Error("claude exited with status exit status: 1")
  );
  const parsed = parseAiErrorMessage(content);

  expect(content).not.toContain("exit status exit status");
  expect(parsed).toEqual({
    title: "Claude Code stopped before finishing",
    description: "Claude Code exited with code 1 before returning a response.",
    recovery:
      "Open Claude Code in Terminal to check login, model, or permission prompts, then retry here.",
  });
});

test("keeps detailed Claude launch failures visible", () => {
  const content = createAiErrorMessage(
    "Failed to launch claude CLI: No such file or directory"
  );
  const parsed = parseAiErrorMessage(content);

  expect(parsed?.title).toBe("Claude Code could not start");
  expect(parsed?.detail).toContain("No such file or directory");
  expect(parsed?.recovery).toContain("run `claude`");
});

test("formats backend-shaped Claude exit messages", () => {
  const content = createAiErrorMessage(
    "Claude Code exited with code 1 and did not print an error."
  );
  const parsed = parseAiErrorMessage(content);

  expect(parsed?.title).toBe("Claude Code stopped before finishing");
  expect(parsed?.description).toBe(
    "Claude Code exited with code 1 before returning a response."
  );
});

test("normalizes legacy warning messages", () => {
  const parsed = parseAiErrorMessage("⚠️ claude exited with status exit status: 1");

  expect(parsed?.title).toBe("Claude Code stopped before finishing");
  expect(parsed?.description).toBe(
    "Claude Code exited with code 1 before returning a response."
  );
});
