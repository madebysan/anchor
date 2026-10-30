//! Embedded terminal: a login shell in a pseudo-terminal, streamed to the
//! xterm.js panel in the window.
//!
//! The shell starts in the notes folder with `CLAUDE_CODE_SSE_PORT` and
//! `ENABLE_IDE_INTEGRATION` set, so `claude` run inside it connects to
//! Anchor's IDE server (see `ide.rs`) and follows the open note.

use crate::config::ConfigState;
use crate::ide::IdeState;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

const READ_BUFFER_BYTES: usize = 16 * 1024;

/// Markers a running Claude session sets for its own child processes. When
/// Anchor itself was started from inside a Claude session, a `claude` run in
/// Anchor's terminal would inherit them and act like a sub-session (no saved
/// transcript, wrong parent). Auth settings such as `ANTHROPIC_API_KEY` are
/// not markers and stay.
const INHERITED_SESSION_PREFIXES: [&str; 5] = [
    "CLAUDECODE",
    "CLAUDE_CODE_",
    "CLAUDE_AGENT_SDK_",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
];

pub(crate) fn is_inherited_session_marker(name: &str) -> bool {
    INHERITED_SESSION_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct TerminalState {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// End every shell, so no Claude keeps running after Anchor quits.
    pub fn kill_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, mut session) in sessions.drain() {
                let _ = session.child.kill();
            }
        }
    }
}

#[derive(Serialize, Clone)]
struct TerminalOutput {
    id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct TerminalExit {
    id: u32,
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(2),
        cols: cols.max(10),
        pixel_width: 0,
        pixel_height: 0,
    }
}

pub(crate) fn working_directory(config: &State<'_, ConfigState>) -> PathBuf {
    let configured = config
        .0
        .lock()
        .ok()
        .and_then(|config| config.notes_folder.clone())
        .filter(|path| path.is_dir());
    configured
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Start a login shell. `startup_command` (for example `claude`) is typed into
/// it once, so the shell stays open after the command exits.
#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    state: State<'_, TerminalState>,
    config: State<'_, ConfigState>,
    ide: State<'_, IdeState>,
    cols: u16,
    rows: u16,
    startup_command: Option<String>,
) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(pty_size(cols, rows))
        .map_err(|e| format!("Could not open a terminal: {e}"))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut command = CommandBuilder::new(&shell);
    command.arg("-l");
    for (name, _) in std::env::vars_os() {
        if name.to_str().is_some_and(is_inherited_session_marker) {
            command.env_remove(&name);
        }
    }
    command.cwd(working_directory(&config));
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "Anchor");
    // Apps opened from Finder often have no locale; without one, shells and
    // Claude fall back to ASCII and break non-English text.
    if std::env::var_os("LANG").is_none() {
        command.env("LANG", "en_US.UTF-8");
    }
    if let Some(port) = ide.port() {
        command.env("CLAUDE_CODE_SSE_PORT", port.to_string());
        command.env("ENABLE_IDE_INTEGRATION", "true");
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("Could not start {shell}: {e}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Could not read the terminal: {e}"))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Could not write to the terminal: {e}"))?;

    if let Some(startup) = startup_command.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()) {
        // The shell reads this once its startup files have run.
        let _ = writer.write_all(format!("{startup}\r").as_bytes());
    }

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state
        .sessions
        .lock()
        .map_err(|_| "terminal state unavailable".to_string())?
        .insert(
            id,
            Session {
                master: pair.master,
                writer,
                child,
            },
        );

    thread::spawn(move || {
        let mut buffer = vec![0u8; READ_BUFFER_BYTES];
        // Bytes of a UTF-8 character split across two reads.
        let mut pending: Vec<u8> = Vec::new();
        loop {
            let count = match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => count,
            };
            pending.extend_from_slice(&buffer[..count]);
            let data = take_complete_utf8(&mut pending);
            if !data.is_empty() {
                let _ = app.emit("terminal-output", TerminalOutput { id, data });
            }
        }
        if let Some(state) = app.try_state::<TerminalState>() {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(&id);
            }
        }
        let _ = app.emit("terminal-exit", TerminalExit { id });
    });

    Ok(id)
}

/// Return the longest valid UTF-8 prefix of `pending`, keeping an incomplete
/// trailing character for the next read. Invalid bytes become U+FFFD.
fn take_complete_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(text) => {
            let text = text.to_string();
            pending.clear();
            text
        }
        Err(error) if error.error_len().is_none() => {
            let valid = error.valid_up_to();
            let text = String::from_utf8_lossy(&pending[..valid]).to_string();
            pending.drain(..valid);
            text
        }
        Err(_) => {
            let text = String::from_utf8_lossy(pending).to_string();
            pending.clear();
            text
        }
    }
}

#[tauri::command]
pub fn terminal_write(state: State<'_, TerminalState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "terminal state unavailable".to_string())?;
    let session = sessions.get_mut(&id).ok_or("Terminal has closed")?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|e| format!("Could not write to the terminal: {e}"))
}

#[tauri::command]
pub fn terminal_resize(state: State<'_, TerminalState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "terminal state unavailable".to_string())?;
    let session = sessions.get(&id).ok_or("Terminal has closed")?;
    session
        .master
        .resize(pty_size(cols, rows))
        .map_err(|e| format!("Could not resize the terminal: {e}"))
}

#[tauri::command]
pub fn terminal_kill(state: State<'_, TerminalState>, id: u32) {
    let session = state.sessions.lock().ok().and_then(|mut sessions| sessions.remove(&id));
    if let Some(mut session) = session {
        let _ = session.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::{is_inherited_session_marker, take_complete_utf8};

    #[test]
    fn drops_claude_session_markers_but_keeps_auth() {
        assert!(is_inherited_session_marker("CLAUDECODE"));
        assert!(is_inherited_session_marker("CLAUDE_CODE_CHILD_SESSION"));
        assert!(is_inherited_session_marker("CLAUDE_CODE_SSE_PORT"));
        assert!(!is_inherited_session_marker("ANTHROPIC_API_KEY"));
        assert!(!is_inherited_session_marker("PATH"));
    }

    #[test]
    fn keeps_a_split_character_for_the_next_read() {
        let mut pending = "señal".as_bytes()[..3].to_vec(); // "se" + first byte of "ñ"
        assert_eq!(take_complete_utf8(&mut pending), "se");
        assert_eq!(pending.len(), 1);
        pending.extend_from_slice(&"señal".as_bytes()[3..]);
        assert_eq!(take_complete_utf8(&mut pending), "ñal");
        assert!(pending.is_empty());
    }
}
