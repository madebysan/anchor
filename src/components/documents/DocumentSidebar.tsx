
import { createContext, useContext, useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DocumentMeta } from "@/types";
import {
  createFolder,
  deleteFolder,
  renameFolder,
  sanitizeNoteId,
  type NoteTreeNode,
} from "@/lib/notes-fs";
import { useDocumentStore } from "@/lib/document-store";
import { useSidebarStore } from "@/lib/sidebar-store";
import { useClaudeChatStore } from "@/lib/claude-chat";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTreeDrag } from "./useTreeDrag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  CornerUpLeft,
  FileText,
  Folder,
  FolderPlus,
  FolderOpen,
  MessageCircle,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

interface DocumentSidebarProps {
  documents: DocumentMeta[];
  activeDocId: string | null;
  noteTree: NoteTreeNode[];
  onCreateDocument: () => void;
  onCreateDocumentInFolder: (folderId: string) => void;
  onSwitchDocument: (id: string) => void;
  onDeleteDocument: (id: string) => void;
  onRenameDocument: (id: string, newTitle: string) => void;
  onDuplicateDocument: (id: string) => void;
  onMoveDocumentToFolder: (id: string, targetFolderId: string | null) => void;
  notesFolder?: string;
  onChangeNotesFolder?: () => void;
}

const EXPANDED_KEY = "anchor-expanded-folders";
const LEGACY_EXPANDED_KEYS = ["inline-md-expanded-folders"];

/** What is being dragged and where it would land, for row highlights. */
const TreeDragContext = createContext<{ draggingId: string | null; target: string | null }>({
  draggingId: null,
  target: null,
});

/** Shift+F10 or the Menu key opens a row's actions, as a right-click would. */
function openMenuFromKeyboard(event: React.KeyboardEvent<HTMLElement>): boolean {
  if (!((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")) return false;
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 24,
      clientY: rect.bottom - 4,
    }),
  );
  return true;
}

interface FolderOption {
  id: string;
  label: string;
}

function loadExpanded(): Set<string> {
  try {
    const raw =
      localStorage.getItem(EXPANDED_KEY) ??
      LEGACY_EXPANDED_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(set: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

function countFiles(nodes: NoteTreeNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.type === "file") return count + 1;
    return count + countFiles(node.children);
  }, 0);
}

function collectFolderOptions(
  nodes: NoteTreeNode[],
  parentLabel = "",
): FolderOption[] {
  return nodes.flatMap((node) => {
    if (node.type === "file") return [];
    const label = parentLabel ? `${parentLabel} / ${node.name}` : node.name;
    return [
      { id: node.id, label },
      ...collectFolderOptions(node.children, label),
    ];
  });
}

export default function DocumentSidebar({
  documents,
  activeDocId,
  noteTree,
  onCreateDocument,
  onCreateDocumentInFolder,
  onSwitchDocument,
  onDeleteDocument,
  onRenameDocument,
  onDuplicateDocument,
  onMoveDocumentToFolder,
  notesFolder,
  onChangeNotesFolder,
}: DocumentSidebarProps) {
  // While a folder's conversation is open, only the folder shows as selected.
  const folderSelected = useClaudeChatStore((st) => st.target?.kind === "folder");
  const [search, setSearch] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded());

  // Auto-expand folders that contain the active doc so the user always sees
  // their selection. Only fires when activeDocId changes.
  useEffect(() => {
    if (!activeDocId || !activeDocId.includes("/")) return;
    const segments = activeDocId.split("/");
    setExpanded((prev) => {
      const next = new Set(prev);
      let acc = "";
      for (let i = 0; i < segments.length - 1; i++) {
        acc = acc ? `${acc}/${segments[i]}` : segments[i];
        next.add(acc);
      }
      saveExpanded(next);
      return next;
    });
  }, [activeDocId]);

  const toggleExpanded = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      saveExpanded(next);
      return next;
    });
  };

  const revealPath = (path: string) => {
    invoke<void>("reveal_path", { path }).catch((e) => {
      console.error("reveal_path failed:", e);
    });
  };

  const openPath = (path: string) => {
    invoke<void>("open_path", { path }).catch((e) => {
      console.error("open_path failed:", e);
    });
  };

  const [copiedPath, setCopiedPath] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyPath = (path: string) => {
    navigator.clipboard
      .writeText(path)
      .then(() => {
        setCopiedPath(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopiedPath(false), 1500);
      })
      .catch((e) => {
        console.error("copy filepath failed:", e);
      });
  };

  const moveFolderTo = (id: string, target: string | null) => {
    useDocumentStore
      .getState()
      .moveFolder(id, target)
      .catch((e) => {
        console.error("moveFolder failed:", e);
        window.alert(`Couldn't move the folder: ${e}`);
      });
  };

  const { drag, onPointerDown } = useTreeDrag({
    onDrop: (item, target) => {
      if (item.kind === "file") onMoveDocumentToFolder(item.id, target);
      else moveFolderTo(item.id, target);
    },
    onHoverFolder: (folderId) => {
      if (!expanded.has(folderId)) toggleExpanded(folderId);
    },
  });

  // ⌥⌘C copies the selected item's path, as in Finder: the row with focus,
  // else the open folder or note. The editor keeps ⌥⌘C for code blocks.
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedPathRef = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.altKey || event.code !== "KeyC") return;
      const active = document.activeElement;
      const inSidebar = active instanceof Element && rootRef.current?.contains(active);
      if (!inSidebar && active !== document.body) return;
      const row = inSidebar ? (active as Element).closest<HTMLElement>("[data-tree-path]") : null;
      const path = row?.dataset.treePath || selectedPathRef.current;
      if (!path) return;
      event.preventDefault();
      copyPath(path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // copyPath only touches refs and stable setters.
  }, []);

  const createSubfolder = (parentId?: string) => {
    const name = window.prompt("Folder name");
    if (!name) return;
    const sanitized = sanitizeNoteId(name);
    const nextId = parentId ? `${parentId}/${sanitized}` : sanitized;
    createFolder(nextId)
      .then(() => {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (parentId) next.add(parentId);
          next.add(nextId);
          saveExpanded(next);
          return next;
        });
        return useDocumentStore.getState().refreshFromDisk();
      })
      .catch((e) => {
        console.error("createFolder failed:", e);
      });
  };

  const deleteFolderRecursive = (node: Extract<NoteTreeNode, { type: "folder" }>) => {
    const fileCount = countFiles(node.children);
    const suffix = fileCount === 1 ? "1 note" : `${fileCount} notes`;
    if (!window.confirm(`Delete "${node.name}" and ${suffix}?`)) return;
    deleteFolder(node.id)
      .then(() => useDocumentStore.getState().refreshFromDisk())
      .catch((e) => {
        console.error("deleteFolder failed:", e);
      });
  };

  const commitFolderRename = (id: string) => {
    const trimmed = editingFolderName.trim();
    if (!trimmed) {
      setEditingFolderId(null);
      return;
    }
    const oldPath = notesFolder ? `${notesFolder.replace(/\/+$/, "")}/${id}` : null;
    renameFolder(id, trimmed)
      .then(() => {
        // Conversations of the folder and of notes inside it move with it.
        if (oldPath) {
          const newPath = `${oldPath.slice(0, oldPath.lastIndexOf("/"))}/${trimmed}`;
          useClaudeChatStore.getState().renamePath(oldPath, newPath);
        }
        return useDocumentStore.getState().refreshFromDisk();
      })
      .catch((e) => {
        console.error("renameFolder failed:", e);
      })
      .finally(() => {
        setEditingFolderId(null);
      });
  };

  // Look up the title for the document pending deletion
  const pendingDeleteTitle = useMemo(() => {
    if (!pendingDeleteId) return "";
    return documents.find((d) => d.id === pendingDeleteId)?.title || "Untitled";
  }, [pendingDeleteId, documents]);

  const filteredDocs = useMemo(() => {
    if (!search.trim()) return documents;
    const q = search.toLowerCase();
    return documents.filter((d) => d.title.toLowerCase().includes(q));
  }, [documents, search]);

  const pathByDocId = useMemo(() => {
    const paths = new Map<string, string>();
    const collect = (nodes: NoteTreeNode[]) => {
      for (const node of nodes) {
        if (node.type === "file") {
          paths.set(node.id, node.path);
        } else {
          collect(node.children);
        }
      }
    };
    collect(noteTree);
    return paths;
  }, [noteTree]);
  const chatFolderPath = useClaudeChatStore((st) => (st.target?.kind === "folder" ? st.target.path : null));
  selectedPathRef.current = chatFolderPath ?? (activeDocId ? pathByDocId.get(activeDocId) ?? null : null);

  const folderOptions = useMemo(() => collectFolderOptions(noteTree), [noteTree]);

  return (
    <div ref={rootRef} className="flex flex-col h-full bg-background text-sidebar-foreground">
      {/* The strip under the traffic lights and the header move the window
          (src/lib/window-drag.ts). */}
      <div className="h-7 shrink-0" data-window-drag />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3" data-window-drag>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Documents
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => createSubfolder()}
            title="New folder"
          >
            <FolderPlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onCreateDocument}
            title="New document"
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Search filter */}
      {documents.length > 1 && (
        <div className="px-2 pb-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search docs..."
              className="h-7 pl-7 text-xs border-0 bg-muted/50 shadow-none focus-visible:ring-1"
            />
          </div>
        </div>
      )}

      {/* Document list — search mode is flat, otherwise nested tree.
          min-h-0 is critical: without it, flex-1 grows to fit content
          instead of constraining ScrollArea to the available height. */}
      <TreeDragContext.Provider value={{ draggingId: drag?.item.id ?? null, target: drag?.target ?? null }}>
      <ScrollArea className="flex-1 min-h-0">
        {/* Dropping on empty space moves an item to the top of the notes folder. */}
        <div
          className={`min-h-full p-1.5 space-y-0.5 ${drag?.target === "" ? "rounded-md bg-sidebar-accent/40" : ""}`}
          data-drop-folder=""
          onPointerDown={onPointerDown}
        >
          {search.trim()
            ? filteredDocs.map((doc) => (
                <FileRow
                  key={doc.id}
                  id={doc.id}
                  path={pathByDocId.get(doc.id) ?? ""}
                  title={doc.title}
                  depth={0}
                  isActive={!folderSelected && doc.id === activeDocId}
                  isEditing={editingDocId === doc.id}
                  editingTitle={editingTitle}
                  onSwitch={onSwitchDocument}
                  onStartRename={(id, title) => {
                    setEditingDocId(id);
                    setEditingTitle(title);
                  }}
                  onCommitRename={(id) => {
                    const trimmed = editingTitle.trim();
                    if (trimmed && trimmed !== documents.find((d) => d.id === id)?.title) {
                      onRenameDocument(id, trimmed);
                    }
                    setEditingDocId(null);
                  }}
                  onCancelRename={() => setEditingDocId(null)}
                  onChangeEditingTitle={setEditingTitle}
                  onDelete={(id) => setPendingDeleteId(id)}
                  onDuplicate={onDuplicateDocument}
                  folderOptions={folderOptions}
                  onMoveToFolder={onMoveDocumentToFolder}
                  onReveal={revealPath}
                  onCopyPath={copyPath}
                />
              ))
            : noteTree.map((node) => (
                <TreeNodeView
                  key={node.id}
                  node={node}
                  depth={0}
                  activeDocId={activeDocId}
                  expanded={expanded}
                  onToggleExpanded={toggleExpanded}
                  documents={documents}
                  editingDocId={editingDocId}
                  editingTitle={editingTitle}
                  onSwitch={onSwitchDocument}
                  onStartRename={(id, title) => {
                    setEditingDocId(id);
                    setEditingTitle(title);
                  }}
                  onCommitRename={(id) => {
                    const trimmed = editingTitle.trim();
                    if (trimmed && trimmed !== documents.find((d) => d.id === id)?.title) {
                      onRenameDocument(id, trimmed);
                    }
                    setEditingDocId(null);
                  }}
                  onCancelRename={() => setEditingDocId(null)}
                  onChangeEditingTitle={setEditingTitle}
                  onDelete={(id) => setPendingDeleteId(id)}
                  onDuplicate={onDuplicateDocument}
                  folderOptions={folderOptions}
                  onMoveToFolder={onMoveDocumentToFolder}
                  onReveal={revealPath}
                  onOpenFolder={openPath}
                  onCopyPath={copyPath}
                  onCreateDocumentInFolder={onCreateDocumentInFolder}
                  onCreateSubfolder={createSubfolder}
                  onDeleteFolder={deleteFolderRecursive}
                  editingFolderId={editingFolderId}
                  editingFolderName={editingFolderName}
                  onStartRenameFolder={(id, name) => {
                    setEditingFolderId(id);
                    setEditingFolderName(name);
                  }}
                  onCommitRenameFolder={commitFolderRename}
                  onCancelRenameFolder={() => setEditingFolderId(null)}
                  onChangeEditingFolderName={setEditingFolderName}
                  onMoveFolder={moveFolderTo}
                />
              ))}
        </div>
      </ScrollArea>
      </TreeDragContext.Provider>
      {drag && (
        <div
          className="pointer-events-none fixed z-50 max-w-56 truncate rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{ left: drag.x + 12, top: drag.y + 8 }}
        >
          {drag.item.label}
        </div>
      )}

      {/* Footer — the notes folder's name; clicking it changes the folder. */}
      {notesFolder && (
        <button
          type="button"
          onClick={onChangeNotesFolder}
          className="flex items-center gap-2 px-3 py-2 border-t border-sidebar-border text-left text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          title={`Change notes folder (${notesFolder})`}
          aria-label={`Notes folder: ${notesFolder.split("/").pop() || notesFolder}. Change notes folder`}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1 min-w-0" aria-live="polite">
            {copiedPath ? "Path copied" : notesFolder.split("/").pop() || notesFolder}
          </span>
        </button>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDeleteTitle}?</AlertDialogTitle>
            <AlertDialogDescription>
              This document will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteId) {
                  onDeleteDocument(pendingDeleteId);
                  setPendingDeleteId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =====================
// Tree row components
// =====================

interface FileRowProps {
  id: string;
  path: string;
  title: string;
  depth: number;
  isActive: boolean;
  isEditing: boolean;
  editingTitle: string;
  onSwitch: (id: string) => void;
  onStartRename: (id: string, title: string) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onChangeEditingTitle: (next: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  folderOptions: FolderOption[];
  onMoveToFolder: (id: string, targetFolderId: string | null) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
}

/** Show the note's file name, extension included, as it is on disk. */
function fileNameFor(path: string, title: string): string {
  const name = path.split("/").pop();
  return name || `${title}.md`;
}

function FileRow({
  id,
  path,
  title,
  depth,
  isActive,
  isEditing,
  editingTitle,
  onSwitch,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onChangeEditingTitle,
  onDelete,
  onDuplicate,
  folderOptions,
  onMoveToFolder,
  onReveal,
  onCopyPath,
}: FileRowProps) {
  const parentId = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null;
  const { draggingId } = useContext(TreeDragContext);
  const moveTargets = folderOptions.filter((folder) => folder.id !== parentId);
  const showMoveMenu = parentId !== null || moveTargets.length > 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            if (!isEditing) onSwitch(id);
          }}
          onKeyDown={(e) => {
            if (isEditing) return;
            if (openMenuFromKeyboard(e)) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSwitch(id);
            }
          }}
          data-tree-item={id}
          data-tree-kind="file"
          data-tree-label={fileNameFor(path, title)}
          data-tree-path={path || undefined}
          // A note dropped on holds its folder as the target.
          data-drop-folder={parentId ?? ""}
          // No file icon (every row is a .md note): indent past the chevron
          // slot so names line up with sibling folders' icons.
          style={{ paddingLeft: 22 + depth * 14 }}
          className={`group w-full flex items-center pr-2 py-1.5 rounded-md text-left text-sm cursor-pointer transition-colors ${
            draggingId === id ? "opacity-50 " : ""
          }${
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
          }`}
        >
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                autoFocus
                value={editingTitle}
                onChange={(e) => onChangeEditingTitle(e.target.value)}
                onBlur={() => onCommitRename(id)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCommitRename(id);
                  }
                  if (e.key === "Escape") onCancelRename();
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent border border-border rounded px-1 py-0 text-[13px] font-medium leading-tight outline-none focus:border-primary"
              />
            ) : (
              <div className="truncate font-medium text-[13px] leading-tight" title={path || undefined}>
                {fileNameFor(path, title)}
              </div>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem disabled={!path} onSelect={() => onReveal(path)}>
          <FolderOpen className="size-4" />
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuItem disabled={!path} onSelect={() => onCopyPath(path)}>
          <Clipboard className="size-4" />
          Copy filepath
          <span className="ml-auto pl-4 text-xs tracking-widest text-muted-foreground">⌥⌘C</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            onSwitch(id);
            useSidebarStore.getState().focusChat();
          }}
        >
          <MessageCircle className="size-4" />
          Ask Claude about this note
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onDuplicate(id)}>
          <Copy className="size-4" />
          Duplicate
        </ContextMenuItem>
        {showMoveMenu && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <CornerUpLeft className="size-4" />
              Move to folder
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-56">
              {parentId && (
                <ContextMenuItem onSelect={() => onMoveToFolder(id, null)}>
                  Root
                </ContextMenuItem>
              )}
              {moveTargets.map((folder) => (
                <ContextMenuItem
                  key={folder.id}
                  onSelect={() => onMoveToFolder(id, folder.id)}
                >
                  {folder.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onStartRename(id, title)}>
          Rename
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => onDelete(id)}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface TreeNodeViewProps {
  node: NoteTreeNode;
  depth: number;
  activeDocId: string | null;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  documents: DocumentMeta[];
  editingDocId: string | null;
  editingTitle: string;
  onSwitch: (id: string) => void;
  onStartRename: (id: string, title: string) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onChangeEditingTitle: (next: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  folderOptions: FolderOption[];
  onMoveToFolder: (id: string, targetFolderId: string | null) => void;
  onReveal: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onCopyPath: (path: string) => void;
  onCreateDocumentInFolder: (folderId: string) => void;
  onCreateSubfolder: (parentId?: string) => void;
  onDeleteFolder: (node: Extract<NoteTreeNode, { type: "folder" }>) => void;
  editingFolderId: string | null;
  editingFolderName: string;
  onStartRenameFolder: (id: string, name: string) => void;
  onCommitRenameFolder: (id: string) => void;
  onCancelRenameFolder: () => void;
  onChangeEditingFolderName: (next: string) => void;
  onMoveFolder: (id: string, targetParentId: string | null) => void;
}

function TreeNodeView(props: TreeNodeViewProps) {
  const folderSelected = useClaudeChatStore((st) => st.target?.kind === "folder");
  const { node, depth, expanded, onToggleExpanded } = props;

  if (node.type === "file") {
    const docMeta = props.documents.find((d) => d.id === node.id);
    return (
      <FileRow
        id={node.id}
        path={node.path}
        title={docMeta?.title || node.title}
        depth={depth}
        isActive={!folderSelected && node.id === props.activeDocId}
        isEditing={props.editingDocId === node.id}
        editingTitle={props.editingTitle}
        onSwitch={props.onSwitch}
        onStartRename={props.onStartRename}
        onCommitRename={props.onCommitRename}
        onCancelRename={props.onCancelRename}
        onChangeEditingTitle={props.onChangeEditingTitle}
        onDelete={props.onDelete}
        onDuplicate={props.onDuplicate}
        folderOptions={props.folderOptions}
        onMoveToFolder={props.onMoveToFolder}
        onReveal={props.onReveal}
        onCopyPath={props.onCopyPath}
      />
    );
  }

  // Folder node
  const isOpen = expanded.has(node.id);
  const isEditing = props.editingFolderId === node.id;
  const isChatTarget = useClaudeChatStore(
    (s) => s.target?.kind === "folder" && s.target.path === node.path,
  );
  const { draggingId, target: dropTarget } = useContext(TreeDragContext);
  // A folder can move anywhere except into itself, its own folders, or where it already is.
  const folderParent = node.id.includes("/") ? node.id.slice(0, node.id.lastIndexOf("/")) : "";
  const folderMoveTargets = props.folderOptions.filter(
    (folder) => folder.id !== node.id && !folder.id.startsWith(`${node.id}/`) && folder.id !== folderParent,
  );
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={() => {
              if (isEditing) return;
              // First click selects the folder for its Claude conversation and
              // opens it; clicking it again (or its arrow) collapses it.
              if (isChatTarget || !isOpen) onToggleExpanded(node.id);
              useClaudeChatStore.getState().setTarget({ kind: "folder", path: node.path });
            }}
            onKeyDown={(e) => {
              if (!isEditing) openMenuFromKeyboard(e);
            }}
            data-tree-item={node.id}
            data-tree-kind="folder"
            data-tree-label={node.name}
            data-tree-path={node.path}
            data-drop-folder={node.id}
            style={{ paddingLeft: 4 + depth * 14 }}
            aria-current={isChatTarget ? "true" : undefined}
            className={`group w-full flex items-center gap-1 pr-2 py-1.5 rounded-md text-left text-[13px] transition-colors ${
              draggingId === node.id ? "opacity-50 " : ""
            }${
              dropTarget === node.id
                ? "bg-sidebar-accent ring-1 ring-inset ring-sidebar-ring text-sidebar-accent-foreground"
                : isChatTarget
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50"
            }`}
          >
            <span
              role="presentation"
              className="flex shrink-0"
              onClick={(event) => {
                if (isEditing) return;
                event.stopPropagation();
                onToggleExpanded(node.id);
              }}
            >
              {isOpen ? (
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </span>
            {isOpen ? (
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {isEditing ? (
              <input
                autoFocus
                value={props.editingFolderName}
                onChange={(e) => props.onChangeEditingFolderName(e.target.value)}
                onBlur={() => props.onCommitRenameFolder(node.id)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    props.onCommitRenameFolder(node.id);
                  }
                  if (e.key === "Escape") props.onCancelRenameFolder();
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 bg-transparent border border-border rounded px-1 py-0 text-[13px] font-medium leading-tight outline-none focus:border-primary"
              />
            ) : (
              <span className="truncate font-medium">{node.name}</span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onSelect={() => props.onOpenFolder(node.path)}>
            <FolderOpen className="size-4" />
            Reveal in Finder
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => props.onCopyPath(node.path)}>
            <Clipboard className="size-4" />
            Copy path
            <span className="ml-auto pl-4 text-xs tracking-widest text-muted-foreground">⌥⌘C</span>
          </ContextMenuItem>
          {folderMoveTargets.length > 0 || folderParent !== "" ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <CornerUpLeft className="size-4" />
                Move to folder
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-56">
                {folderParent !== "" && (
                  <ContextMenuItem onSelect={() => props.onMoveFolder(node.id, null)}>Root</ContextMenuItem>
                )}
                {folderMoveTargets.map((folder) => (
                  <ContextMenuItem key={folder.id} onSelect={() => props.onMoveFolder(node.id, folder.id)}>
                    <span className="truncate">{folder.label}</span>
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : null}
          <ContextMenuItem
            onSelect={() => {
              useClaudeChatStore.getState().setTarget({ kind: "folder", path: node.path });
              useSidebarStore.getState().focusChat();
            }}
          >
            <MessageCircle className="size-4" />
            Ask Claude about this folder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => props.onCreateDocumentInFolder(node.id)}>
            <FileText className="size-4" />
            New note in folder
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => props.onCreateSubfolder(node.id)}>
            <FolderPlus className="size-4" />
            New subfolder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => props.onStartRenameFolder(node.id, node.name)}>
            Rename folder
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => props.onDeleteFolder(node)}
          >
            <Trash2 className="size-4" />
            Delete folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isOpen && (
        <div>
          {node.children.map((child) => (
            <TreeNodeView
              {...props}
              key={child.id}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
