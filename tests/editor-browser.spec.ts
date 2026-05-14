import { expect, test, type Page } from "playwright/test";

const ORIGINAL_TEXT = "The original sentence needs work.";
const REPLACEMENT_TEXT = "A sharper sentence.";
const STORAGE_KEY = "inline-md-browser-test-state";

async function installTauriMock(page: Page): Promise<void> {
  await page.addInitScript(
    ({ originalText, replacementText, storageKey }) => {
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
              return { success: true, output: replacementText, error: null };
            case "ai_invoke_claude":
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
    { originalText: ORIGINAL_TEXT, replacementText: REPLACEMENT_TEXT, storageKey: STORAGE_KEY },
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

function dispatchCommentShortcut(page: Page): Promise<void> {
  return page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "V",
        code: "KeyV",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
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
  await dispatchCommentShortcut(page);

  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("Make this punchier");
  await page.getByLabel("Send comment").click();

  await expect(editor).toContainText(REPLACEMENT_TEXT);
  await expect(editor).not.toContainText(ORIGINAL_TEXT);
  await expect(page.locator("mark.edit-highlight")).toHaveCount(1);

  await expect.poll(() => savedMarkdown(page)).toContain(REPLACEMENT_TEXT);
  const markdown = await savedMarkdown(page);
  expect(markdown).not.toContain("edit-highlight");
  expect(markdown).not.toContain("<mark");

  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText(REPLACEMENT_TEXT);
  await expect(page.locator(".ProseMirror")).not.toContainText(ORIGINAL_TEXT);
});
