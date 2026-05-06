
import { useState, useMemo, useEffect } from "react";
import type { DocumentMeta } from "@/types";
import type { NoteTreeNode } from "@/lib/notes-fs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  FileText,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

interface DocumentSidebarProps {
  documents: DocumentMeta[];
  activeDocId: string | null;
  noteTree: NoteTreeNode[];
  onCreateDocument: () => void;
  onSwitchDocument: (id: string) => void;
  onDeleteDocument: (id: string) => void;
  onRenameDocument: (id: string, newTitle: string) => void;
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
  onSwitchDocument,
  onDeleteDocument,
  onRenameDocument,
  notesFolder,
  onChangeNotesFolder,
}: DocumentSidebarProps) {
  const [search, setSearch] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
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
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onCreateDocument}
          title="New document"
        >
          <Plus className="size-3.5" />
        </Button>
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
}

function FileRow({
  id,
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
}: FileRowProps) {
  return (
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
      {!isEditing && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStartRename(id, title);
            }}
            className="p-0.5 rounded hover:bg-accent hover:text-accent-foreground"
            title="Rename document"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(id);
            }}
            className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive"
            title="Delete document"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
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
      />
    );
  }

  // Folder node
  const isOpen = expanded.has(node.id);
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleExpanded(node.id)}
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
        <span className="truncate font-medium">{node.name}</span>
      </button>
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
