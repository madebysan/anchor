import { expect, test, type Page } from "playwright/test";

const ORIGINAL_TEXT = "The original sentence needs work.";
const REPLACEMENT_TEXT = "A sharper sentence.";
const SECOND_NOTE_TITLE = "Second Note";
const SECOND_NOTE_TEXT = "This is another note.";
const STORAGE_KEY = "anchor-browser-test-state";

interface TauriMockOptions {
  aiFailure?: string;
  aiDelayMs?: number;
  aiOutput?: string;
  aiOutputs?: string[];
  noteContent?: string;
  showWelcome?: boolean;
}

interface ExternalNotesApi {
  addFolder: (id: string) => void;
  addNote: (id: string, content: string) => void;
  moveNote: (oldId: string, newId: string) => void;
  deleteNote: (id: string) => void;
  emitNotesChanged: (path?: string) => void;
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
      aiOutput,
      aiOutputs,
      noteContent,
      showWelcome,
    }) => {
      interface MockNote {
        id: string;
        path: string;
        title: string;
        content: string;
        modified: number;
      }

      interface MockFolder {
        id: string;
        path: string;
        name: string;
      }

      type MockTreeNode =
        | {
            type: "file";
            id: string;
            path: string;
            title: string;
            content: string;
            modified: number;
          }
        | {
            type: "folder";
            id: string;
            path: string;
            name: string;
            children: MockTreeNode[];
          };

      interface MockState {
        notes: MockNote[];
        folders: MockFolder[];
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
        __inlineMdTestApi: ExternalNotesApi;
      }

      const win = window as unknown as TestWindow;
      const notePath = (id: string) => `/mock-notes/${id}.md`;
      const nowSeconds = () => Math.floor(Date.now() / 1000);
      const welcomeStorageKey = "anchor-welcome-dismissed-v1";
      if (showWelcome) {
        localStorage.removeItem(welcomeStorageKey);
      } else {
        localStorage.setItem(welcomeStorageKey, "true");
      }

      const freshState = (): MockState => ({
        notes: [
          {
            id: "Browser Test",
            path: notePath("Browser Test"),
            title: "Browser Test",
            content: noteContent ?? [
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
        folders: [],
        threads: {},
        invocations: [],
      });

      const parseStoredState = (): MockState => {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return freshState();
        const parsed = JSON.parse(raw) as Partial<MockState>;
        return {
          notes: parsed.notes ?? freshState().notes,
          folders: parsed.folders ?? [],
          threads: parsed.threads ?? {},
          invocations: [],
        };
      };

      const state = parseStoredState();
      const queuedAiOutputs = [...(aiOutputs ?? [])];

      const persist = () => {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            notes: state.notes,
            folders: state.folders,
            threads: state.threads,
          }),
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

      const upsertFolder = (id: string): MockFolder => {
        const existing = state.folders.find((folder) => folder.id === id);
        if (existing) return existing;
        const name = id.split("/").pop() ?? id;
        const folder = {
          id,
          path: `/mock-notes/${id}`,
          name,
        };
        state.folders.push(folder);
        persist();
        publish();
        return folder;
      };

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

      const buildNoteTree = (): MockTreeNode[] => {
        const roots: MockTreeNode[] = [];
        const folders = new Map<string, Extract<MockTreeNode, { type: "folder" }>>();

        const ensureFolder = (id: string): Extract<MockTreeNode, { type: "folder" }> => {
          const existing = folders.get(id);
          if (existing) return existing;

          const slashIndex = id.lastIndexOf("/");
          const parentId = slashIndex === -1 ? "" : id.slice(0, slashIndex);
          const name = slashIndex === -1 ? id : id.slice(slashIndex + 1);
          const folder: Extract<MockTreeNode, { type: "folder" }> = {
            type: "folder",
            id,
            path: `/mock-notes/${id}`,
            name,
            children: [],
          };
          folders.set(id, folder);

          if (parentId) {
            ensureFolder(parentId).children.push(folder);
          } else {
            roots.push(folder);
          }

          return folder;
        };

        for (const folder of state.folders) {
          ensureFolder(folder.id);
        }

        for (const note of state.notes) {
          const slashIndex = note.id.lastIndexOf("/");
          const fileNode: MockTreeNode = { type: "file", ...note };
          if (slashIndex === -1) {
            roots.push(fileNode);
          } else {
            ensureFolder(note.id.slice(0, slashIndex)).children.push(fileNode);
          }
        }

        return roots;
      };

      let nextCallbackId = 1;
      const callbacks = new Map<number, (payload: unknown) => void>();
      const emitNotesChanged = (path?: string) => {
        for (const callback of callbacks.values()) {
          callback({ event: "notes-changed", payload: { path } });
        }
      };

      win.__inlineMdTestApi = {
        addFolder: (id) => {
          upsertFolder(id);
        },
        addNote: (id, content) => {
          upsertNote(id, content);
        },
        moveNote: (oldId, newId) => {
          const note = findNote(oldId);
          if (!note) throw new Error(`Missing note: ${oldId}`);
          state.notes = state.notes.filter((item) => item.id !== oldId);
          upsertNote(newId, note.content);
        },
        deleteNote: (id) => {
          state.notes = state.notes.filter((note) => note.id !== id);
          persist();
          publish();
        },
        emitNotesChanged,
      };

      win.__TAURI_INTERNALS__ = {
        invoke: async (cmd, rawArgs = {}) => {
          const args = asRecord(rawArgs);
          state.invocations.push({ cmd, args });

          switch (cmd) {
            case "ai_check_claude_status":
              return {
                installed: true,
                ready: true,
                detail: "Claude Code is signed in with a Max subscription.",
                subscription_type: "max",
              };
            case "ai_check_claude_cli":
              return true;
            case "get_notes_folder":
              return "/mock-notes";
            case "list_note_tree":
              return buildNoteTree();
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
            case "create_folder":
              upsertFolder(stringArg(args, "id"));
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
              return {
                success: true,
                output: queuedAiOutputs.shift() ?? aiOutput ?? replacementText,
                error: null,
              };
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
                output: queuedAiOutputs.shift() ?? aiOutput ?? replacementText,
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
      aiOutput: options.aiOutput,
      aiOutputs: options.aiOutputs,
      noteContent: options.noteContent,
      showWelcome: options.showWelcome,
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

async function latestClaudePrompt(page: Page): Promise<string> {
  return page.evaluate(() => {
    const win = window as unknown as {
      __inlineMdTest?: { invocations: Array<{ cmd: string; args: { prompt?: string } }> };
    };
    const invocations =
      win.__inlineMdTest?.invocations.filter((item) => item.cmd === "ai_invoke_claude") ?? [];
    return invocations.at(-1)?.args.prompt ?? "";
  });
}

async function expectNoEditorHighlights(page: Page): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("mark.comment-highlight")).toHaveCount(0);
  await expect(editor.locator("mark.edit-highlight")).toHaveCount(0, { timeout: 5000 });
}

async function submitChatMessage(page: Page, message: string): Promise<void> {
  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill(message);
  await page.getByRole("button", { name: "Send chat message" }).click();
}

async function clickLatestRevert(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Revert" }).last().click();
}

async function emitExternalNotesChange(page: Page, path?: string): Promise<void> {
  await page.evaluate((changedPath) => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.emitNotesChanged(changedPath);
  }, path);
}

test("welcome dialog can create and open the photo walk sample note", async ({ page }) => {
  await installTauriMock(page, { showWelcome: true });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Welcome to Anchor" })).toBeVisible();
  await page.getByRole("button", { name: "Create Sample Note" }).click();

  const editor = page.locator(".ProseMirror");
  await expect(
    editor.getByRole("heading", { name: "Creative Brief: Weekend Photo Walk" }),
  ).toBeVisible();
  await expect(
    page
      .locator('aside[aria-label="Documents"]')
      .getByText("Creative Brief - Weekend Photo Walk"),
  ).toBeVisible();

  const sampleContent = await page.evaluate(() => {
    const win = window as unknown as {
      __inlineMdTest?: { notes: Array<{ id: string; content: string }> };
    };
    return win.__inlineMdTest?.notes.find(
      (note) => note.id === "Creative Brief - Weekend Photo Walk",
    )?.content ?? "";
  });
  expect(sampleContent).toContain("## Shot List");
  expect(sampleContent).toContain("Use Chat to turn the shot list into a tighter sequence.");
});

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

  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("insert a paragraph explaining the specs of the iphone 17");
  await page.getByRole("button", { name: "Send chat message" }).click();

  await expect(editor).toContainText(ORIGINAL_TEXT);
  await expect(editor).toContainText(REPLACEMENT_TEXT);
  await expect.poll(() => savedMarkdown(page)).toContain(REPLACEMENT_TEXT);

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("direct insertion command");
  expect(prompt).not.toContain("The user will apply it themselves");
});

test("chat document edit commands use the full document instead of asking for selection", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("rewrite the intro");
  await page.getByRole("button", { name: "Send chat message" }).click();

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("whole-document transformation");
  expect(prompt).toContain("Current document markdown");
  expect(prompt).not.toContain("select the text they want changed");
  expect(prompt).not.toContain("The user will apply it themselves");
});

test("chat quality edits use the full document instead of asking for selection", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Ask AI", exact: true }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("make the intro better");
  await page.getByRole("button", { name: "Send chat message" }).click();

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("whole-document transformation");
  expect(prompt).toContain("Current document markdown");
  expect(prompt).not.toContain("select the text they want changed");
  expect(prompt).not.toContain("The user will apply it themselves");
});

test("research-then-edit requests stay in the thread instead of auto-applying", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);
  await selectEditorText(page, ORIGINAL_TEXT);
  await clickSelectionAction(page, "Ask AI");

  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("research whether this is true; if true, rewrite it");
  await page.getByLabel("Send comment").click();

  await expect(editor).toContainText(ORIGINAL_TEXT);
  await expect(editor).not.toContainText(REPLACEMENT_TEXT);
  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("research, verification, or conditional edit chain");
  expect(prompt).toContain("must not auto-apply");
});

test("multi-range move requests are treated as unsupported structural edits", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);
  await selectEditorText(page, ORIGINAL_TEXT);
  await clickSelectionAction(page, "Ask AI");

  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("move this paragraph after the future work paragraph");
  await page.getByLabel("Send comment").click();

  await expect(editor).toContainText(ORIGINAL_TEXT);
  await expect(editor).not.toContainText(REPLACEMENT_TEXT);
  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("structural or multi-range document edit");
  expect(prompt).toContain("cannot safely move text across two document locations");
});

test("selected rename can update every matching word in the document", async ({ page }) => {
  await installTauriMock(page, {
    aiOutput: "Martin",
    noteContent: [
      "# Browser Test",
      "",
      "John wrote the brief.",
      "",
      "The review mentions John again.",
      "",
      "Johnson should not change.",
    ].join("\n"),
  });
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("John wrote the brief.");
  await selectEditorText(page, "John");
  await clickSelectionAction(page, "Ask AI");

  const messageInput = page.getByLabel("Comment message");
  await expect(messageInput).toBeVisible();
  await messageInput.fill("John is now called Martin. Update it to Martin everywhere else in the doc.");
  await page.getByLabel("Send comment").click();

  await expect(editor).toContainText("Martin wrote the brief.");
  await expect(editor).toContainText("The review mentions Martin again.");
  await expect(editor).toContainText("Johnson should not change.");
  await expect(editor).not.toContainText("John wrote the brief.");

  await expect.poll(() => savedMarkdown(page)).toContain("Martin wrote the brief.");
  await expect.poll(() => savedMarkdown(page)).toContain("The review mentions Martin again.");
  await expect.poll(() => savedMarkdown(page)).toContain("Johnson should not change.");

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("whole-document replacement");
  expect(prompt).toContain("Reply with ONLY the literal replacement text");
});

test("chat can rename every matching word without selecting text first", async ({ page }) => {
  await installTauriMock(page, {
    aiOutput: "Martin",
    noteContent: [
      "# Browser Test",
      "",
      "John wrote the brief.",
      "",
      "The review mentions John again.",
      "",
      "Johnson should not change.",
    ].join("\n"),
  });
  await page.goto("/");

  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("John is now called Martin. Update it everywhere in the doc.");
  await page.getByRole("button", { name: "Send chat message" }).click();

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("Martin wrote the brief.");
  await expect(editor).toContainText("The review mentions Martin again.");
  await expect(editor).toContainText("Johnson should not change.");
  await expect(editor).not.toContainText("John wrote the brief.");
  await expect(page.getByText("Replaced 2 occurrences")).toBeVisible();

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("whole-document replacement");
});

test("chat can answer document questions without changing the editor", async ({ page }) => {
  await installTauriMock(page, {
    aiOutput: "The document is a browser test note.",
  });
  await page.goto("/");

  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("What is this document about?");
  await page.getByRole("button", { name: "Send chat message" }).click();

  await expect(page.getByText("The document is a browser test note.")).toBeVisible();
  await expect(page.locator(".ProseMirror")).toContainText(ORIGINAL_TEXT);
  await expect(page.locator(".ProseMirror")).not.toContainText(REPLACEMENT_TEXT);

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("Document snapshot");
});

test("chat can replace the whole document for global translation", async ({ page }) => {
  await installTauriMock(page, {
    aiOutput: ["# Prueba del navegador", "", "Hola mundo."].join("\n"),
    noteContent: ["# Browser Test", "", "Hello world."].join("\n"),
  });
  await page.goto("/");

  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("translate to spanish");
  await page.getByRole("button", { name: "Send chat message" }).click();

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("Prueba del navegador");
  await expect(editor).toContainText("Hola mundo.");
  await expect(editor).not.toContainText("Hello world.");
  await expect.poll(() => savedMarkdown(page)).toContain("Hola mundo.");

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("whole-document transformation");
  expect(prompt).toContain("Current document markdown");
});

test("chat summaries stay conversational and do not edit the document", async ({ page }) => {
  await installTauriMock(page, {
    aiOutput: "This document is a short browser-test note.",
  });
  await page.goto("/");

  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("summarize this document");
  await page.getByRole("button", { name: "Send chat message" }).click();

  await expect(page.getByText("This document is a short browser-test note.")).toBeVisible();
  await expect(page.locator(".ProseMirror")).toContainText(ORIGINAL_TEXT);
  await expect(page.locator(".ProseMirror")).not.toContainText(REPLACEMENT_TEXT);

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("Document snapshot");
  expect(prompt).not.toContain("whole-document transformation");
});

test("chat research-then-edit requests do not auto-apply", async ({ page }) => {
  await installTauriMock(page, {
    aiOutput: "This needs verification before Anchor changes the document.",
  });
  await page.goto("/");

  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("research whether this is true; if true, rewrite it");
  await page.getByRole("button", { name: "Send chat message" }).click();

  await expect(page.getByText("This needs verification before Anchor changes the document.")).toBeVisible();
  await expect(page.locator(".ProseMirror")).toContainText(ORIGINAL_TEXT);
  await expect(page.locator(".ProseMirror")).not.toContainText(REPLACEMENT_TEXT);

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("research, verification, or conditional edit chain");
  expect(prompt).toContain("must not auto-apply");
});

test("chat structural move requests do not silently rewrite text", async ({ page }) => {
  await installTauriMock(page, {
    aiOutput: "Anchor needs a future multi-range move command before it can apply this directly.",
  });
  await page.goto("/");

  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("move this paragraph after the future work paragraph");
  await page.getByRole("button", { name: "Send chat message" }).click();

  await expect(page.getByText("Anchor needs a future multi-range move command")).toBeVisible();
  await expect(page.locator(".ProseMirror")).toContainText(ORIGINAL_TEXT);
  await expect(page.locator(".ProseMirror")).not.toContainText(REPLACEMENT_TEXT);

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("structural or multi-range document edit");
  expect(prompt).toContain("cannot safely move text across two document locations");
});

test("chat insert requests use the caret instead of replacing the whole document", async ({ page }) => {
  await installTauriMock(page, {
    aiOutput: " Audience note.",
  });
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText(ORIGINAL_TEXT);
  await setEditorCaretAfterText(page, ORIGINAL_TEXT);

  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("add a sentence about the audience");
  await page.getByRole("button", { name: "Send chat message" }).click();

  await expect(editor).toContainText(`${ORIGINAL_TEXT} Audience note.`);
  await expect.poll(() => savedMarkdown(page)).toContain(`${ORIGINAL_TEXT} Audience note.`);

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("direct insertion command");
  expect(prompt).not.toContain("whole-document transformation");
});

test("chat can append prior answer bullets as a new section at document end", async ({ page }) => {
  const sectionMarkdown = [
    "## Summary",
    "",
    "- The first point.",
    "- The second point.",
    "- The third point.",
  ].join("\n");
  await installTauriMock(page, {
    aiOutput: sectionMarkdown,
    noteContent: ["# Browser Test", "", "Body paragraph."].join("\n"),
  });
  await page.goto("/");

  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("whats the summary of this article in 3 bullet points");
  await page.getByRole("button", { name: "Send chat message" }).click();
  await expect(page.getByText("The first point.")).toBeVisible();

  await messageInput.fill("ok lets add those bullet points at the end of the document as a new section");
  await page.getByRole("button", { name: "Send chat message" }).click();

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("Browser Test");
  await expect(editor).toContainText("Body paragraph.");
  await expect(editor).toContainText("Summary");
  await expect(editor).toContainText("The third point.");
  await expect.poll(() => savedMarkdown(page)).toContain("## Summary");
  await expect.poll(() => savedMarkdown(page)).toContain("The third point.");

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("append new content to the end of the document");
  expect(prompt).toContain("Prior thread context");
  expect(prompt).toContain("Use prior thread context");
  expect(prompt).not.toContain("Place your caret");
});

test("chat appends and fixes markdown tables as real tables", async ({ page }) => {
  const firstTable = [
    "## Ghost vs Substack",
    "",
    "| Feature | Ghost | Substack |",
    "| --- | --- | --- |",
    "| Pricing | Paid | Free with platform fee |",
    "| Hosting | Self-hosted or managed | Hosted only |",
  ].join("\n");
  const fixedTable = [
    "## Ghost vs Substack vs Mataroa",
    "",
    "| Feature | Ghost | Substack | Mataroa |",
    "| --- | --- | --- | --- |",
    "| Pricing | Paid | Free with platform fee | Paid |",
    "| Hosting | Self-hosted or managed | Hosted only | Hosted |",
  ].join("\n");
  await installTauriMock(page, {
    aiOutputs: [firstTable, fixedTable],
    noteContent: ["# Browser Test", "", "Body paragraph."].join("\n"),
  });
  await page.goto("/");

  await page.getByRole("tab", { name: /Chat/ }).click();
  const messageInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(messageInput).toBeVisible();
  await messageInput.fill("add a markdown table comparing Ghost and Substack at the end of the document");
  await page.getByRole("button", { name: "Send chat message" }).click();

  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("table")).toHaveCount(1);
  await expect(editor.locator("table")).toContainText("Ghost");
  await expect(editor.locator("table")).toContainText("Substack");
  await expect(editor.locator("table")).not.toContainText("Mataroa");
  await expect(editor.locator("mark.comment-highlight")).toHaveCount(0);
  await expect(editor.locator("mark.edit-highlight")).toHaveCount(0, { timeout: 5000 });
  await expect.poll(() => savedMarkdown(page)).toContain("| Feature | Ghost | Substack |");

  await messageInput.fill("the table doesn't look like a table fix it");
  await page.getByRole("button", { name: "Send chat message" }).click();

  await expect(editor.locator("table")).toHaveCount(1);
  await expect(editor.locator("table")).toContainText("Mataroa");
  await expect(editor.locator("mark.comment-highlight")).toHaveCount(0);
  await expect(editor.locator("mark.edit-highlight")).toHaveCount(0, { timeout: 5000 });
  await expect.poll(() => savedMarkdown(page)).toContain("| Feature | Ghost | Substack | Mataroa |");

  const prompt = await latestClaudePrompt(page);
  expect(prompt).toContain("The passage to replace");
  expect(prompt).toContain("the table doesn't look like a table fix it");

  await page.reload();
  const reloadedEditor = page.locator(".ProseMirror");
  await expect(reloadedEditor.locator("table")).toHaveCount(1);
  await expect(reloadedEditor.locator("mark.comment-highlight")).toHaveCount(0);
});

test("release candidate revert matrix covers chat append, document replace, and replace-all", async ({ page }) => {
  await installTauriMock(page, {
    noteContent: ["# Browser Test", "", "John met John near the pier."].join("\n"),
    aiOutputs: [
      ["## Action Items", "", "- Confirm the plan", "- Send the recap"].join("\n"),
      ["# Browser Test", "", "Documento traducido."].join("\n"),
      "Martin",
    ],
  });
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await expect(editor).toContainText("John met John near the pier.");

  await submitChatMessage(page, "add an action items section at the end of the document");
  await expect(editor).toContainText("Action Items");
  await expect(editor.locator("li")).toContainText(["Confirm the plan", "Send the recap"]);
  await expectNoEditorHighlights(page);
  await clickLatestRevert(page);
  await expect(editor).not.toContainText("Action Items");
  await expect(editor).toContainText("John met John near the pier.");
  await expectNoEditorHighlights(page);

  await submitChatMessage(page, "translate the document to spanish");
  await expect(editor).toContainText("Documento traducido.");
  await expect(editor).not.toContainText("John met John near the pier.");
  await expectNoEditorHighlights(page);
  await clickLatestRevert(page);
  await expect(editor).toContainText("John met John near the pier.");
  await expect(editor).not.toContainText("Documento traducido.");
  await expectNoEditorHighlights(page);

  await submitChatMessage(page, "John is now called Martin everywhere");
  await expect(editor).toContainText("Martin met Martin near the pier.");
  await expect(editor).not.toContainText("John met John near the pier.");
  await expectNoEditorHighlights(page);
  await clickLatestRevert(page);
  await expect(editor).toContainText("John met John near the pier.");
  await expect(editor).not.toContainText("Martin met Martin near the pier.");
  await expectNoEditorHighlights(page);
});

test("chat document edits preserve mixed markdown shapes without ghost highlights", async ({ page }) => {
  const mixedMarkdown = [
    "# Release Candidate Notes",
    "",
    "## Summary",
    "",
    "- Chat edits apply directly.",
    "- Comments stay anchored.",
    "",
    "1. Run automated QA.",
    "2. Build one DMG.",
    "",
    "> Manual QA should be the final pass, not the first detector.",
    "",
    "```js",
    "console.log('anchor qa');",
    "```",
    "",
    "| Area | Status |",
    "| --- | --- |",
    "| Chat | Covered |",
  ].join("\n");

  await installTauriMock(page, { aiOutput: mixedMarkdown });
  await page.goto("/");

  await submitChatMessage(page, "rewrite this document into a structured markdown brief");

  const editor = page.locator(".ProseMirror");
  await expect(editor.getByRole("heading", { name: "Release Candidate Notes" })).toBeVisible();
  await expect(editor.locator("ul li")).toHaveCount(2);
  await expect(editor.locator("ol li")).toHaveCount(2);
  await expect(editor.locator("blockquote")).toContainText("Manual QA should be the final pass");
  await expect(editor.locator("pre code")).toContainText("console.log('anchor qa');");
  await expect(editor.locator("table")).toContainText("Chat");
  await expectNoEditorHighlights(page);
  await expect.poll(() => savedMarkdown(page)).toContain("| Area | Status |");

  await page.reload();
  const reloadedEditor = page.locator(".ProseMirror");
  await expect(reloadedEditor.locator("table")).toContainText("Covered");
  await expect(reloadedEditor.locator("mark.comment-highlight")).toHaveCount(0);
});

test("chat follow-up edits target the previous inserted range without visible anchors", async ({ page }) => {
  const firstList = ["## Weekly Plan", "", "- Monday planning", "- Tuesday writing"].join("\n");
  const replacementTable = [
    "## Weekly Plan",
    "",
    "| Day | Focus |",
    "| --- | --- |",
    "| Monday | Planning |",
    "| Tuesday | Writing |",
  ].join("\n");
  await installTauriMock(page, {
    aiOutputs: [firstList, replacementTable],
    noteContent: ["# Browser Test", "", "Intro stays in place."].join("\n"),
  });
  await page.goto("/");

  const editor = page.locator(".ProseMirror");
  await submitChatMessage(page, "add a weekly plan list at the end of the document");
  await expect(editor).toContainText("Intro stays in place.");
  await expect(editor.locator("ul li")).toHaveCount(2);
  await expectNoEditorHighlights(page);

  await submitChatMessage(page, "convert that list into a table");
  await expect(editor).toContainText("Intro stays in place.");
  await expect(editor.locator("ul li")).toHaveCount(0);
  await expect(editor.locator("table")).toContainText("Monday");
  await expect(editor.locator("table")).toContainText("Tuesday");
  await expectNoEditorHighlights(page);
  await expect.poll(() => savedMarkdown(page)).toContain("| Day | Focus |");
});

test("external filesystem refresh covers empty folders, new notes, active moves, and active deletes", async ({ page }) => {
  await installTauriMock(page, {
    noteContent: ["# Browser Test", "", "Original body from the active file."].join("\n"),
  });
  await page.goto("/");

  const documentsSidebar = page.getByLabel("Documents");
  const editor = page.locator(".ProseMirror");
  await expect(documentsSidebar).toContainText("Browser Test");
  await expect(editor).toContainText("Original body from the active file.");

  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addFolder("Inbox");
  });
  await emitExternalNotesChange(page, "/mock-notes/Inbox");
  await expect(documentsSidebar.getByText("Inbox")).toBeVisible();

  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.addNote("Inbox/From Finder", "# From Finder\n\nNew body from Finder.");
  });
  await emitExternalNotesChange(page, "/mock-notes/Inbox/From Finder.md");
  await documentsSidebar.getByRole("button", { name: /Inbox/ }).click();
  await expect(documentsSidebar).toContainText("From Finder");

  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.moveNote("Browser Test", "Inbox/Browser Test");
  });
  await emitExternalNotesChange(page, "/mock-notes/Inbox/Browser Test.md");
  await expect(editor).toContainText("Original body from the active file.");
  await expect(documentsSidebar).toContainText("Browser Test");

  await page.evaluate(() => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.deleteNote("Inbox/Browser Test");
  });
  await emitExternalNotesChange(page, "/mock-notes/Inbox/Browser Test.md");
  await expect(editor).toContainText("New body from Finder.");
  await expect(editor).not.toContainText("Original body from the active file.");
});

test("selection Ask AI switches from Chat to the new comment thread", async ({ page }) => {
  await installTauriMock(page);
  await page.goto("/");

  await page.getByRole("tab", { name: /Chat/ }).click();
  await expect(page.getByRole("tab", { name: /Chat/ })).toHaveAttribute("aria-selected", "true");

  await selectEditorText(page, ORIGINAL_TEXT);
  await clickSelectionAction(page, "Ask AI");

  await expect(page.getByRole("tab", { name: /Comments/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Comment message")).toBeVisible();
  await expect(page.getByLabel("Comment message")).toHaveAttribute("placeholder", "Ask AI to edit or respond...");
  await expect(page.getByRole("textbox", { name: "Chat message" })).toBeHidden();
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
