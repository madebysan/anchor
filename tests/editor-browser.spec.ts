import { expect, test, type Page } from "playwright/test";

const ORIGINAL_TEXT = "The original sentence needs work.";
const REPLACEMENT_TEXT = "A sharper sentence.";
const SECOND_NOTE_TITLE = "Second Note";
const SECOND_NOTE_TEXT = "This is another note.";
const STORAGE_KEY = "anchor-browser-test-state";

interface TauriMockOptions {
  aiFailure?: string;
  aiDelayMs?: number;
}

async function installTauriMock(
  page: Page,
  options: TauriMockOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({
      originalText,
      replacementText,
      secondNoteTitle,
      secondNoteText,
      storageKey,
      aiFailure,
      aiDelayMs,
    }) => {
      interface MockNote {
        id: string;
        path: string;
        title: string;
        content: string;
        modified: number;
      }

      interface MockState {
        notes: MockNote[];
        threads: Record<string, string>;
        invocations: Array<{ cmd: string; args: Record<string, unknown> }>;
      }

      interface TauriInternals {
        invoke: (
          cmd: string,
          args?: Record<string, unknown>,
          options?: unknown,
        ) => Promise<unknown>;
        transformCallback: (
          callback: (payload: unknown) => void,
          once?: boolean,
        ) => number;
        unregisterCallback: (id: number) => void;
        convertFileSrc: (filePath: string, protocol?: string) => string;
      }

      interface TestWindow extends Window {
        __TAURI_INTERNALS__: TauriInternals;
        __TAURI_EVENT_PLUGIN_INTERNALS__: {
          unregisterListener: (event: string, eventId: number) => void;
        };
        __inlineMdTest: MockState;
      }

      const win = window as unknown as TestWindow;
      const notePath = (id: string) => `/mock-notes/${id}.md`;
      const nowSeconds = () => Math.floor(Date.now() / 1000);

      const freshState = (): MockState => ({
        notes: [
          {
            id: "Browser Test",
            path: notePath("Browser Test"),
            title: "Browser Test",
            content: [
              "# Browser Test",
              "",
              originalText,
              "",
              "Second paragraph remains.",
            ].join("\n"),
            modified: nowSeconds(),
          },
          {
            id: secondNoteTitle,
            path: notePath(secondNoteTitle),
            title: secondNoteTitle,
            content: [`# ${secondNoteTitle}`, "", secondNoteText].join("\n"),
            modified: nowSeconds(),
          },
        ],
        threads: {},
        invocations: [],
      });

      const parseStoredState = (): MockState => {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return freshState();
        const parsed = JSON.parse(raw) as Partial<MockState>;
        return {
          notes: parsed.notes ?? freshState().notes,
          threads: parsed.threads ?? {},
          invocations: [],
        };
      };

      const state = parseStoredState();

      const persist = () => {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ notes: state.notes, threads: state.threads }),
        );
      };

      const publish = () => {
        win.__inlineMdTest = state;
      };

      const asRecord = (value: unknown): Record<string, unknown> => {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
        return {};
      };

      const stringArg = (args: Record<string, unknown>, key: string): string => {
        const value = args[key];
        if (typeof value !== "string") {
          throw new Error(`Expected string arg: ${key}`);
        }
        return value;
      };

      const findNote = (id: string) => state.notes.find((note) => note.id === id);
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const upsertNote = (id: string, content: string): MockNote => {
        const title = id.split("/").pop() ?? id;
        const next: MockNote = {
          id,
          path: notePath(id),
          title,
          content,
          modified: nowSeconds(),
        };
        const existingIndex = state.notes.findIndex((note) => note.id === id);
        if (existingIndex === -1) {
          state.notes.unshift(next);
        } else {
          state.notes[existingIndex] = next;
        }
        persist();
        publish();
        return next;
      };

      let nextCallbackId = 1;
      const callbacks = new Map<number, (payload: unknown) => void>();

      win.__TAURI_INTERNALS__ = {
        invoke: async (cmd, rawArgs = {}) => {
          const args = asRecord(rawArgs);
          state.invocations.push({ cmd, args });

          switch (cmd) {
            case "ai_check_claude_cli":
              return true;
            case "get_notes_folder":
              return "/mock-notes";
            case "list_note_tree":
              return state.notes.map((note) => ({
                type: "file",
                ...note,
              }));
            case "read_note": {
              const id = stringArg(args, "id");
              const note = findNote(id);
              if (!note) throw new Error(`Missing note: ${id}`);
              return note;
            }
            case "write_note": {
              const id = stringArg(args, "id");
              const content = stringArg(args, "content");
              return upsertNote(id, content);
            }
            case "read_note_threads":
              return state.threads[stringArg(args, "id")] ?? null;
            case "write_note_threads": {
              const id = stringArg(args, "id");
              state.threads[id] = stringArg(args, "content");
              persist();
              publish();
              return null;
            }
            case "delete_note_threads":
              delete state.threads[stringArg(args, "id")];
              persist();
              publish();
              return null;
            case "delete_note":
              state.notes = state.notes.filter((note) => note.id !== stringArg(args, "id"));
              persist();
              publish();
              return null;
            case "rename_note": {
              const oldId = stringArg(args, "oldId");
              const newId = stringArg(args, "newId");
              const note = findNote(oldId);
              if (!note) throw new Error(`Missing note: ${oldId}`);
              state.notes = state.notes.filter((item) => item.id !== oldId);
              return upsertNote(newId, note.content);
            }
            case "start_watching_notes":
            case "plugin:event|unlisten":
              return null;
            case "plugin:event|listen":
              return 1;
            case "ai_cancel_claude":
              return true;
            case "ai_chat_claude":
              if (aiDelayMs) await delay(aiDelayMs);
              if (aiFailure) {
                return { success: false, output: "", error: aiFailure };
              }
              return { success: true, output: replacementText, error: null };
            case "ai_invoke_claude":
              if (aiDelayMs) await delay(aiDelayMs);
              if (aiFailure) {
                return {
                  success: false,
                  output: "",
                  error: aiFailure,
                  session_id: null,
                };
              }
              return {
                success: true,
                output: replacementText,
                error: null,
                session_id: "browser-test-session",
              };
            default:
              throw new Error(`Unhandled Tauri command in browser test: ${cmd}`);
          }
        },
        transformCallback: (callback, once = false) => {
          const id = nextCallbackId;
          nextCallbackId += 1;
          callbacks.set(id, (payload) => {
            callback(payload);
            if (once) callbacks.delete(id);
          });
          return id;
        },
        unregisterCallback: (id) => {
          callbacks.delete(id);
        },
        convertFileSrc: (filePath, protocol = "asset") => `${protocol}://${filePath}`,
      };

      win.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };

      publish();
    },
    {
      originalText: ORIGINAL_TEXT,
      replacementText: REPLACEMENT_TEXT,
      secondNoteTitle: SECOND_NOTE_TITLE,
      secondNoteText: SECOND_NOTE_TEXT,
      storageKey: STORAGE_KEY,
      aiFailure: options.aiFailure,
      aiDelayMs: options.aiDelayMs,
    },
  );
}

async function selectEditorText(page: Page, text: string): Promise<void> {
  await page.locator(".ProseMirror").click();
  await page.evaluate((selectedText) => {
    const editor = document.querySelector(".ProseMirror");
    if (!(editor instanceof HTMLElement)) {
      throw new Error("Missing editor");
    }

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const content = current.textContent ?? "";
      const index = content.indexOf(selectedText);
      if (index !== -1) {
        const range = document.createRange();
        range.setStart(current, index);
        range.setEnd(current, index + selectedText.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        editor.focus();
        document.dispatchEvent(new Event("selectionchange"));
        return;
      }
      current = walker.nextNode();
    }

    throw new Error(`Could not select text: ${selectedText}`);
  }, text);
}

async function setEditorCaretAfterText(page: Page, text: string): Promise<void> {
  await page.locator(".ProseMirror").click();
  await page.evaluate((targetText) => {
    const editor = document.querySelector(".ProseMirror");
    if (!(editor instanceof HTMLElement)) {
      throw new Error("Missing editor");
    }

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const content = current.textContent ?? "";
      const index = content.indexOf(targetText);
      if (index !== -1) {
        const range = document.createRange();
        const caretOffset = index + targetText.length;
        range.setStart(current, caretOffset);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        editor.focus();
        document.dispatchEvent(new Event("selectionchange"));
        return;
      }
      current = walker.nextNode();
    }

    throw new Error(`Could not place caret after text: ${targetText}`);
  }, text);
}

async function clickSelectionAction(page: Page, name: "Add Comment" | "Ask AI"): Promise<void> {
  const action = page
    .locator("main")
    .getByRole("button", { name: new RegExp(`^${name}$`, "i") });
  await expect(action).toBeVisible();
  await action.click();
}

async function savedMarkdown(page: Page): Promise<string> {
  return page.evaluate(() => {
    const win = window as unknown as {
      __inlineMdTest?: { notes: Array<{ content: string }> };
    };
    return win.__inlineMdTest?.notes[0]?.content ?? "";
  });
}

test("comment rewrite auto-applies, highlights, and survives markdown reload", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);

  await selectEditorText(page, ORIGINAL_TEXT);
  await clickSelectionAction(page, "Ask AI");

  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("Make this punchier");
  await page.getByLabel("Send comment").click();

  await expect(editor).toContainText(REPLACEMENT_TEXT);
  await expect(editor).not.toContainText(ORIGINAL_TEXT);
  await expect(page.getByLabel("Before")).toContainText(ORIGINAL_TEXT);
  await expect(page.getByLabel("After")).toContainText(REPLACEMENT_TEXT);
  await expect(page.locator("mark.edit-highlight")).toHaveCount(1);

  await expect.poll(() => savedMarkdown(page)).toContain(REPLACEMENT_TEXT);
  const markdown = await savedMarkdown(page);
  expect(markdown).not.toContain("edit-highlight");
  expect(markdown).not.toContain("<mark");

  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText(REPLACEMENT_TEXT);
  await expect(page.locator(".ProseMirror")).not.toContainText(ORIGINAL_TEXT);
});

test("document-level insert command writes at the caret instead of debating the request", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);
  await setEditorCaretAfterText(page, ORIGINAL_TEXT);
  await page.getByRole("button", { name: "Ask AI", exact: true }).click();

  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("insert a paragraph explaining the specs of the iphone 17");
  await page.getByLabel("Send comment").click();

  await expect(editor).toContainText(ORIGINAL_TEXT);
  await expect(editor).toContainText(REPLACEMENT_TEXT);
  await expect.poll(() => savedMarkdown(page)).toContain(REPLACEMENT_TEXT);

  const prompt = await page.evaluate(() => {
    const win = window as unknown as {
      __inlineMdTest?: { invocations: Array<{ cmd: string; args: { prompt?: string } }> };
    };
    const invocation = win.__inlineMdTest?.invocations.find(
      (item) => item.cmd === "ai_invoke_claude",
    );
    return invocation?.args.prompt ?? "";
  });
  expect(prompt).toContain("direct insertion command");
  expect(prompt).not.toContain("The user will apply it themselves");
});

test("document-level edit commands do not generate copy-paste instructions", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("rewrite the intro");
  await page.getByLabel("Send comment").click();

  const prompt = await page.evaluate(() => {
    const win = window as unknown as {
      __inlineMdTest?: { invocations: Array<{ cmd: string; args: { prompt?: string } }> };
    };
    const invocation = win.__inlineMdTest?.invocations.find(
      (item) => item.cmd === "ai_invoke_claude",
    );
    return invocation?.args.prompt ?? "";
  });
  expect(prompt).toContain("Anchor must apply edits directly through the editor");
  expect(prompt).toContain("Do not draft a block for the user to copy and paste");
  expect(prompt).not.toContain("The user will apply it themselves");
});

test("applied AI diff can revert the passage", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);

  await selectEditorText(page, ORIGINAL_TEXT);
  await clickSelectionAction(page, "Ask AI");

  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("Make this punchier");
  await page.getByLabel("Send comment").click();

  await expect(editor).toContainText(REPLACEMENT_TEXT);
  await page.getByRole("button", { name: "Revert" }).click();

  await expect(editor).toContainText(ORIGINAL_TEXT);
  await expect(editor).not.toContainText(REPLACEMENT_TEXT);
  await expect(page.getByText("Edit reverted")).toBeVisible();
});

test("comment submit shows loading controls while Claude is pending", async ({ page }) => {
  await installTauriMock(page, { aiDelayMs: 500 });
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);
  await selectEditorText(page, ORIGINAL_TEXT);
  await clickSelectionAction(page, "Ask AI");

  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("Make this punchier");
  await page.getByLabel("Send comment").click();

  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(messageInput).toBeDisabled();
  await expect(editor).toContainText(REPLACEMENT_TEXT);
});

test("document switch flushes pending editor content", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);

  await editor.click();
  await page.keyboard.type(" Fresh unsaved sentence.");
  await page.getByRole("button", { name: new RegExp(SECOND_NOTE_TITLE) }).click();

  await expect(editor).toContainText(SECOND_NOTE_TEXT);
  await expect.poll(() => savedMarkdown(page)).toContain("Fresh unsaved sentence.");
});

test("Claude CLI failures render as actionable sidebar alerts", async ({ page }) => {
  await installTauriMock(page, {
    aiFailure: "claude exited with status exit status: 1",
  });
  await page.goto("/");

  await expect(page.locator(".ProseMirror")).toContainText(ORIGINAL_TEXT);
  await selectEditorText(page, ORIGINAL_TEXT);
  await clickSelectionAction(page, "Ask AI");

  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("Make this clearer");
  await page.getByLabel("Send comment").click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Claude Code stopped before finishing");
  await expect(alert).toContainText(
    "Claude Code exited with code 1 before returning a response.",
  );
  await expect(alert).toContainText("Open Claude Code in Terminal");
  await expect(alert).not.toContainText("exit status exit status");
});

test("document switches restore sidecar comments and visual marks", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);

  await selectEditorText(page, ORIGINAL_TEXT);
  await clickSelectionAction(page, "Add Comment");

  const noteText = "Keep this claim grounded";
  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill(noteText);
  await page.getByLabel("Send comment").click();

  await expect(page.getByText(noteText)).toBeVisible();
  await expect(page.locator("mark.comment-highlight")).toHaveCount(1);

  await page.getByRole("button", { name: new RegExp(SECOND_NOTE_TITLE) }).click();
  await expect(editor).toContainText(SECOND_NOTE_TEXT);
  await expect(page.getByText("No comments yet")).toBeVisible();

  await page.getByRole("button", { name: /Browser Test/ }).click();
  await expect(editor).toContainText(ORIGINAL_TEXT);
  const comments = page.locator('aside[aria-label="Comments"]');
  await expect(comments.getByText(ORIGINAL_TEXT)).toBeVisible();
  await expect(page.locator("mark.comment-highlight")).toHaveCount(1);
  await comments.getByText(ORIGINAL_TEXT).click();
  await expect(comments.getByText(noteText)).toBeVisible();
});

test("selection Add Comment stores a plain note without calling Claude", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);

  await selectEditorText(page, ORIGINAL_TEXT);
  await clickSelectionAction(page, "Add Comment");

  const noteText = "Remember to verify this source";
  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await expect(messageInput).toHaveAttribute("placeholder", "Leave a note for yourself...");
  await messageInput.fill(noteText);
  await page.getByLabel("Send comment").click();

  await expect(page.getByText(noteText)).toBeVisible();
  await messageInput.fill("Second private reminder");
  await page.getByLabel("Send comment").click();
  await expect(page.getByText("Second private reminder")).toBeVisible();
  await expect(editor).toContainText(ORIGINAL_TEXT);
  await expect(editor).not.toContainText(REPLACEMENT_TEXT);

  const aiInvocationCount = await page.evaluate(() => {
    const win = window as unknown as {
      __inlineMdTest?: { invocations: Array<{ cmd: string }> };
    };
    return (
      win.__inlineMdTest?.invocations.filter(({ cmd }) =>
        cmd === "ai_chat_claude" || cmd === "ai_invoke_claude"
      ).length ?? 0
    );
  });
  expect(aiInvocationCount).toBe(0);
});
