import { useCallback, useEffect, useRef, useState } from "react";

// Finder-style moving in the documents list: press on a note or folder, drag
// it onto a folder (or a note inside it, or the empty space for the top
// level) and let go. Rows carry `data-tree-item` / `data-tree-kind`, and
// whatever can receive a drop carries `data-drop-folder` ("" is the top).
//
// Pointer events rather than HTML drag and drop: the webview's native drag
// handling is unreliable inside the app window.

export interface TreeDragItem {
  kind: "file" | "folder";
  id: string;
  label: string;
}

interface DragState {
  item: TreeDragItem;
  x: number;
  y: number;
  /** Folder id under the pointer that accepts the drop; "" is the top level. */
  target: string | null;
}

const START_DISTANCE = 4;
const EXPAND_AFTER_MS = 700;

const parentOf = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "");

function canDrop(item: TreeDragItem, target: string): boolean {
  if (parentOf(item.id) === target) return false;
  if (item.kind === "folder" && (target === item.id || target.startsWith(`${item.id}/`))) return false;
  return true;
}

export function useTreeDrag(options: {
  onDrop: (item: TreeDragItem, targetFolderId: string | null) => void;
  /** Open a collapsed folder the pointer rests on. */
  onHoverFolder: (folderId: string) => void;
}) {
  const [drag, setDragState] = useState<DragState | null>(null);
  // The live drag; state only mirrors it for rendering.
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const pending = useRef<{ item: TreeDragItem; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    hovered.current = null;
  };

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    suppressClick.current = false;
    if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const element = (event.target as Element).closest<HTMLElement>("[data-tree-item]");
    if (!element || (event.target as Element).closest("input, textarea")) return;
    const id = element.dataset.treeItem ?? "";
    const kind = element.dataset.treeKind === "folder" ? "folder" : "file";
    pending.current = { item: { kind, id, label: element.dataset.treeLabel ?? id }, x: event.clientX, y: event.clientY };
  }, []);

  useEffect(() => {
    const targetAt = (x: number, y: number, item: TreeDragItem): string | null => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-folder]");
      if (!element) return null;
      const target = element.dataset.dropFolder ?? "";
      return canDrop(item, target) ? target : null;
    };

    const onMove = (event: PointerEvent) => {
      const start = pending.current;
      if (!start) return;
      // Released outside the window: no pointerup arrived, so stop here.
      if (event.buttons === 0) {
        finish(false);
        return;
      }
      if (!dragRef.current && Math.hypot(event.clientX - start.x, event.clientY - start.y) < START_DISTANCE) return;
      {
        const target = targetAt(event.clientX, event.clientY, start.item);
        // Resting on a closed folder opens it, as in Finder.
        const folderRow = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>('[data-tree-kind="folder"]');
        const folderId = folderRow?.dataset.treeItem ?? null;
        if (folderId !== hovered.current) {
          clearHover();
          hovered.current = folderId;
          if (folderId) {
            hoverTimer.current = setTimeout(() => optionsRef.current.onHoverFolder(folderId), EXPAND_AFTER_MS);
          }
        }
        setDrag({ item: start.item, x: event.clientX, y: event.clientY, target });
      }
    };

    const finish = (drop: boolean) => {
      clearHover();
      const start = pending.current;
      pending.current = null;
      const current = dragRef.current;
      setDrag(null);
      if (!current) return;
      suppressClick.current = true;
      if (drop && start && current.target !== null) {
        optionsRef.current.onDrop(current.item, current.target === "" ? null : current.target);
      }
    };

    const onUp = () => finish(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pending.current) finish(false);
    };
    // The click that ends a drag must not also open the row.
    const onClick = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.stopPropagation();
      event.preventDefault();
    };

    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  return { drag, onPointerDown };
}
