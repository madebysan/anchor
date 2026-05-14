import { expect, test } from "playwright/test";

import { formatThreadHistory } from "../src/lib/ai/thread-history";

test("thread history includes prior persona context and skips pending assistant shells", () => {
  const history = formatThreadHistory([
    {
      id: "m1",
      role: "user",
      content: "@editor make this tighter",
      trigger: { type: "editor", promptText: "make this tighter" },
      createdAt: 1,
    },
    {
      id: "m2",
      role: "assistant",
      content: "Tighter version",
      createdAt: 2,
    },
    {
      id: "m3",
      role: "assistant",
      content: "",
      createdAt: 3,
    },
  ]);

  expect(history).toContain("User [@editor]: @editor make this tighter");
  expect(history).toContain("Assistant: Tighter version");
  expect(history).not.toContain("m3");
});
