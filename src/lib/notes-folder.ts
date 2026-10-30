import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export async function getNotesFolder(): Promise<string | null> {
  const result = await invoke<string | null>("get_notes_folder");
  return result ?? null;
}

export async function persistNotesFolder(path: string): Promise<void> {
  await invoke<void>("set_notes_folder", { path });
}

export async function pickNotesFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose your notes folder",
  });
  if (!selected) return null;
  return Array.isArray(selected) ? selected[0] ?? null : selected;
}
