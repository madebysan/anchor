import type { Page } from "playwright/test";

// A stand-in for Anchor's Rust side, so the real frontend runs in a browser
// with invented notes. Used by the browser tests and the README screenshot.

export const ORIGINAL_TEXT = "The original sentence needs work.";
export const SECOND_NOTE_TITLE = "Second Note";
export const SECOND_NOTE_TEXT = "This is another note.";
const STORAGE_KEY = "anchor-browser-test-state";

export interface TauriMockOptions {
  noteContent?: string;
  showWelcome?: boolean;
  /** Replace the two default notes (ids are paths without `.md`). */
  notes?: Array<{ id: string; content: string }>;
  folders?: string[];
  /** Stream-json lines Claude "prints" for each message sent, in order. */
  claudeReplies?: string[][];
  /** The note to open first. */
  activeNote?: string;
  /** Name shown for the notes folder (paths stay under /mock-notes). */
  folderLabel?: string;
}

export interface ExternalNotesApi {
  addFolder: (id: string) => void;
  addNote: (id: string, content: string) => void;
  moveNote: (oldId: string, newId: string) => void;
  deleteNote: (id: string) => void;
  emitNotesChanged: (path?: string) => void;
  emit: (event: string, payload: unknown) => void;
}

export async function installTauriMock(
  page: Page,
  options: TauriMockOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({
      originalText,
      secondNoteTitle,
      secondNoteText,
      storageKey,
      noteContent,
      showWelcome,
      customNotes,
      customFolders,
      claudeReplies,
      activeNote,
      folderLabel,
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

      if (activeNote) localStorage.setItem("anchor-active-doc", activeNote);

      const freshState = (): MockState => ({
        notes: customNotes
          ? customNotes.map((note) => ({
              id: note.id,
              path: notePath(note.id),
              title: note.id.split("/").pop() ?? note.id,
              content: note.content,
              modified: nowSeconds(),
            }))
          : [
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
        folders: (customFolders ?? []).map((id) => ({
          id,
          path: `/mock-notes/${id}`,
          name: id.split("/").pop() ?? id,
        })),
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

      // Stand-in for the file version the app compares (mtime and size).
      const versionOf = (text: string): string => {
        let hash = 0;
        for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
        return `${text.length}-${hash}`;
      };
      const withVersion = (note: MockNote) => ({ ...note, version: versionOf(note.content) });

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
          const threads = state.threads[note.id];
          const fileNode = {
            type: "file" as const,
            ...note,
            version: versionOf(note.content),
            ...(threads ? { threads_version: versionOf(threads) } : {}),
          } as MockTreeNode;
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
      // Handler id -> event name, recorded when the app listens.
      const listenerEvents = new Map<number, string>();
      const emit = (event: string, payload: unknown) => {
        for (const [id, callback] of callbacks) {
          const name = listenerEvents.get(id);
          if (name === undefined || name === event) callback({ event, id, payload });
        }
      };
      const emitNotesChanged = (path?: string) => emit("notes-changed", { path: path ?? "/mock-notes" });
      const pendingReplies = [...claudeReplies];

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
        emit,
      };

      win.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
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
            case "get_notes_folder":
              return folderLabel ? `/${folderLabel}` : "/mock-notes";
            case "list_note_tree":
              return buildNoteTree();
            case "read_notes": {
              const ids = (args.ids as string[]) ?? [];
              return ids.map((id) => findNote(id)).filter(Boolean).map((note) => withVersion(note as MockNote));
            }
            case "read_notes_threads": {
              const ids = (args.ids as string[]) ?? [];
              return ids.filter((id) => state.threads[id]).map((id) => ({ id, content: state.threads[id] }));
            }
            case "read_note": {
              const id = stringArg(args, "id");
              const note = findNote(id);
              if (!note) throw new Error(`Missing note: ${id}`);
              return withVersion(note);
            }
            case "write_note": {
              const id = stringArg(args, "id");
              const content = stringArg(args, "content");
              return withVersion(upsertNote(id, content));
            }
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
            case "move_folder": {
              const id = stringArg(args, "id");
              const parent = typeof args.targetParent === "string" ? args.targetParent : "";
              const name = id.split("/").pop() ?? id;
              const nextId = parent ? `${parent}/${name}` : name;
              const remap = (value: string) => (value === id || value.startsWith(`${id}/`) ? nextId + value.slice(id.length) : value);
              state.folders = state.folders.map((folder) => {
                const fid = remap(folder.id);
                return { id: fid, path: `/mock-notes/${fid}`, name: fid.split("/").pop() ?? fid };
              });
              state.notes = state.notes.map((note) => {
                const nid = remap(note.id);
                return { ...note, id: nid, path: notePath(nid) };
              });
              persist();
              publish();
              return nextId;
            }
            case "create_folder":
              upsertFolder(stringArg(args, "id"));
              return null;
            case "rename_note": {
              const oldId = stringArg(args, "oldId");
              const newId = stringArg(args, "newId");
              const note = findNote(oldId);
              if (!note) throw new Error(`Missing note: ${oldId}`);
              state.notes = state.notes.filter((item) => item.id !== oldId);
              return withVersion(upsertNote(newId, note.content));
            }
            case "start_watching_notes":
            case "plugin:event|unlisten":
              return null;
            case "plugin:event|listen": {
              const handler = typeof args.handler === "number" ? args.handler : -1;
              if (typeof args.event === "string") listenerEvents.set(handler, args.event);
              return handler;
            }
            case "claude_session_start":
              return 7;
            case "claude_session_send": {
              const lines = pendingReplies.shift() ?? [];
              lines.forEach((line, index) => {
                setTimeout(() => emit("claude-session-event", { id: 7, line }), 60 * (index + 1));
              });
              return null;
            }
            case "claude_session_stop":
            case "claude_session_answer":
              return null;
            case "plugin:app|version":
              return "0.1.4";
            case "ide_update_context":
            case "open_path":
            case "open_external_url":
              return null;
            case "ide_connected_clients":
              return 0;
            case "export_note":
              return true;
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
      secondNoteTitle: SECOND_NOTE_TITLE,
      secondNoteText: SECOND_NOTE_TEXT,
      storageKey: STORAGE_KEY,
      noteContent: options.noteContent,
      showWelcome: options.showWelcome,
      customNotes: options.notes ?? null,
      customFolders: options.folders ?? null,
      claudeReplies: options.claudeReplies ?? [],
      activeNote: options.activeNote ?? null,
      folderLabel: options.folderLabel ?? null,
    },
  );
}

export async function selectEditorText(page: Page, text: string): Promise<void> {
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

/** Comments on the selection are created with ⌘⇧V (the selection bubble is gone). */
export async function commentOnSelection(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+Shift+V");
}

export async function savedMarkdown(page: Page): Promise<string> {
  return page.evaluate(() => {
    const win = window as unknown as {
      __inlineMdTest?: { notes: Array<{ content: string }> };
    };
    return win.__inlineMdTest?.notes[0]?.content ?? "";
  });
}

export async function emitExternalNotesChange(page: Page, path?: string): Promise<void> {
  await page.evaluate((changedPath) => {
    const win = window as unknown as { __inlineMdTestApi: ExternalNotesApi };
    win.__inlineMdTestApi.emitNotesChanged(changedPath);
  }, path);
}
