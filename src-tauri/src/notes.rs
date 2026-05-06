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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum NoteTreeNode {
    File {
        id: String,
        path: String,
        title: String,
        content: String,
        modified: u64,
    },
    Folder {
        id: String,
        path: String,
        name: String,
        children: Vec<NoteTreeNode>,
    },
}

// Folder/file names we never traverse into. Hidden dirs (starting with `.`)
// are also skipped via a separate check.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
];

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

// Write content to an arbitrary user-chosen path. The path comes from the
// native save dialog (tauri-plugin-dialog), so the user has explicitly opted
// in to that location — no folder-scope check required.
#[tauri::command]
pub fn write_export_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("write: {e}"))
}

// Walk the notes folder recursively. Returns a tree of NoteTreeNode. The
// `id` of each file is its relative path from the notes folder, with the
// `.md` extension stripped — same convention as the flat list_notes command,
// just with `/` separators in subfolder cases. read_note/write_note still
// take this id and resolve it correctly.
fn walk_dir(root: &Path, dir: &Path, depth: usize) -> Vec<NoteTreeNode> {
    if depth > 20 {
        return Vec::new(); // pathological symlink loop guard
    }

    let mut nodes = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return nodes,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };

        if name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            if SKIP_DIRS.iter().any(|d| *d == name) {
                continue;
            }
            let children = walk_dir(root, &path, depth + 1);
            if children.is_empty() {
                continue; // hide folders that contain no .md files
            }
            let rel = path
                .strip_prefix(root)
                .ok()
                .and_then(|p| p.to_str())
                .unwrap_or(&name)
                .replace('\\', "/");
            nodes.push(NoteTreeNode::Folder {
                id: rel.clone(),
                path: path.to_string_lossy().to_string(),
                name,
                children,
            });
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
            if ext.as_deref() != Some("md") {
                continue;
            }
            let stem = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) if !s.is_empty() => s.to_string(),
                _ => continue,
            };
            // ID = relative path with extension stripped, forward-slash separated.
            let rel_with_ext = path
                .strip_prefix(root)
                .ok()
                .and_then(|p| p.to_str())
                .map(|s| s.replace('\\', "/"))
                .unwrap_or_else(|| name.clone());
            let id = rel_with_ext
                .strip_suffix(".md")
                .unwrap_or(&rel_with_ext)
                .to_string();

            let content = fs::read_to_string(&path).unwrap_or_default();
            nodes.push(NoteTreeNode::File {
                id,
                path: path.to_string_lossy().to_string(),
                title: stem,
                content,
                modified: modified_secs(&path),
            });
        }
    }

    // Folders before files, then alphabetically by display name.
    nodes.sort_by(|a, b| {
        let key = |n: &NoteTreeNode| match n {
            NoteTreeNode::Folder { name, .. } => (0, name.to_ascii_lowercase()),
            NoteTreeNode::File { title, .. } => (1, title.to_ascii_lowercase()),
        };
        key(a).cmp(&key(b))
    });
    nodes
}

#[tauri::command]
pub fn list_note_tree(state: State<'_, ConfigState>) -> Result<Vec<NoteTreeNode>, String> {
    let folder = notes_folder(&state)?;
    Ok(walk_dir(&folder, &folder, 0))
}
