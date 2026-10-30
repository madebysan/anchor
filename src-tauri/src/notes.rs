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
    /// Changes whenever the file does (mtime in nanoseconds and size), so a
    /// refresh can skip reading notes that are unchanged.
    pub version: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum NoteTreeNode {
    File {
        id: String,
        path: String,
        title: String,
        /// Only sent when asked for; a refresh lists versions and then reads
        /// just the notes that changed (`read_notes`).
        #[serde(skip_serializing_if = "Option::is_none", default)]
        content: Option<String>,
        modified: u64,
        version: String,
        /// Version of the note's comment sidecar, when it has one.
        #[serde(skip_serializing_if = "Option::is_none", default)]
        threads_version: Option<String>,
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
const SKIP_DIRS: &[&str] = &["node_modules", "target", ".git", "dist", "build"];

fn notes_folder(state: &State<'_, ConfigState>) -> Result<PathBuf, String> {
    let guard = state.0.lock().expect("config mutex poisoned");
    guard
        .notes_folder
        .clone()
        .ok_or_else(|| "Notes folder not set".to_string())
}

fn file_version(path: &Path) -> String {
    match fs::metadata(path) {
        Ok(meta) => {
            let nanos = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            format!("{nanos}-{}", meta.len())
        }
        Err(_) => String::new(),
    }
}

fn modified_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// Resolve `.` and `..` segments without following symlinks. We don't use
// Path::canonicalize because the user's notes folder may contain symlinks
// (e.g. ~/Projects/foo → ~/Library/CloudStorage/...) — canonicalize would
// resolve them into a path that no longer starts with the chosen folder.
fn normalize(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

// Verifies the target path is inside the notes folder (at any depth).
// Uses a literal-prefix match on normalized paths so symlinks inside the
// notes folder (Google Drive sync, etc.) are treated as belonging to the
// folder.
fn ensure_inside(folder: &Path, target: &Path) -> Result<(), String> {
    let folder_norm = normalize(folder);
    let target_norm = normalize(target);

    if !target_norm.starts_with(&folder_norm) {
        return Err(format!(
            "File is outside notes folder (file: {}, folder: {})",
            target_norm.display(),
            folder_norm.display()
        ));
    }
    Ok(())
}

fn note_path(folder: &Path, id: &str) -> PathBuf {
    folder.join(format!("{id}.md"))
}

fn thread_path(folder: &Path, id: &str) -> PathBuf {
    folder.join(format!("{id}.md.threads.json"))
}

fn validate_folder_id(id: &str) -> Result<(), String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("Folder id cannot be empty".to_string());
    }
    if trimmed.split('/').any(|segment| {
        segment.is_empty() || segment == "." || segment == ".." || segment.contains('\\')
    }) {
        return Err("Folder id contains an invalid path segment".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn write_note_threads(
    state: State<'_, ConfigState>,
    watcher_state: State<'_, crate::watcher::WatcherState>,
    id: String,
    content: String,
) -> Result<(), String> {
    let folder = notes_folder(&state)?;
    let target = thread_path(&folder, &id);
    ensure_inside(&folder, &target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create thread parent dirs: {e}"))?;
    }
    fs::write(&target, &content).map_err(|e| format!("write threads: {e}"))?;
    crate::watcher::mark_self_write(&watcher_state, &target);
    Ok(())
}

#[tauri::command]
pub fn delete_note_threads(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    let folder = notes_folder(&state)?;
    let target = thread_path(&folder, &id);
    ensure_inside(&folder, &target)?;
    if target.exists() {
        fs::remove_file(&target).map_err(|e| format!("remove threads: {e}"))?;
    }
    Ok(())
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
        version: file_version(&target),
    })
}

#[tauri::command]
pub fn write_note(
    state: State<'_, ConfigState>,
    watcher_state: State<'_, crate::watcher::WatcherState>,
    id: String,
    content: String,
) -> Result<NoteFile, String> {
    let folder = notes_folder(&state)?;
    let target = note_path(&folder, &id);
    ensure_inside(&folder, &target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent dirs: {e}"))?;
    }
    fs::write(&target, &content).map_err(|e| format!("write: {e}"))?;
    // Mark this path as a self-write so the file watcher doesn't bounce
    // the change back to the editor as if it were external.
    crate::watcher::mark_self_write(&watcher_state, &target);
    Ok(NoteFile {
        id: id.clone(),
        path: target.to_string_lossy().to_string(),
        title: id,
        content,
        modified: modified_secs(&target),
        version: file_version(&target),
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
    let old_threads_path = thread_path(&folder, &old_id);
    let new_threads_path = thread_path(&folder, &new_id);
    ensure_inside(&folder, &old_path)?;
    ensure_inside(&folder, &new_path)?;
    ensure_inside(&folder, &old_threads_path)?;
    ensure_inside(&folder, &new_threads_path)?;
    if new_path.exists() {
        return Err(format!("A note named '{new_id}' already exists"));
    }
    if old_threads_path.exists() && new_threads_path.exists() {
        return Err(format!("Thread sidecar for '{new_id}' already exists"));
    }
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent dirs: {e}"))?;
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("rename: {e}"))?;
    if old_threads_path.exists() {
        if let Some(parent) = new_threads_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create thread parent dirs: {e}"))?;
        }
        fs::rename(&old_threads_path, &new_threads_path)
            .map_err(|e| format!("rename threads: {e}"))?;
    }
    let content = fs::read_to_string(&new_path).unwrap_or_default();
    Ok(NoteFile {
        id: new_id.clone(),
        path: new_path.to_string_lossy().to_string(),
        title: new_id,
        content,
        modified: modified_secs(&new_path),
        version: file_version(&new_path),
    })
}

/// Move a folder (with everything in it) into another folder, or to the top
/// of the notes folder when `target_parent` is empty. Returns the new id.
#[tauri::command]
pub fn move_folder(
    state: State<'_, ConfigState>,
    id: String,
    target_parent: Option<String>,
) -> Result<String, String> {
    let folder = notes_folder(&state)?;
    let old_path = folder.join(&id);
    ensure_inside(&folder, &old_path)?;
    let name = old_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Folder has no name".to_string())?
        .to_string();
    let parent = match target_parent.as_deref().map(str::trim) {
        Some(t) if !t.is_empty() => folder.join(t),
        _ => folder.clone(),
    };
    let new_path = parent.join(&name);
    ensure_inside(&folder, &new_path)?;
    if new_path == old_path {
        return Ok(id);
    }
    if new_path.starts_with(&old_path) {
        return Err("A folder can't move into itself".to_string());
    }
    if !parent.is_dir() {
        return Err("The target folder doesn't exist".to_string());
    }
    if new_path.exists() {
        return Err(format!("A folder named '{name}' is already there"));
    }
    fs::rename(&old_path, &new_path).map_err(|e| format!("move folder: {e}"))?;
    Ok(new_path
        .strip_prefix(&folder)
        .ok()
        .and_then(|p| p.to_str())
        .unwrap_or(&name)
        .replace('\\', "/"))
}

#[tauri::command]
pub fn rename_folder(
    state: State<'_, ConfigState>,
    old_id: String,
    new_name: String,
) -> Result<(), String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Folder name cannot contain path separators".to_string());
    }

    let folder = notes_folder(&state)?;
    let old_path = folder.join(&old_id);
    ensure_inside(&folder, &old_path)?;

    let parent = old_path
        .parent()
        .ok_or_else(|| "Folder has no parent".to_string())?;
    let new_path = parent.join(trimmed);
    ensure_inside(&folder, &new_path)?;

    if new_path.exists() {
        return Err(format!("A folder named '{trimmed}' already exists"));
    }

    fs::rename(&old_path, &new_path).map_err(|e| format!("rename folder: {e}"))
}

#[tauri::command]
pub fn create_folder(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    validate_folder_id(&id)?;
    let folder = notes_folder(&state)?;
    let target = folder.join(&id);
    ensure_inside(&folder, &target)?;
    fs::create_dir_all(&target).map_err(|e| format!("create folder: {e}"))
}

#[tauri::command]
pub fn delete_folder(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    validate_folder_id(&id)?;
    let folder = notes_folder(&state)?;
    let target = folder.join(&id);
    ensure_inside(&folder, &target)?;
    if target == normalize(&folder) {
        return Err("Cannot delete the notes folder".to_string());
    }
    fs::remove_dir_all(&target).map_err(|e| format!("delete folder: {e}"))
}

#[tauri::command]
pub fn delete_note(state: State<'_, ConfigState>, id: String) -> Result<(), String> {
    let folder = notes_folder(&state)?;
    let target = note_path(&folder, &id);
    let threads_target = thread_path(&folder, &id);
    ensure_inside(&folder, &target)?;
    ensure_inside(&folder, &threads_target)?;
    fs::remove_file(&target).map_err(|e| format!("remove: {e}"))?;
    if threads_target.exists() {
        fs::remove_file(&threads_target).map_err(|e| format!("remove threads: {e}"))?;
    }
    Ok(())
}

/// Export the open note: Anchor shows the save dialog itself and writes where
/// the user chose. The webview never passes a path, so it cannot write
/// anywhere else. Returns false when the dialog is cancelled.
#[tauri::command]
pub async fn export_note(
    app: tauri::AppHandle,
    file_name: String,
    extension: String,
    content: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if extension != "md" && extension != "txt" {
        return Err(format!("Cannot export as .{extension}"));
    }
    let title = format!("Export as {}", extension.to_uppercase());
    let picked = app
        .dialog()
        .file()
        .set_title(&title)
        .set_file_name(&file_name)
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(false) };
    let path = picked.into_path().map_err(|e| format!("export path: {e}"))?;
    fs::write(&path, &content).map_err(|e| format!("write: {e}"))?;
    Ok(true)
}

// Open or reveal a path in the OS file manager. The target must stay inside
// the configured notes folder because these commands are callable from the
// app webview.
#[tauri::command]
pub fn open_path(state: State<'_, ConfigState>, path: String) -> Result<(), String> {
    use std::process::Command;

    let folder = notes_folder(&state)?;
    let target = PathBuf::from(&path);
    ensure_inside(&folder, &target)?;
    if !target.exists() {
        return Err(format!("Path does not exist: {}", target.display()));
    }

    // Through Finder, so a folder that is really an app bundle (`Name.app`)
    // or a script in the notes folder is shown, never launched.
    #[cfg(target_os = "macos")]
    let cmd = Command::new("open").arg("-a").arg("Finder").arg(&target).spawn();

    #[cfg(target_os = "windows")]
    let cmd = Command::new("explorer").arg(&target).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = Command::new("xdg-open").arg(&target).spawn();

    cmd.map(|_| ()).map_err(|e| format!("open: {e}"))
}

/// Open a web or mail link from the chat in the default browser or mail app.
/// Other schemes are refused so a reply cannot launch arbitrary handlers.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let lower = url.trim().to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) {
        return Err(format!("Not a web or mail link: {url}"));
    }

    #[cfg(target_os = "macos")]
    let cmd = std::process::Command::new("open").arg(url.trim()).spawn();

    #[cfg(target_os = "windows")]
    let cmd = std::process::Command::new("explorer").arg(url.trim()).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = std::process::Command::new("xdg-open").arg(url.trim()).spawn();

    cmd.map(|_| ()).map_err(|e| format!("open: {e}"))
}

#[tauri::command]
pub fn reveal_path(state: State<'_, ConfigState>, path: String) -> Result<(), String> {
    use std::process::Command;

    let folder = notes_folder(&state)?;
    let target = PathBuf::from(&path);
    ensure_inside(&folder, &target)?;
    if !target.exists() {
        return Err(format!("Path does not exist: {}", target.display()));
    }

    #[cfg(target_os = "macos")]
    let cmd = Command::new("open").arg("-R").arg(&target).spawn();

    #[cfg(target_os = "windows")]
    let cmd = Command::new("explorer")
        .arg("/select,")
        .arg(&target)
        .spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = Command::new("xdg-open")
        .arg(target.parent().unwrap_or(&target))
        .spawn();

    cmd.map(|_| ()).map_err(|e| format!("reveal: {e}"))
}

// Walk the notes folder recursively. Returns a tree of NoteTreeNode. The
// `id` of each file is its relative path from the notes folder, with the
// `.md` extension stripped. read_note/write_note take this id and resolve it
// correctly across subfolders.
fn walk_dir(root: &Path, dir: &Path, depth: usize, with_content: bool) -> Vec<NoteTreeNode> {
    if depth > 20 {
        return Vec::new(); // pathological symlink loop guard
    }

    let mut nodes = Vec::new();
    let entries: Vec<fs::DirEntry> = match fs::read_dir(dir) {
        Ok(e) => e.flatten().collect(),
        Err(_) => return nodes,
    };
    // Comment sidecars sit next to their note as `<name>.md.threads.json`.
    let sidecar_suffix = ".threads.json";
    let sidecars: std::collections::HashMap<String, String> = entries
        .iter()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            let note_name = name.strip_suffix(sidecar_suffix)?.to_string();
            Some((note_name, file_version(&entry.path())))
        })
        .collect();

    for entry in entries {
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
            let children = walk_dir(root, &path, depth + 1, with_content);
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
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase());
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

            let content = with_content.then(|| fs::read_to_string(&path).unwrap_or_default());
            nodes.push(NoteTreeNode::File {
                id,
                path: path.to_string_lossy().to_string(),
                title: stem,
                content,
                modified: modified_secs(&path),
                version: file_version(&path),
                threads_version: sidecars.get(&name).cloned(),
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

/// The notes folder as a tree. With `contents: false` only names and
/// versions are sent, which is all a refresh needs to find what changed.
#[tauri::command]
pub fn list_note_tree(
    state: State<'_, ConfigState>,
    contents: Option<bool>,
) -> Result<Vec<NoteTreeNode>, String> {
    let folder = notes_folder(&state)?;
    Ok(walk_dir(&folder, &folder, 0, contents.unwrap_or(true)))
}

/// Read several notes in one call. Notes that are gone are left out.
#[tauri::command]
pub fn read_notes(state: State<'_, ConfigState>, ids: Vec<String>) -> Result<Vec<NoteFile>, String> {
    let folder = notes_folder(&state)?;
    let mut notes = Vec::with_capacity(ids.len());
    for id in ids {
        let target = note_path(&folder, &id);
        if ensure_inside(&folder, &target).is_err() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&target) else { continue };
        notes.push(NoteFile {
            path: target.to_string_lossy().to_string(),
            title: id.clone(),
            id,
            content,
            modified: modified_secs(&target),
            version: file_version(&target),
        });
    }
    Ok(notes)
}

#[derive(Serialize, Debug)]
pub struct NoteThreads {
    pub id: String,
    pub content: String,
}

/// Read several comment sidecars in one call. Missing ones are left out.
#[tauri::command]
pub fn read_notes_threads(state: State<'_, ConfigState>, ids: Vec<String>) -> Result<Vec<NoteThreads>, String> {
    let folder = notes_folder(&state)?;
    let mut out = Vec::new();
    for id in ids {
        let target = thread_path(&folder, &id);
        if ensure_inside(&folder, &target).is_err() {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&target) {
            out.push(NoteThreads { id, content });
        }
    }
    Ok(out)
}
