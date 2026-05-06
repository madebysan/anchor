use crate::config::ConfigState;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::State;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AiExecutionResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

// Probe whether `claude` resolves on PATH. Uses `claude --version` (cheap,
// short-lived) instead of `which claude` so we tolerate a shim that exists
// but doesn't run.
#[tauri::command]
pub fn ai_check_claude_cli() -> bool {
    Command::new("claude")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn ensure_inside(folder: &Path, target: &Path) -> Result<(), String> {
    let folder_canon = folder
        .canonicalize()
        .map_err(|e| format!("notes folder canonicalize: {e}"))?;
    let target_canon = target
        .canonicalize()
        .map_err(|e| format!("file canonicalize: {e}"))?;
    if !target_canon.starts_with(&folder_canon) {
        return Err("File is outside notes folder".to_string());
    }
    Ok(())
}

fn notes_folder(state: &State<'_, ConfigState>) -> Result<PathBuf, String> {
    let guard = state.0.lock().expect("config mutex poisoned");
    guard
        .notes_folder
        .clone()
        .ok_or_else(|| "Notes folder not set".to_string())
}

// One-shot chat with claude — no file argument, just a prompt on stdin.
// Used while the comment-thread UX is still text-only (Phase 1). Phase 3
// switches to file-based auto-apply via ai_execute_claude.
#[tauri::command]
pub fn ai_chat_claude(prompt: String) -> Result<AiExecutionResult, String> {
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

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("write stdin: {e}"))?;
    }
    drop(child.stdin.take());

    let output = child
        .wait_with_output()
        .map_err(|e| format!("wait for claude: {e}"))?;

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
            error: Some(if stderr.is_empty() {
                format!("claude exited with status {}", output.status)
            } else {
                stderr
            }),
        })
    }
}

// Spawns `claude <file> --dangerously-skip-permissions --print` with the
// user's prompt piped to stdin. Captures stdout/stderr. The `--print` flag
// makes claude write the response and exit instead of staying interactive.
#[tauri::command]
pub fn ai_execute_claude(
    state: State<'_, ConfigState>,
    file_path: String,
    prompt: String,
) -> Result<AiExecutionResult, String> {
    let folder = notes_folder(&state)?;
    let target = PathBuf::from(&file_path);

    if target.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) != Some("md".to_string()) {
        return Err("AI editing is only supported for markdown files".to_string());
    }
    ensure_inside(&folder, &target)?;

    let mut child = Command::new("claude")
        .arg(&target)
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

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("write stdin: {e}"))?;
    }
    drop(child.stdin.take());

    let output = child
        .wait_with_output()
        .map_err(|e| format!("wait for claude: {e}"))?;

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
            error: Some(if stderr.is_empty() {
                format!("claude exited with status {}", output.status)
            } else {
                stderr
            }),
        })
    }
}
