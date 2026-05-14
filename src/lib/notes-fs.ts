import { invoke } from "@tauri-apps/api/core";

export interface NoteFile {
  id: string;
  path: string;
  title: string;
  content: string;
  modified: number;
}

// Tree node returned by list_note_tree — matches the Rust enum's serde shape.
export type NoteTreeNode =
  | {
      type: "file";
      id: string;
      path: string;
      title: string;
      content: string;
      modified: number;
    }
  | {
      type: "folder";
      id: string;
      path: string;
      name: string;
      children: NoteTreeNode[];
    };

export async function listNoteTree(): Promise<NoteTreeNode[]> {
  return invoke<NoteTreeNode[]>("list_note_tree");
}

// Walk a tree and yield every file node — useful for flattening into the
// existing id-keyed cache.
export function* walkFiles(
  nodes: NoteTreeNode[],
): Generator<Extract<NoteTreeNode, { type: "file" }>> {
  for (const n of nodes) {
    if (n.type === "file") {
      yield n;
    } else {
      yield* walkFiles(n.children);
    }
  }
}

export async function readNote(id: string): Promise<NoteFile> {
  return invoke<NoteFile>("read_note", { id });
}

export async function writeNote(id: string, content: string): Promise<NoteFile> {
  return invoke<NoteFile>("write_note", { id, content });
}

export async function renameNote(oldId: string, newId: string): Promise<NoteFile> {
  return invoke<NoteFile>("rename_note", { oldId, newId });
}

export async function renameFolder(oldId: string, newName: string): Promise<void> {
  return invoke<void>("rename_folder", { oldId, newName });
}

export async function createFolder(id: string): Promise<void> {
  return invoke<void>("create_folder", { id });
}

export async function deleteFolder(id: string): Promise<void> {
  return invoke<void>("delete_folder", { id });
}

export async function deleteNote(id: string): Promise<void> {
  return invoke<void>("delete_note", { id });
}

export function sanitizeNoteId(input: string): string {
  // Filenames must be filesystem-safe and not collide with .md extension or
  // sidecar conventions. Strip path separators and obvious bad characters.
  return input
    .trim()
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\.md$/i, "")
    .replace(/^\.+/, "")
    .slice(0, 120) || "untitled";
}
