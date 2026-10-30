import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { useEditorContextStore, type IdeSelection } from "@/lib/ide-context";
import { getNoteTree } from "@/lib/persistence";
import type { NoteTreeNode } from "@/lib/notes-fs";
import { mentionPath, useTerminalStore } from "@/lib/terminal";

// The sidebar keeps one conversation per note and per folder. Each has its own
// Claude Code session (see src-tauri/src/session.rs), resumed by id, and its
// history is saved in Anchor's app storage, never in the notes folder. Only the
// visible conversation keeps a live process; one still working when the user
// switches away finishes first, then stops until the user comes back.

const MAX_SELECTION_CHARS = 4000;
const MAX_FOLDER_FILES_LISTED = 150;
const STORAGE_KEY = "anchor-chats";
const MAX_STORED_ITEMS = 200;
const MAX_STORED_CONVERSATIONS = 300;
// Browser storage holds about 5 MB per app. Stay well under it so saving
// never starts failing; the oldest conversations are dropped first.
const MAX_STORED_CHARS = 3_000_000;
const SAVE_DEBOUNCE_MS = 500;

export type ChatTarget = { kind: "note" | "folder"; path: string };

export type ToolStatus = "running" | "done" | "error";

export type ChatItem =
  | { kind: "user"; id: string; text: string; context: string | null; quote?: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "tool"; id: string; name: string; summary: string; status: ToolStatus }
  | { kind: "notice"; id: string; text: string; tone: "info" | "error" }
  | {
      kind: "permission";
      id: string;
      requestId: string;
      toolName: string;
      summary: string;
      input: unknown;
      status: "pending" | "allowed" | "denied";
    };

export interface Conversation {
  items: ChatItem[];
  /** Claude's own session id; survives restarts of the process and of Anchor. */
  sessionId: string | null;
  busy: boolean;
  updatedAt: number;
}

interface ClaudeChatStore {
  target: ChatTarget | null;
  conversations: Record<string, Conversation>;
  setTarget: (target: ChatTarget | null) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  /** Forget the visible conversation and start over. */
  clear: () => void;
  /** Keep conversations attached when a note or folder is renamed or moved in Anchor. */
  renamePath: (oldPath: string, newPath: string) => void;
  /** Answer a permission question Claude asked in the visible conversation. */
  answerPermission: (itemId: string, allow: boolean) => void;
  /** Hidden for now: hand the visible conversation to the terminal. */
  continueInTerminal: () => void;
}

export const targetKey = (target: ChatTarget) => `${target.kind}:${target.path}`;

const emptyConversation = (): Conversation => ({ items: [], sessionId: null, busy: false, updatedAt: Date.now() });

let itemCounter = 0;
const nextItemId = (prefix: string) => `${prefix}-${Date.now()}-${++itemCounter}`;

// ---------------------------------------------------------------------------
// Storage

interface StoredConversation {
  items: ChatItem[];
  sessionId: string | null;
  updatedAt: number;
}

function loadStored(): Record<string, StoredConversation> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, StoredConversation>) : {};
  } catch {
    return {};
  }
}

function toStored(conversation: Conversation): StoredConversation {
  return {
    // A reply cut off by quitting is kept as it was, not as still streaming.
    items: conversation.items.slice(-MAX_STORED_ITEMS).map((item) =>
      item.kind === "assistant" && item.streaming
        ? { ...item, streaming: false }
        : item.kind === "tool" && item.status === "running"
          ? { ...item, status: "error" as const }
          : item.kind === "permission" && item.status === "pending"
            ? { ...item, status: "denied" as const }
            : item,
    ),
    sessionId: conversation.sessionId,
    updatedAt: conversation.updatedAt,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(conversations: Record<string, Conversation>) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const stored = { ...loadStored() };
    for (const [key, conversation] of Object.entries(conversations)) {
      if (conversation.items.length === 0 && !conversation.sessionId) delete stored[key];
      else stored[key] = toStored(conversation);
    }
    const newestFirst = Object.entries(stored)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_STORED_CONVERSATIONS);
    const kept: [string, StoredConversation][] = [];
    let size = 2;
    for (const entry of newestFirst) {
      size += JSON.stringify(entry).length + 1;
      if (size > MAX_STORED_CHARS && kept.length > 0) break;
      kept.push(entry);
    }
    // If storage still refuses, keep halving until it fits.
    while (kept.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
        return;
      } catch (error) {
        if (kept.length === 1) {
          console.error("Saving chat history failed:", error);
          return;
        }
        kept.splice(Math.ceil(kept.length / 2));
      }
    }
  }, SAVE_DEBOUNCE_MS);
}

function loadConversation(key: string): Conversation {
  const stored = loadStored()[key];
  if (!stored) return emptyConversation();
  return { items: stored.items ?? [], sessionId: stored.sessionId ?? null, busy: false, updatedAt: stored.updatedAt ?? Date.now() };
}

// ---------------------------------------------------------------------------
// Context sent with each message

function folderFiles(folderPath: string): string[] {
  const findFolder = (nodes: NoteTreeNode[]): NoteTreeNode | null => {
    for (const node of nodes) {
      if (node.type !== "folder") continue;
      if (node.path === folderPath) return node;
      const inner = findFolder(node.children);
      if (inner) return inner;
    }
    return null;
  };
  const folder = findFolder(getNoteTree());
  if (!folder || folder.type !== "folder") return [];
  const files: string[] = [];
  const walk = (nodes: NoteTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "file") files.push(mentionPath(node.path, folderPath));
      else walk(node.children);
    }
  };
  walk(folder.children);
  return files;
}

const MAX_QUOTE_CHARS = 300;

function describeContext(
  target: ChatTarget,
  selection: IdeSelection | null,
): { block: string; label: string | null; quote?: string } {
  const notesFolder = useTerminalStore.getState().notesFolder;
  const relative = mentionPath(target.path, notesFolder);

  if (target.kind === "folder") {
    const files = folderFiles(target.path);
    const listed = files.slice(0, MAX_FOLDER_FILES_LISTED);
    const more = files.length > listed.length ? `\n…and ${files.length - listed.length} more` : "";
    const lines = [
      `Folder: ${relative}`,
      `Notes in it (${files.length}):`,
      ...listed.map((file) => `- ${file}`),
    ];
    return { block: `<anchor-context>\n${lines.join("\n")}${more}\n</anchor-context>`, label: null };
  }

  // Relative paths only: Claude resolves them against its working directory.
  // An absolute path through a symlink (such as /tmp) can look like it is
  // outside that folder and make Claude ask for permission.
  const lines = [`Note: ${relative}`];
  let label: string | null = null;
  if (selection && selection.filePath === target.path) {
    const { start, end, isEmpty } = selection.selection;
    if (isEmpty || !selection.text.trim()) {
      lines.push(`Cursor: line ${start.line + 1}`);
    } else {
      const span = start.line === end.line ? `line ${start.line + 1}` : `lines ${start.line + 1}-${end.line + 1}`;
      const text = selection.text.length > MAX_SELECTION_CHARS
        ? `${selection.text.slice(0, MAX_SELECTION_CHARS)}\n[selection truncated]`
        : selection.text;
      lines.push(`Selected text (${span}):`, '"""', text, '"""');
      const count = end.line - start.line + 1;
      label = `${count} ${count === 1 ? "line" : "lines"} selected`;
      const quote = selection.text.trim();
      return {
        block: `<anchor-context>\n${lines.join("\n")}\n</anchor-context>`,
        label,
        quote: quote.length > MAX_QUOTE_CHARS ? `${quote.slice(0, MAX_QUOTE_CHARS)}…` : quote,
      };
    }
  }
  return { block: `<anchor-context>\n${lines.join("\n")}\n</anchor-context>`, label };
}

/** A short description of a tool call, like "Edit essay.md" or "Bash: ls". */
export function summarizeTool(name: string, input: unknown): string {
  const args = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const text = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");
  const notesFolder = useTerminalStore.getState().notesFolder;
  const file = text("file_path") || text("notebook_path") || text("path");
  if (file) return mentionPath(file, notesFolder);
  const command = text("command");
  if (command) return command.length > 80 ? `${command.slice(0, 80)}…` : command;
  return text("pattern") || text("url") || text("query") || text("description") || text("skill") || "";
}

// ---------------------------------------------------------------------------
// Claude's stream-json events

interface StreamJsonEvent {
  type?: string;
  request_id?: string;
  request?: { subtype?: string; tool_name?: string; input?: unknown };
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  permission_denials?: Array<{ tool_name?: string; tool_input?: unknown }>;
  message?: { content?: Array<Record<string, unknown>> };
  event?: {
    type?: string;
    content_block?: { type?: string };
    delta?: { type?: string; text?: string };
  };
}

export const useClaudeChatStore = create<ClaudeChatStore>((set, get) => {
  /** Running processes: Anchor's process id -> conversation key. */
  const processKeys = new Map<number, string>();
  /** Conversation key -> its running process id. */
  const processes = new Map<string, number>();
  /** Conversation key -> the assistant item receiving streamed text. */
  const streaming = new Map<string, string>();

  const activeKey = () => {
    const target = get().target;
    return target ? targetKey(target) : null;
  };

  const updateConversation = (key: string, change: (conversation: Conversation) => Conversation) => {
    set((state) => {
      const current = state.conversations[key] ?? loadConversation(key);
      const conversations = { ...state.conversations, [key]: { ...change(current), updatedAt: Date.now() } };
      scheduleSave(conversations);
      return { conversations };
    });
  };
  const append = (key: string, item: ChatItem) =>
    updateConversation(key, (conversation) => ({ ...conversation, items: [...conversation.items, item] }));
  const updateItem = (key: string, id: string, change: (item: ChatItem) => ChatItem) =>
    updateConversation(key, (conversation) => ({
      ...conversation,
      items: conversation.items.map((item) => (item.id === id ? change(item) : item)),
    }));

  const stopProcess = (key: string) => {
    const id = processes.get(key);
    if (id === undefined) return;
    processes.delete(key);
    processKeys.delete(id);
    streaming.delete(key);
    invoke<void>("claude_session_stop", { id }).catch(() => {});
  };

  const handleEvent = (key: string, event: StreamJsonEvent) => {
    const conversation = get().conversations[key];
    if (event.session_id && conversation && event.session_id !== conversation.sessionId) {
      updateConversation(key, (current) => ({ ...current, sessionId: event.session_id ?? null }));
    }

    switch (event.type) {
      case "control_request": {
        // Claude asks before using a tool its permission settings don't allow.
        if (event.request?.subtype !== "can_use_tool" || !event.request_id) return;
        const toolName = event.request.tool_name ?? "a tool";
        append(key, {
          kind: "permission",
          id: nextItemId("permission"),
          requestId: event.request_id,
          toolName,
          summary: summarizeTool(toolName, event.request.input),
          input: event.request.input ?? {},
          status: "pending",
        });
        return;
      }
      case "stream_event": {
        const streamEvent = event.event;
        if (streamEvent?.type === "content_block_start" && streamEvent.content_block?.type === "text") {
          const id = nextItemId("assistant");
          streaming.set(key, id);
          append(key, { kind: "assistant", id, text: "", streaming: true });
        } else if (streamEvent?.type === "content_block_delta" && streamEvent.delta?.type === "text_delta") {
          const id = streaming.get(key);
          const delta = streamEvent.delta.text ?? "";
          if (id) updateItem(key, id, (item) => (item.kind === "assistant" ? { ...item, text: item.text + delta } : item));
        }
        return;
      }
      case "assistant": {
        for (const block of event.message?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string") {
            const id = streaming.get(key);
            streaming.delete(key);
            const text = block.text;
            if (id) updateItem(key, id, (item) => (item.kind === "assistant" ? { ...item, text, streaming: false } : item));
            else append(key, { kind: "assistant", id: nextItemId("assistant"), text, streaming: false });
          } else if (block.type === "tool_use" && typeof block.id === "string") {
            const name = typeof block.name === "string" ? block.name : "Tool";
            append(key, { kind: "tool", id: block.id, name, summary: summarizeTool(name, block.input), status: "running" });
          }
        }
        return;
      }
      case "user": {
        for (const block of event.message?.content ?? []) {
          if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
          const status: ToolStatus = block.is_error === true ? "error" : "done";
          updateItem(key, block.tool_use_id, (item) => (item.kind === "tool" ? { ...item, status } : item));
        }
        return;
      }
      case "result": {
        streaming.delete(key);
        updateConversation(key, (current) => ({
          ...current,
          busy: false,
          items: current.items.map((item) =>
            item.kind === "tool" && item.status === "running" ? { ...item, status: "done" } : item,
          ),
        }));
        const denied = (event.permission_denials ?? []).map((denial) => {
          const summary = summarizeTool(denial.tool_name ?? "", denial.tool_input);
          return `${denial.tool_name ?? "a tool"}${summary ? ` (${summary})` : ""}`;
        });
        if (denied.length > 0) {
          append(key, {
            kind: "notice",
            id: nextItemId("notice"),
            tone: "info",
            text: `Claude wasn't allowed to use ${denied.join(", ")}. Allow it in Claude's settings, or ask from the folder's conversation, which uses your usual permission mode.`,
          });
        }
        if (event.is_error) {
          append(key, { kind: "notice", id: nextItemId("notice"), tone: "error", text: event.result || "Claude stopped with an error." });
        }
        // A conversation that finished while the user looked elsewhere stops
        // its process; it resumes from the same session next time.
        if (key !== activeKey()) stopProcess(key);
        return;
      }
      default:
        return;
    }
  };

  let listening = false;
  const ensureListeners = async () => {
    if (listening) return;
    listening = true;
    await listen<{ id: number; line: string }>("claude-session-event", (message) => {
      const key = processKeys.get(message.payload.id);
      if (!key) return;
      try {
        handleEvent(key, JSON.parse(message.payload.line) as StreamJsonEvent);
      } catch {
        // Claude only prints JSON in this mode; ignore anything else.
      }
    });
    await listen<{ id: number; code: number | null; stderr: string }>("claude-session-exit", (message) => {
      const key = processKeys.get(message.payload.id);
      if (!key) return;
      processKeys.delete(message.payload.id);
      processes.delete(key);
      streaming.delete(key);
      const wasBusy = get().conversations[key]?.busy ?? false;
      updateConversation(key, (current) => ({ ...current, busy: false }));
      if (wasBusy) {
        const detail = message.payload.stderr.trim().split("\n").slice(-3).join("\n");
        append(key, {
          kind: "notice",
          id: nextItemId("notice"),
          tone: "error",
          text: detail ? `Claude stopped unexpectedly: ${detail}` : "Claude stopped unexpectedly.",
        });
      }
    });
  };

  const ensureProcess = async (target: ChatTarget): Promise<number> => {
    const key = targetKey(target);
    const running = processes.get(key);
    if (running !== undefined) return running;
    await ensureListeners();
    const id = await invoke<number>("claude_session_start", {
      resume: get().conversations[key]?.sessionId ?? null,
      scope: target.kind,
    });
    processes.set(key, id);
    processKeys.set(id, key);
    return id;
  };

  return {
    target: null,
    conversations: {},

    setTarget: (target) => {
      const previous = get().target;
      if (previous && target && targetKey(previous) === targetKey(target)) return;
      if (previous) {
        const previousKey = targetKey(previous);
        if (!get().conversations[previousKey]?.busy) stopProcess(previousKey);
      }
      if (!target) {
        set({ target: null });
        return;
      }
      const key = targetKey(target);
      set((state) => ({
        target,
        conversations: state.conversations[key]
          ? state.conversations
          : { ...state.conversations, [key]: loadConversation(key) },
      }));
    },

    send: async (text) => {
      const target = get().target;
      const trimmed = text.trim();
      if (!target || !trimmed) return;
      const key = targetKey(target);
      if (get().conversations[key]?.busy) return;
      const { block, label, quote } = describeContext(target, useEditorContextStore.getState().selection);
      append(key, { kind: "user", id: nextItemId("user"), text: trimmed, context: label, quote });
      updateConversation(key, (current) => ({ ...current, busy: true }));
      try {
        const id = await ensureProcess(target);
        await invoke<void>("claude_session_send", { id, text: `${block}\n\n${trimmed}` });
      } catch (error) {
        updateConversation(key, (current) => ({ ...current, busy: false }));
        append(key, { kind: "notice", id: nextItemId("notice"), tone: "error", text: String(error) });
      }
    },

    // Ending the process is the reliable way to interrupt print mode; the
    // conversation resumes from the last finished turn on the next message.
    stop: () => {
      const key = activeKey();
      if (!key || !get().conversations[key]?.busy) return;
      stopProcess(key);
      updateConversation(key, (current) => ({
        ...current,
        busy: false,
        items: [
          ...current.items.map((item) =>
            item.kind === "tool" && item.status === "running"
              ? { ...item, status: "error" as const }
              : item.kind === "permission" && item.status === "pending"
                ? { ...item, status: "denied" as const }
                : item,
          ),
          { kind: "notice" as const, id: nextItemId("notice"), tone: "info" as const, text: "Stopped." },
        ],
      }));
    },

    clear: () => {
      const key = activeKey();
      if (!key) return;
      stopProcess(key);
      updateConversation(key, () => emptyConversation());
    },

    renamePath: (oldPath, newPath) => {
      const moveKey = (key: string): string | null => {
        const separator = key.indexOf(":");
        const kind = key.slice(0, separator);
        const path = key.slice(separator + 1);
        if (path === oldPath) return `${kind}:${newPath}`;
        if (path.startsWith(`${oldPath}/`)) return `${kind}:${newPath}${path.slice(oldPath.length)}`;
        return null;
      };

      // An empty conversation never replaces one already stored at the new path.
      const stored = loadStored();
      const movedStored: Record<string, StoredConversation> = {};
      for (const [key, value] of Object.entries(stored)) {
        const moved = moveKey(key);
        if (!moved) movedStored[key] = movedStored[key] ?? value;
        else if (value.items.length > 0 || value.sessionId) movedStored[moved] = value;
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(movedStored));
      } catch {
        // Losing a rename only detaches that chat; the note itself is fine.
      }

      for (const [key, id] of [...processes.entries()]) {
        const moved = moveKey(key);
        if (!moved) continue;
        processes.delete(key);
        processes.set(moved, id);
        processKeys.set(id, moved);
        const streamingId = streaming.get(key);
        if (streamingId) {
          streaming.delete(key);
          streaming.set(moved, streamingId);
        }
      }

      set((state) => {
        const conversations: Record<string, Conversation> = {};
        for (const [key, value] of Object.entries(state.conversations)) {
          const moved = moveKey(key);
          const isEmpty = value.items.length === 0 && !value.sessionId;
          if (!moved) conversations[key] = conversations[key] ?? value;
          else if (!isEmpty) conversations[moved] = value;
        }
        const target = state.target;
        const movedTarget = target ? moveKey(targetKey(target)) : null;
        return {
          conversations,
          target: target && movedTarget ? { kind: target.kind, path: movedTarget.slice(target.kind.length + 1) } : target,
        };
      });
    },

    answerPermission: (itemId, allow) => {
      const key = activeKey();
      if (!key) return;
      const item = get().conversations[key]?.items.find((entry) => entry.id === itemId);
      if (!item || item.kind !== "permission" || item.status !== "pending") return;
      const id = processes.get(key);
      updateItem(key, itemId, (entry) =>
        entry.kind === "permission" ? { ...entry, status: allow ? "allowed" : "denied" } : entry,
      );
      if (id === undefined) return;
      invoke<void>("claude_session_answer", { id, requestId: item.requestId, allow, input: item.input }).catch(
        (error) => append(key, { kind: "notice", id: nextItemId("notice"), tone: "error", text: String(error) }),
      );
    },

    continueInTerminal: () => {
      const key = activeKey();
      const sessionId = key ? get().conversations[key]?.sessionId : null;
      if (!key || !sessionId) return;
      stopProcess(key);
      updateConversation(key, (current) => ({ ...current, busy: false }));
      useTerminalStore.getState().runCommand(`claude --resume ${sessionId}`);
    },
  };
});

const EMPTY_CONVERSATION: Conversation = { items: [], sessionId: null, busy: false, updatedAt: 0 };

/** The visible conversation, or an empty one when nothing is selected. */
export function useActiveConversation(): Conversation {
  return useClaudeChatStore((state) => {
    const key = state.target ? targetKey(state.target) : null;
    return (key && state.conversations[key]) || EMPTY_CONVERSATION;
  });
}
