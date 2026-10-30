import { getCurrentWindow } from "@tauri-apps/api/window";

// The window has no title bar (macOS overlay style), so its headers stand in
// for one: press on any empty part of an element marked `data-window-drag`
// to move the window, double-click to zoom it, as with a title bar. Buttons,
// fields and other controls inside a header keep working normally.

const INTERACTIVE =
  'button, a, input, textarea, select, [role="button"], [role="menuitem"], [role="radio"], [contenteditable="true"], [data-no-window-drag]';

function inDragArea(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(INTERACTIVE)) return false;
  return target.closest("[data-window-drag]") !== null;
}

export function installWindowDrag(): () => void {
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || event.detail > 1 || !inDragArea(event.target)) return;
    event.preventDefault();
    getCurrentWindow().startDragging().catch(() => {});
  };
  const onDoubleClick = (event: MouseEvent) => {
    if (!inDragArea(event.target)) return;
    getCurrentWindow().toggleMaximize().catch(() => {});
  };
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("dblclick", onDoubleClick);
  return () => {
    document.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("dblclick", onDoubleClick);
  };
}
