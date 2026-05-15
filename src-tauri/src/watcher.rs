use crate::config::ConfigState;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// Window during which a file change matching a path we wrote is treated as
/// our own save — keeps the watcher from fighting Tiptap's debounced writes.
const SELF_WRITE_GUARD: Duration = Duration::from_millis(1500);

/// Coalesce rapid-fire events from the OS into a single notification per path.
const DEBOUNCE: Duration = Duration::from_millis(200);

pub struct WatcherState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    /// Paths we just wrote. The watcher checks this before forwarding events.
    pub self_writes: Mutex<HashMap<PathBuf, Instant>>,
    /// Last forwarded event per path; used to debounce.
    pub last_emit: Mutex<HashMap<PathBuf, Instant>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            self_writes: Mutex::new(HashMap::new()),
            last_emit: Mutex::new(HashMap::new()),
        }
    }
}

/// Record that we (Anchor) wrote `path`. Subsequent watcher events for
/// this path within SELF_WRITE_GUARD are skipped.
pub fn mark_self_write(state: &State<'_, WatcherState>, path: &Path) {
    if let Ok(mut map) = state.self_writes.lock() {
        map.insert(path.to_path_buf(), Instant::now());
    }
}

#[derive(Serialize, Clone)]
struct NotesChangedPayload {
    path: String,
    kind: &'static str, // "modified" | "created" | "removed" | "renamed"
}

fn classify_kind(kind: &EventKind) -> Option<&'static str> {
    use notify::event::{ModifyKind, RenameMode};
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Remove(_) => Some("removed"),
        EventKind::Modify(ModifyKind::Name(RenameMode::To))
        | EventKind::Modify(ModifyKind::Name(RenameMode::From))
        | EventKind::Modify(ModifyKind::Name(RenameMode::Both))
        | EventKind::Modify(ModifyKind::Name(RenameMode::Any)) => Some("renamed"),
        EventKind::Modify(_) => Some("modified"),
        _ => None,
    }
}

fn handle_event(app: &AppHandle, state: &WatcherState, event: Event) {
    let kind = match classify_kind(&event.kind) {
        Some(k) => k,
        None => return,
    };

    let now = Instant::now();

    for path in event.paths {
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        let is_markdown = extension.as_deref() == Some("md");
        let is_structural = matches!(kind, "created" | "removed" | "renamed") && extension.is_none();

        // Markdown file changes are always relevant. Directory create/remove/
        // rename events are also relevant because they can move notes around
        // without emitting a per-file event on every platform.
        if !is_markdown && !is_structural {
            continue;
        }

        // Skip if we just wrote this path ourselves.
        if let Ok(mut writes) = state.self_writes.lock() {
            // Prune stale entries while we're here.
            writes.retain(|_, t| now.duration_since(*t) < SELF_WRITE_GUARD);
            if let Some(t) = writes.get(&path) {
                if now.duration_since(*t) < SELF_WRITE_GUARD {
                    continue;
                }
            }
        }

        // Debounce per-path.
        if let Ok(mut last) = state.last_emit.lock() {
            if let Some(prev) = last.get(&path) {
                if now.duration_since(*prev) < DEBOUNCE {
                    continue;
                }
            }
            last.insert(path.clone(), now);
        }

        let payload = NotesChangedPayload {
            path: path.to_string_lossy().to_string(),
            kind,
        };
        if let Err(e) = app.emit("notes-changed", payload) {
            log::warn!("notes-changed emit failed: {e}");
        }
    }
}

/// Start (or restart) the watcher on the configured notes folder.
#[tauri::command]
pub fn start_watching_notes(
    app: AppHandle,
    config: State<'_, ConfigState>,
    watcher_state: State<'_, WatcherState>,
) -> Result<(), String> {
    let folder = {
        let guard = config.0.lock().expect("config mutex poisoned");
        guard
            .notes_folder
            .clone()
            .ok_or_else(|| "Notes folder not set".to_string())?
    };

    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            // Re-pull the watcher state from the app on each event.
            let s = app_handle.state::<WatcherState>();
            handle_event(&app_handle, &s, event);
        }
    })
    .map_err(|e| format!("create watcher: {e}"))?;

    watcher
        .watch(&folder, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {}: {e}", folder.display()))?;

    if let Ok(mut slot) = watcher_state.watcher.lock() {
        *slot = Some(watcher);
    }

    log::info!("file watcher started on {}", folder.display());
    Ok(())
}
