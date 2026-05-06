import { invoke } from "@tauri-apps/api/core";

export interface NoteFile {
  id: string;
  path: string;
  title: string;
  content: string;
  modified: number;
}

export async function listNotes(): Promise<NoteFile[]> {
  return invoke<NoteFile[]>("list_notes");
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

export async function deleteNote(id: string): Promise<void> {
  return invoke<void>("delete_note", { id });
}

export function sanitizeNoteId(input: string): string {
  // Filenames must be filesystem-safe and not collide with .md extension or
  // sidecar conventions. Strip path separators and obvious bad characters.
  return input
    .trim()
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\.md$/i, "")
    .replace(/^\.+/, "")
    .slice(0, 120) || "untitled";
}
