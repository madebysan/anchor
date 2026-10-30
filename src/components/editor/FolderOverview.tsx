import { FolderOpen } from "lucide-react";
import { getNoteTree } from "@/lib/persistence";
import type { NoteTreeNode } from "@/lib/notes-fs";
import { mentionPath } from "@/lib/terminal";

interface FolderOverviewProps {
  path: string;
  notesFolder?: string;
}

function countNotes(path: string): { notes: number; folders: number } {
  const find = (nodes: NoteTreeNode[]): NoteTreeNode | null => {
    for (const node of nodes) {
      if (node.type !== "folder") continue;
      if (node.path === path) return node;
      const inner = find(node.children);
      if (inner) return inner;
    }
    return null;
  };
  const folder = find(getNoteTree());
  let notes = 0;
  let folders = 0;
  const walk = (nodes: NoteTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "file") notes++;
      else {
        folders++;
        walk(node.children);
      }
    }
  };
  if (folder?.type === "folder") walk(folder.children);
  return { notes, folders };
}

/** Shown instead of the editor while a folder is selected for its conversation. */
export default function FolderOverview({ path, notesFolder }: FolderOverviewProps) {
  // Cheap to count; the page re-renders whenever the note tree refreshes.
  const { notes, folders } = countNotes(path);
  const relative = mentionPath(path, notesFolder);
  const name = relative.split("/").pop() || relative;
  const parts = [`${notes} ${notes === 1 ? "note" : "notes"}`];
  if (folders > 0) parts.push(`${folders} ${folders === 1 ? "folder" : "folders"}`);

  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <FolderOpen className="mb-4 size-12 text-muted-foreground/40" aria-hidden />
      <h1 className="text-lg font-semibold text-foreground">{name}</h1>
      {relative !== name && <p className="mt-0.5 text-xs text-muted-foreground">{relative}</p>}
      <p className="mt-2 text-sm text-muted-foreground">{parts.join(" · ")}</p>
      <p className="mt-6 max-w-sm text-xs leading-relaxed text-muted-foreground">
        Ask Claude about this folder in the sidebar: summarize it, rename or reorganize its notes. Pick a note to go back to
        editing.
      </p>
    </div>
  );
}
