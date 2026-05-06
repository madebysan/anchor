use crate::config::ConfigState;
use serde::{Deserialize, Serialize};
use std::env;
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

// Session-aware claude invocation. Either:
//   - First call in a doc: pass `file_path` (claude reads the file once,
//     subsequent --resume calls reuse the cached context)
//   - Follow-up: pass `session_id` from the prior call's response
//   - Both empty: chat-only with no doc context (pre-session flow)
//
// Uses `--output-format json` so we can parse out the session_id for
// stitching follow-ups together. The prompt is piped via stdin.
#[tauri::command]
pub fn ai_invoke_claude(
    state: State<'_, ConfigState>,
    file_path: Option<String>,
    session_id: Option<String>,
    prompt: String,
) -> Result<AiSessionResult, String> {
    let mut cmd = Command::new("claude");
    cmd.arg("--dangerously-skip-permissions")
        .arg("--print")
        .arg("--output-format")
        .arg("json");

    if let Some(sid) = &session_id {
        cmd.arg("--resume").arg(sid);
    } else if let Some(fp) = &file_path {
        let folder = {
            let guard = state.0.lock().expect("config mutex poisoned");
            guard
                .notes_folder
                .clone()
                .ok_or_else(|| "Notes folder not set".to_string())?
        };
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

    if !output.status.success() {
        return Ok(AiSessionResult {
            success: false,
            output: stdout,
            error: Some(if stderr.is_empty() {
                format!("claude exited with status {}", output.status)
            } else {
                stderr
            }),
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
