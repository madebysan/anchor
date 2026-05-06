use crate::config::ConfigState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::State;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NoteFile {
    pub id: String,
    pub path: String,
    pub title: String,
    pub content: String,
    pub modified: u64,
}

fn notes_folder(state: &State<'_, ConfigState>) -> Result<PathBuf, String> {
    let guard = state.0.lock().expect("config mutex poisoned");
    guard
        .notes_folder
        .clone()
        .ok_or_else(|| "Notes folder not set".to_string())
}

fn modified_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn ensure_inside(folder: &Path, target: &Path) -> Result<(), String> {
    let folder_canon = folder
        .canonicalize()
        .map_err(|e| format!("notes folder canonicalize: {e}"))?;
    let target_parent = target
        .parent()
        .ok_or_else(|| "target has no parent".to_string())?;
    let parent_canon = target_parent
        .canonicalize()
        .map_err(|e| format!("parent canonicalize: {e}"))?;
    if parent_canon != folder_canon {
        return Err("Path is outside notes folder".to_string());
    }
    Ok(())
}

fn note_path(folder: &Path, id: &str) -> PathBuf {
    folder.join(format!("{id}.md"))
}

#[tauri::command]
pub fn list_notes(state: State<'_, ConfigState>) -> Result<Vec<NoteFile>, String> {
    let folder = notes_folder(&state)?;
    let entries = fs::read_dir(&folder).map_err(|e| format!("read dir: {e}"))?;
    let mut notes = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) != Some("md".to_string()) {
            continue;
        }
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        // Skip dotfile-style sidecars (e.g. .DS_Store equivalents).
        if stem.starts_with('.') {
            continue;
        }
        let content = fs::read_to_string(&path).unwrap_or_default();
        notes.push(NoteFile {
            id: stem.clone(),
            path: path.to_string_lossy().to_string(),
            title: stem,
            content,
            modified: modified_secs(&path),
        });
    }
    notes.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(notes)
}

#[tauri::command]
pub fn read_note(state: State<'_, ConfigState>, id: String) -> Result<NoteFile, String> {
    let folder = notes_folder(&state)?;
    let target = note_path(&folder, &id);
    ensure_inside(&folder, &target)?;
    let content = fs::read_to_string(&target).map_err(|e| format!("read: {e}"))?;
    Ok(NoteFile {
        id: id.clone(),
        path: target.to_string_lossy().to_string(),
        title: id,
        content,
        modified: modified_secs(&target),
    })
}

#[tauri::command]
pub fn write_note(
    state: State<'_, ConfigState>,
    id: String,
    content: String,
) -> Result<NoteFile, String> {
    let folder = notes_folder(&state)?;
    let target = note_path(&folder, &id);
    ensure_inside(&folder, &target)?;
    fs::write(&target, &content).map_err(|e| format!("write: {e}"))?;
    Ok(NoteFile {
        id: id.clone(),
        path: target.to_string_lossy().to_string(),
        title: id,
        content,
        modified: modified_secs(&target),
    })
}

#[tauri::command]
pub fn rename_note(
    state: State<'_, ConfigState>,
    old_id: String,
    new_id: String,
) -> Result<NoteFile, String> {
    let folder = notes_folder(&state)?;
    let old_path = note_path(&folder, &old_id);
    let new_path = note_path(&folder, &new_id);
    ensure_inside(&folder, &old_path)?;
    ensure_inside(&folder, &new_path)?;
    if new_path.exists() {
        return Err(format!("A note named '{new_id}' already exists"));
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("rename: {e}"))?;
    let content = fs::read_to_string(&new_path).unwrap_or_default();
    Ok(NoteFile {
        id: new_id.clone(),
        path: new_path.to_string_lossy().to_string(),
        title: new_id,
        content,
        modified: modified_secs(&new_path),
    })
}

#[tauri::command]
pub fn delete_note(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    let folder = notes_folder(&state)?;
    let target = note_path(&folder, &id);
    ensure_inside(&folder, &target)?;
    fs::remove_file(&target).map_err(|e| format!("remove: {e}"))?;
    Ok(())
}
