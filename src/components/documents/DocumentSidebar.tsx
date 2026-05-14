
import { useState, useMemo, useEffect } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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

const EXPANDED_KEY = "inline-md-expanded-folders";

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
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

// Format a timestamp as a relative time string (e.g. "2m ago", "3h ago", "5d ago")
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
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

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path).catch((e) => {
      console.error("copy filepath failed:", e);
    });
  };

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
    renameFolder(id, trimmed)
      .then(() => useDocumentStore.getState().refreshFromDisk())
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

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Drag region for the macOS overlay title bar — clears the traffic-light
          buttons and lets the user move the window by dragging this strip. */}
      <div
        className="h-7 shrink-0"
        style={{ ["WebkitAppRegion" as never]: "drag" }}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-sidebar-border">
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
        <div className="px-2 py-1.5 border-b border-sidebar-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search docs..."
              className="h-7 pl-7 text-xs bg-sidebar border-sidebar-border"
            />
          </div>
        </div>
      )}

      {/* Document list — search mode is flat, otherwise nested tree.
          min-h-0 is critical: without it, flex-1 grows to fit content
          instead of constraining ScrollArea to the available height. */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-1.5 space-y-0.5">
          {search.trim()
            ? filteredDocs.map((doc) => (
                <FileRow
                  key={doc.id}
                  id={doc.id}
                  path={pathByDocId.get(doc.id) ?? ""}
                  title={doc.title}
                  updatedAt={doc.updatedAt}
                  depth={0}
                  isActive={doc.id === activeDocId}
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
                  onMoveToParent={onMoveDocumentToFolder}
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
                  onMoveToParent={onMoveDocumentToFolder}
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
                />
              ))}
        </div>
      </ScrollArea>

      {/* Footer — shows the configured notes folder + a way to change it. */}
      {notesFolder && (
        <button
          type="button"
          onClick={onChangeNotesFolder}
          className="flex items-center gap-2 px-3 py-2 border-t border-sidebar-border text-left text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          title={notesFolder}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1 min-w-0">
            {notesFolder.split("/").pop() || notesFolder}
          </span>
          <span className="shrink-0 opacity-60">change</span>
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
  updatedAt: number;
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
  onMoveToParent: (id: string, targetFolderId: string | null) => void;
  onReveal: (path: string) => void;
  onCopyPath: (path: string) => void;
}

function FileRow({
  id,
  path,
  title,
  updatedAt,
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
  onMoveToParent,
  onReveal,
  onCopyPath,
}: FileRowProps) {
  const parentId = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null;
  const grandparentId = parentId?.includes("/")
    ? parentId.slice(0, parentId.lastIndexOf("/"))
    : null;

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
            if (!isEditing && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onSwitch(id);
            }
          }}
          style={{ paddingLeft: 8 + depth * 14 }}
          className={`group w-full flex items-start gap-2 pr-2 py-1.5 rounded-md text-left text-sm cursor-pointer transition-colors ${
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
          }`}
        >
          <FileText className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
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
              <div className="truncate font-medium text-[13px] leading-tight">
                {title}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {formatRelativeTime(updatedAt)}
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem disabled={!path} onSelect={() => onReveal(path)}>
          <FolderOpen className="size-4" />
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuItem disabled={!path} onSelect={() => onCopyPath(path)}>
          <Clipboard className="size-4" />
          Copy filepath
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onDuplicate(id)}>
          <Copy className="size-4" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!parentId}
          onSelect={() => onMoveToParent(id, grandparentId)}
        >
          <CornerUpLeft className="size-4" />
          Move to parent folder
        </ContextMenuItem>
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
  onMoveToParent: (id: string, targetFolderId: string | null) => void;
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
}

function TreeNodeView(props: TreeNodeViewProps) {
  const { node, depth, expanded, onToggleExpanded } = props;

  if (node.type === "file") {
    // Resolve the displayed updatedAt from the documents index when present
    // (it tracks live edits via debounced saves), falling back to the
    // filesystem's modified mtime for files we haven't loaded yet.
    const docMeta = props.documents.find((d) => d.id === node.id);
    return (
      <FileRow
        id={node.id}
        path={node.path}
        title={docMeta?.title || node.title}
        updatedAt={docMeta?.updatedAt ?? node.modified * 1000}
        depth={depth}
        isActive={node.id === props.activeDocId}
        isEditing={props.editingDocId === node.id}
        editingTitle={props.editingTitle}
        onSwitch={props.onSwitch}
        onStartRename={props.onStartRename}
        onCommitRename={props.onCommitRename}
        onCancelRename={props.onCancelRename}
        onChangeEditingTitle={props.onChangeEditingTitle}
        onDelete={props.onDelete}
        onDuplicate={props.onDuplicate}
        onMoveToParent={props.onMoveToParent}
        onReveal={props.onReveal}
        onCopyPath={props.onCopyPath}
      />
    );
  }

  // Folder node
  const isOpen = expanded.has(node.id);
  const isEditing = props.editingFolderId === node.id;
  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={() => {
              if (!isEditing) onToggleExpanded(node.id);
            }}
            style={{ paddingLeft: 4 + depth * 14 }}
            className="group w-full flex items-center gap-1 pr-2 py-1.5 rounded-md text-left text-[13px] text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            {isOpen ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
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
        <ContextMenuContent className="w-44">
          <ContextMenuItem onSelect={() => props.onOpenFolder(node.path)}>
            <FolderOpen className="size-4" />
            Reveal in Finder
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
