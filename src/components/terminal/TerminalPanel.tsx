import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isToggleShortcut,
  MIN_TERMINAL_HEIGHT,
  useTerminalStore,
  writeToTerminal,
} from "@/lib/terminal";

interface TerminalOutputPayload {
  id: number;
  data: string;
}

interface TerminalExitPayload {
  id: number;
}

/** Leave room for the editor when dragging the panel up. */
const MIN_EDITOR_HEIGHT = 160;

/** xterm.js only understands hex and rgb colors; resolve CSS tokens (oklch) through a canvas. */
function resolveColor(cssColor: string, fallback: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return fallback;
  context.fillStyle = fallback;
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function themeFromTokens(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    resolveColor(styles.getPropertyValue(name).trim() || fallback, fallback);
  const background = token("--background", "#ffffff");
  const foreground = token("--foreground", "#1a1a1a");
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: token("--accent", "#d4d4d4"),
    selectionForeground: foreground,
  };
}

interface TerminalPanelProps {
  /** Height of the column the panel shares with the editor, for drag limits. */
  containerHeight: number;
}

export default function TerminalPanel({ containerHeight }: TerminalPanelProps) {
  const open = useTerminalStore((s) => s.open);
  const height = useTerminalStore((s) => s.height);
  const connectedClaudes = useTerminalStore((s) => s.connectedClaudes);
  const restartKey = useTerminalStore((s) => s.restartKey);
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [session, setSession] = useState(0);
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One xterm instance per session; restarting bumps `session`.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let terminalId: number | null = null;
    const unlisteners: Array<() => void> = [];
    const store = useTerminalStore.getState();

    const terminal = new Terminal({
      fontFamily: '"Geist Mono", ui-monospace, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      macOptionIsMeta: true,
      theme: themeFromTokens(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    fit.fit();

    // Let ⌃` reach the window's toggle shortcut instead of the shell.
    terminal.attachCustomKeyEventHandler((event) => !isToggleShortcut(event));

    const dataSubscription = terminal.onData((data) => {
      if (terminalId === null) return;
      writeToTerminal(terminalId, data).catch(() => {});
    });

    const start = async () => {
      const offOutput = await listen<TerminalOutputPayload>("terminal-output", (event) => {
        if (event.payload.id === terminalId) terminal.write(event.payload.data);
      });
      const offExit = await listen<TerminalExitPayload>("terminal-exit", (event) => {
        if (event.payload.id !== terminalId) return;
        terminalId = null;
        useTerminalStore.getState().setTerminalId(null);
        setExited(true);
      });
      unlisteners.push(offOutput, offExit);
      if (disposed) return;

      try {
        const id = await invoke<number>("terminal_spawn", {
          cols: terminal.cols,
          rows: terminal.rows,
          startupCommand: useTerminalStore.getState().takeStartupCommand(),
        });
        if (disposed) {
          invoke<void>("terminal_kill", { id }).catch(() => {});
          return;
        }
        terminalId = id;
        store.setTerminalId(id);
        setExited(false);
        setError(null);
        const queued = useTerminalStore.getState().takePendingInput();
        if (queued) writeToTerminal(id, queued).catch(() => {});
        if (useTerminalStore.getState().open) terminal.focus();
      } catch (spawnError) {
        setError(String(spawnError));
      }
    };
    void start();

    return () => {
      disposed = true;
      dataSubscription.dispose();
      unlisteners.forEach((off) => off());
      if (terminalId !== null) invoke<void>("terminal_kill", { id: terminalId }).catch(() => {});
      useTerminalStore.getState().setTerminalId(null);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [session, restartKey]);

  // Keep the pty's size in step with the panel.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      const terminal = terminalRef.current;
      const fit = fitRef.current;
      if (!terminal || !fit || host.clientHeight === 0) return;
      fit.fit();
      const id = useTerminalStore.getState().terminalId;
      if (id !== null) {
        invoke<void>("terminal_resize", { id, cols: terminal.cols, rows: terminal.rows }).catch(() => {});
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Follow light/dark and theme changes.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (terminalRef.current) terminalRef.current.options.theme = themeFromTokens();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (open) terminalRef.current?.focus();
  }, [open]);

  const restart = useCallback(() => {
    setExited(false);
    setError(null);
    setSession((n) => n + 1);
  }, []);

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = useTerminalStore.getState().height;
      const maxHeight = Math.max(MIN_TERMINAL_HEIGHT, containerHeight - MIN_EDITOR_HEIGHT);

      const onMove = (moveEvent: MouseEvent) => {
        const next = startHeight + (startY - moveEvent.clientY);
        useTerminalStore.getState().setHeight(Math.min(maxHeight, next));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [containerHeight],
  );

  return (
    <section
      aria-label="Terminal"
      className={cn("relative shrink-0 flex flex-col border-t border-border bg-background", !open && "hidden")}
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        onMouseDown={handleResizeStart}
        className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-10"
      />
      <header className="flex h-8 shrink-0 items-center gap-2 px-3 text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Terminal</span>
        <span className="flex items-center gap-1.5" title="Claude sessions that can see the open note">
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", connectedClaudes > 0 ? "bg-emerald-500" : "bg-muted-foreground/40")}
          />
          {connectedClaudes > 0 ? "Claude sees the open note" : "Claude not connected"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-6" onClick={restart} title="Restart terminal">
            <RotateCcw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => useTerminalStore.getState().setOpen(false)}
            title="Hide terminal (⌃`)"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </div>
      </header>
      <div ref={hostRef} className="anchor-terminal min-h-0 flex-1 px-3 pb-2" />
      {(exited || error) && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-border bg-sidebar px-3 py-2 text-xs">
          <span className="text-muted-foreground">{error ?? "The terminal session ended."}</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={restart}>
            Restart
          </Button>
        </div>
      )}
    </section>
  );
}
