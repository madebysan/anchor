use crate::config::ConfigState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AiExecutionResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AiSessionResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    /// claude session id for future --resume calls. Some on success, None on error.
    pub session_id: Option<String>,
}

/// JSON shape returned by `claude --print --output-format json`.
/// We only unmarshal the fields we care about; everything else is ignored.
#[derive(Deserialize, Debug)]
struct ClaudeJsonResult {
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    is_error: bool,
}

#[derive(Clone)]
pub struct AiProcessState {
    pids: Arc<Mutex<HashMap<String, u32>>>,
}

impl AiProcessState {
    pub fn new() -> Self {
        Self {
            pids: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn register_process(state: &AiProcessState, request_id: &Option<String>, pid: u32) {
    if let Some(id) = request_id {
        if let Ok(mut pids) = state.pids.lock() {
            pids.insert(id.clone(), pid);
        }
    }
}

fn unregister_process(state: &AiProcessState, request_id: &Option<String>) {
    if let Some(id) = request_id {
        if let Ok(mut pids) = state.pids.lock() {
            pids.remove(id);
        }
    }
}

#[tauri::command]
pub fn ai_cancel_claude(
    process_state: State<'_, AiProcessState>,
    request_id: String,
) -> Result<bool, String> {
    let pid = {
        let mut pids = process_state
            .pids
            .lock()
            .map_err(|_| "ai process mutex poisoned".to_string())?;
        pids.remove(&request_id)
    };

    let Some(pid) = pid else {
        return Ok(false);
    };

    #[cfg(target_os = "windows")]
    let status = Command::new("taskkill")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .status();

    #[cfg(not(target_os = "windows"))]
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .status();

    status
        .map(|s| s.success())
        .map_err(|e| format!("cancel claude: {e}"))
}

// Resolve `claude` against PATH without actually running it. Avoids
// hangs or surprises from CLIs that do init work on every invocation.
fn find_in_path(bin: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for dir in env::split_paths(&path) {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[tauri::command]
pub fn ai_check_claude_cli() -> bool {
    let found = find_in_path("claude");
    if let Ok(path) = env::var("PATH") {
        log::info!("ai_check_claude_cli: PATH={path}");
    }
    log::info!("ai_check_claude_cli: claude resolved to {:?}", found);
    found.is_some()
}

// Same logic as notes.rs::ensure_inside — normalize without following
// symlinks so files in Drive-synced subfolders (which symlink out of the
// notes folder) still pass the prefix check.
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

fn claude_failure_message(status: ExitStatus, stderr: &str) -> String {
    let trimmed = stderr.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }

    match status.code() {
        Some(code) => format!("Claude Code exited with code {code} and did not print an error."),
        None => "Claude Code was terminated and did not print an error.".to_string(),
    }
}

// One-shot chat with claude — no file argument, just a prompt on stdin.
// Used for chat-only requests when no document context is needed.
#[tauri::command]
pub async fn ai_chat_claude(
    process_state: State<'_, AiProcessState>,
    prompt: String,
    request_id: Option<String>,
) -> Result<AiExecutionResult, String> {
    let process_state = process_state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        ai_chat_claude_blocking(process_state, prompt, request_id)
    })
    .await
    .map_err(|e| format!("claude chat task failed: {e}"))?
}

fn ai_chat_claude_blocking(
    process_state: AiProcessState,
    prompt: String,
    request_id: Option<String>,
) -> Result<AiExecutionResult, String> {
    let mut child = Command::new("claude")
        .arg("--dangerously-skip-permissions")
        .arg("--print")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to launch claude CLI: {e}. Install from https://claude.ai/code if missing."
            )
        })?;
    register_process(&process_state, &request_id, child.id());

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("write stdin: {e}"))?;
    }
    drop(child.stdin.take());

    let output = child.wait_with_output();
    unregister_process(&process_state, &request_id);
    let output = output.map_err(|e| format!("wait for claude: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if output.status.success() {
        Ok(AiExecutionResult {
            success: true,
            output: stdout,
            error: None,
        })
    } else {
        Ok(AiExecutionResult {
            success: false,
            output: stdout,
            error: Some(claude_failure_message(output.status, &stderr)),
        })
    }
}

// Session-aware claude invocation. Either:
//   - First call in a doc: pass `file_path` (claude reads the file once,
//     subsequent --resume calls reuse the cached context)
//   - Follow-up: pass `session_id` from the prior call's response
//   - Both empty: chat-only with no doc context (pre-session flow)
//
// Uses `--output-format json` so we can parse out the session_id for
// stitching follow-ups together. The prompt is piped via stdin.
#[tauri::command]
pub async fn ai_invoke_claude(
    state: State<'_, ConfigState>,
    process_state: State<'_, AiProcessState>,
    file_path: Option<String>,
    session_id: Option<String>,
    prompt: String,
    request_id: Option<String>,
) -> Result<AiSessionResult, String> {
    let notes_folder = {
        let guard = state.0.lock().expect("config mutex poisoned");
        guard.notes_folder.clone()
    };
    let process_state = process_state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        ai_invoke_claude_blocking(
            notes_folder,
            process_state,
            file_path,
            session_id,
            prompt,
            request_id,
        )
    })
    .await
    .map_err(|e| format!("claude invoke task failed: {e}"))?
}

fn ai_invoke_claude_blocking(
    notes_folder: Option<PathBuf>,
    process_state: AiProcessState,
    file_path: Option<String>,
    session_id: Option<String>,
    prompt: String,
    request_id: Option<String>,
) -> Result<AiSessionResult, String> {
    let mut cmd = Command::new("claude");
    cmd.arg("--dangerously-skip-permissions")
        .arg("--print")
        .arg("--output-format")
        .arg("json");

    if let Some(sid) = &session_id {
        cmd.arg("--resume").arg(sid);
    } else if let Some(fp) = &file_path {
        let folder = notes_folder.ok_or_else(|| "Notes folder not set".to_string())?;
        let target = PathBuf::from(fp);
        ensure_inside(&folder, &target)?;
        cmd.arg(target);
    }

    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to launch claude CLI: {e}. Install from https://claude.ai/code if missing."
            )
        })?;
    register_process(&process_state, &request_id, child.id());

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("write stdin: {e}"))?;
    }
    drop(child.stdin.take());

    let output = child.wait_with_output();
    unregister_process(&process_state, &request_id);
    let output = output.map_err(|e| format!("wait for claude: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        return Ok(AiSessionResult {
            success: false,
            output: stdout,
            error: Some(claude_failure_message(output.status, &stderr)),
            session_id: None,
        });
    }

    // Parse the JSON result block.
    let parsed: ClaudeJsonResult = match serde_json::from_str(&stdout) {
        Ok(p) => p,
        Err(e) => {
            return Ok(AiSessionResult {
                success: false,
                output: stdout,
                error: Some(format!("parse claude json: {e}")),
                session_id: None,
            });
        }
    };

    if parsed.is_error {
        return Ok(AiSessionResult {
            success: false,
            output: parsed.result.unwrap_or_default(),
            error: Some("claude reported is_error=true".to_string()),
            session_id: parsed.session_id,
        });
    }

    Ok(AiSessionResult {
        success: true,
        output: parsed.result.unwrap_or_default(),
        error: None,
        session_id: parsed.session_id,
    })
}
