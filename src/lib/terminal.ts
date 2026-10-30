import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/** Typed into the terminal's shell when it starts. */
export const TERMINAL_STARTUP_COMMAND = "claude";

const STORAGE_KEY = "anchor-terminal";
const DEFAULT_HEIGHT = 280;
export const MIN_TERMINAL_HEIGHT = 120;

interface StoredTerminalPrefs {
  open: boolean;
  height: number;
}

function loadPrefs(): StoredTerminalPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { open: false, height: DEFAULT_HEIGHT };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { open: false, height: DEFAULT_HEIGHT };
    }
    const { height } = parsed as Partial<StoredTerminalPrefs>;
    // The terminal always starts hidden: the Chat tab is the main way to talk
    // to Claude, so no shell or idle Claude runs until the user opens it.
    return {
      open: false,
      height: typeof height === "number" && height >= MIN_TERMINAL_HEIGHT ? height : DEFAULT_HEIGHT,
    };
  } catch {
    return { open: false, height: DEFAULT_HEIGHT };
  }
}

function savePrefs(prefs: StoredTerminalPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; losing them is harmless.
  }
}

interface TerminalStore {
  open: boolean;
  /** True once the panel has been shown, so the shell survives hiding it. */
  started: boolean;
  height: number;
  terminalId: number | null;
  /** Claude sessions connected to Anchor's IDE server. */
  connectedClaudes: number;
  /** Text to type once the terminal exists (a mention made before it started). */
  pendingInput: string;
  /** The shell's working directory, for relative @-mentions. */
  notesFolder: string | undefined;
  /** Bumped to restart the terminal; `nextStartupCommand` runs in the new shell. */
  restartKey: number;
  nextStartupCommand: string | null;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setHeight: (height: number) => void;
  setTerminalId: (id: number | null) => void;
  setConnectedClaudes: (count: number) => void;
  takePendingInput: () => string;
  queueInput: (text: string) => void;
  setNotesFolder: (folder: string | undefined) => void;
  /** Restart the terminal with `command` instead of the default startup command. */
  runCommand: (command: string) => void;
  takeStartupCommand: () => string;
}

const initialPrefs = loadPrefs();

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  open: initialPrefs.open,
  started: initialPrefs.open,
  height: initialPrefs.height,
  terminalId: null,
  connectedClaudes: 0,
  pendingInput: "",
  notesFolder: undefined,
  restartKey: 0,
  nextStartupCommand: null,
  setOpen: (open) => {
    set((state) => ({ open, started: state.started || open }));
    savePrefs({ open, height: get().height });
  },
  toggle: () => get().setOpen(!get().open),
  setHeight: (height) => {
    const next = Math.max(MIN_TERMINAL_HEIGHT, Math.round(height));
    set({ height: next });
    savePrefs({ open: get().open, height: next });
  },
  setTerminalId: (terminalId) => set({ terminalId }),
  setConnectedClaudes: (connectedClaudes) => set({ connectedClaudes }),
  takePendingInput: () => {
    const text = get().pendingInput;
    if (text) set({ pendingInput: "" });
    return text;
  },
  queueInput: (text) => set((state) => ({ pendingInput: state.pendingInput + text })),
  setNotesFolder: (notesFolder) => set({ notesFolder }),
  runCommand: (command) => {
    set((state) => ({ nextStartupCommand: command, restartKey: state.restartKey + 1 }));
    get().setOpen(true);
  },
  takeStartupCommand: () => {
    const command = get().nextStartupCommand;
    if (command) set({ nextStartupCommand: null });
    return command ?? TERMINAL_STARTUP_COMMAND;
  },
}));

/** ⌃` shows or hides the terminal. */
export function isToggleShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey && event.code === "Backquote";
}

export function writeToTerminal(id: number, data: string): Promise<void> {
  return invoke<void>("terminal_write", { id, data });
}

/** A path as Claude should see it: relative to the notes folder when inside it. */
export function mentionPath(absolutePath: string, notesFolder: string | undefined): string {
  if (!notesFolder) return absolutePath;
  const root = notesFolder.replace(/\/+$/, "");
  if (absolutePath === root) return ".";
  if (absolutePath.startsWith(`${root}/`)) return absolutePath.slice(root.length + 1);
  return absolutePath;
}

