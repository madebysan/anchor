
import { useState, useMemo } from "react";
import type { DocumentMeta } from "@/types";
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
import { FileText, FolderOpen, Pencil, Plus, Search, Trash2 } from "lucide-react";

interface DocumentSidebarProps {
  documents: DocumentMeta[];
  activeDocId: string | null;
  onCreateDocument: () => void;
  onSwitchDocument: (id: string) => void;
  onDeleteDocument: (id: string) => void;
  onRenameDocument: (id: string, newTitle: string) => void;
  notesFolder?: string;
  onChangeNotesFolder?: () => void;
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

      {/* Document list */}
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-0.5">
          {filteredDocs.map((doc) => {
            const isActive = doc.id === activeDocId;
            const isEditing = editingDocId === doc.id;

            // Commit the rename (Enter or blur)
            const commitRename = () => {
              const trimmed = editingTitle.trim();
              if (trimmed && trimmed !== doc.title) {
                onRenameDocument(doc.id, trimmed);
              }
              setEditingDocId(null);
            };

            return (
              <div
                key={doc.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!isEditing) onSwitchDocument(doc.id);
                }}
                onKeyDown={(e) => {
                  if (!isEditing && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onSwitchDocument(doc.id);
                  }
                }}
                className={`group w-full flex items-start gap-2 px-2.5 py-2 rounded-md text-left text-sm cursor-pointer transition-colors ${
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
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        }
                        if (e.key === "Escape") {
                          setEditingDocId(null);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full bg-transparent border border-border rounded px-1 py-0 text-[13px] font-medium leading-tight outline-none focus:border-primary"
                    />
                  ) : (
                    <div className="truncate font-medium text-[13px] leading-tight">
                      {doc.title}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {formatRelativeTime(doc.updatedAt)}
                  </div>
                </div>
                {/* Rename + Delete buttons — only visible on hover */}
                {!isEditing && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingDocId(doc.id);
                        setEditingTitle(doc.title);
                      }}
                      className="p-0.5 rounded hover:bg-accent hover:text-accent-foreground"
                      title="Rename document"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteId(doc.id);
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
          })}
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
