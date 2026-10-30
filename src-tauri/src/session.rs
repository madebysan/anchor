//! A long-running Claude Code session behind the Chat tab.
//!
//! Claude runs in print mode with streaming JSON on both pipes, so one process
//! keeps the conversation across turns. Each line Claude prints is forwarded
//! to the window unchanged as a `claude-session-event`; the chat UI decides
//! what to show. Claude works in the notes folder with its usual tools and
//! the user's own settings, and edits are accepted on disk. Anchor applies a
//! change to the open note in place, selected, and ⌘Z undoes it.

use crate::config::ConfigState;
use crate::terminal::{is_inherited_session_marker, working_directory};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

/// Keep the tail of stderr for error messages, not the whole stream.
const STDERR_TAIL_BYTES: usize = 4 * 1024;

const NOTE_SYSTEM_PROMPT: &str = "You are running inside Anchor, a Markdown editor for a folder of notes, \
which is your working directory. This conversation belongs to one note. Each user message starts with an \
<anchor-context> block naming that note and any text the user selected; \"this note\", \"this\", or \
\"the selection\" refer to it. To change the note, edit the file directly with your edit tools; Anchor shows \
the change in place and the user can undo it, so do not paste rewritten text into the chat instead. To add \
a diagram, write a ```mermaid fenced code block; Anchor renders it. Keep replies \
short: the user reads them in a narrow sidebar.";

const FOLDER_SYSTEM_PROMPT: &str = "You are running inside Anchor, a Markdown editor. This conversation \
belongs to one folder inside the notes folder (your working directory). Each user message starts with an \
<anchor-context> block naming the folder and listing its notes; \"this folder\" and \"these files\" refer \
to it. Work on the files directly (rename, move, edit, summarize). Stay inside that folder unless the user \
names another path. Keep replies short: the user reads them in a narrow sidebar.";

/// Which kind of conversation a session is: one note, or one folder.
#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionScope {
    Note,
    Folder,
}

struct Session {
    child: Child,
    stdin: ChildStdin,
}

pub struct ClaudeSessionState {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

impl ClaudeSessionState {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn kill_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, mut session) in sessions.drain() {
                let _ = session.child.kill();
            }
        }
    }
}

#[derive(Serialize, Clone)]
struct SessionLine {
    id: u32,
    line: String,
}

#[derive(Serialize, Clone)]
struct SessionExit {
    id: u32,
    code: Option<i32>,
    stderr: String,
}

/// Start Claude. `resume` continues an earlier session by its id. Note
/// sessions accept edits (Anchor reviews them in the note); folder sessions
/// use the user's own default permission mode, since renames and moves need
/// commands.
#[tauri::command]
pub fn claude_session_start(
    app: AppHandle,
    state: State<'_, ClaudeSessionState>,
    config: State<'_, ConfigState>,
    resume: Option<String>,
    scope: SessionScope,
) -> Result<u32, String> {
    let mut command = Command::new("claude");
    command
        .arg("-p")
        .args(["--input-format", "stream-json"])
        .args(["--output-format", "stream-json"])
        .arg("--verbose")
        .arg("--include-partial-messages")
        // Without a prompt tool, a permission Claude cannot get makes it wait
        // forever. With `stdio`, it asks over the same pipe instead and Anchor
        // shows the question in the chat (see claude_session_answer).
        .args(["--permission-prompt-tool", "stdio"]);
    match scope {
        SessionScope::Note => {
            command
                .args(["--permission-mode", "acceptEdits"])
                .args(["--append-system-prompt", NOTE_SYSTEM_PROMPT]);
        }
        SessionScope::Folder => {
            command.args(["--append-system-prompt", FOLDER_SYSTEM_PROMPT]);
        }
    }
    if let Some(session_id) = resume.filter(|id| !id.trim().is_empty()) {
        command.args(["--resume", session_id.trim()]);
    }
    // Every session runs from the notes folder: Claude files sessions by
    // working directory, so resuming keeps working after a folder is renamed.
    command.current_dir(working_directory(&config));
    for (name, _) in std::env::vars_os() {
        if name.to_str().is_some_and(is_inherited_session_marker) {
            command.env_remove(&name);
        }
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start Claude Code: {e}. Is `claude` installed?"))?;
    let stdin = child.stdin.take().ok_or("Claude's input is unavailable")?;
    let stdout = child.stdout.take().ok_or("Claude's output is unavailable")?;
    let mut stderr = child.stderr.take().ok_or("Claude's errors are unavailable")?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state
        .sessions
        .lock()
        .map_err(|_| "session state unavailable".to_string())?
        .insert(id, Session { child, stdin });

    let stderr_tail = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
    let stderr_sink = stderr_tail.clone();
    thread::spawn(move || {
        let mut buffer = [0u8; 2048];
        while let Ok(count) = stderr.read(&mut buffer) {
            if count == 0 {
                break;
            }
            if let Ok(mut tail) = stderr_sink.lock() {
                tail.extend_from_slice(&buffer[..count]);
                let excess = tail.len().saturating_sub(STDERR_TAIL_BYTES);
                tail.drain(..excess);
            }
        }
    });

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let _ = app.emit("claude-session-event", SessionLine { id, line });
        }
        let code = app.try_state::<ClaudeSessionState>().and_then(|state| {
            let session = state.sessions.lock().ok()?.remove(&id);
            session.and_then(|mut session| session.child.wait().ok()).and_then(|status| status.code())
        });
        let stderr = stderr_tail
            .lock()
            .map(|tail| String::from_utf8_lossy(&tail).to_string())
            .unwrap_or_default();
        let _ = app.emit("claude-session-exit", SessionExit { id, code, stderr });
    });

    Ok(id)
}

/// Send one user message to a running session.
#[tauri::command]
pub fn claude_session_send(state: State<'_, ClaudeSessionState>, id: u32, text: String) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "session state unavailable".to_string())?;
    let session = sessions.get_mut(&id).ok_or("Claude has stopped")?;
    let message = json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": text }] },
    });
    writeln!(session.stdin, "{message}")
        .and_then(|_| session.stdin.flush())
        .map_err(|e| format!("Could not send the message to Claude: {e}"))
}

/// Answer a permission question Claude sent as a `control_request`.
#[tauri::command]
pub fn claude_session_answer(
    state: State<'_, ClaudeSessionState>,
    id: u32,
    request_id: String,
    allow: bool,
    input: Option<serde_json::Value>,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "session state unavailable".to_string())?;
    let session = sessions.get_mut(&id).ok_or("Claude has stopped")?;
    let decision = if allow {
        json!({ "behavior": "allow", "updatedInput": input.unwrap_or_else(|| json!({})) })
    } else {
        json!({ "behavior": "deny", "message": "The user declined this in Anchor." })
    };
    let message = json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id, "response": decision },
    });
    writeln!(session.stdin, "{message}")
        .and_then(|_| session.stdin.flush())
        .map_err(|e| format!("Could not answer Claude: {e}"))
}

/// End a session. Its conversation stays on disk and can be resumed.
#[tauri::command]
pub fn claude_session_stop(state: State<'_, ClaudeSessionState>, id: u32) {
    let session = state.sessions.lock().ok().and_then(|mut sessions| sessions.remove(&id));
    if let Some(mut session) = session {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
}
