use crate::config::ConfigState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClaudeStatus {
    pub installed: bool,
    pub ready: bool,
    pub detail: Option<String>,
    pub subscription_type: Option<String>,
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

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ClaudeAuthStatus {
    #[serde(default)]
    logged_in: bool,
    #[serde(default)]
    subscription_type: Option<String>,
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

#[tauri::command]
pub async fn ai_check_claude_status() -> ClaudeStatus {
    tauri::async_runtime::spawn_blocking(check_claude_status_blocking)
        .await
        .unwrap_or_else(|e| ClaudeStatus {
            installed: false,
            ready: false,
            detail: Some(format!("Anchor could not check Claude Code: {e}")),
            subscription_type: None,
        })
}

fn check_claude_status_blocking() -> ClaudeStatus {
    let found = find_in_path("claude");
    if let Ok(path) = env::var("PATH") {
        log::info!("ai_check_claude_status: PATH={path}");
    }
    log::info!("ai_check_claude_status: claude resolved to {:?}", found);

    if found.is_none() {
        return ClaudeStatus {
            installed: false,
            ready: false,
            detail: Some("Claude Code is not installed or is not on Anchor's PATH.".to_string()),
            subscription_type: None,
        };
    }

    let child = match claude_auth_status_command().spawn() {
        Ok(child) => child,
        Err(e) => {
            return ClaudeStatus {
                installed: true,
                ready: false,
                detail: Some(format!(
                    "Claude Code is installed, but Anchor could not start it: {e}"
                )),
                subscription_type: None,
            };
        }
    };

    let output = match wait_with_timeout(child, Duration::from_secs(5)) {
        Ok(output) => output,
        Err(e) => {
            return ClaudeStatus {
                installed: true,
                ready: false,
                detail: Some(e),
                subscription_type: None,
            };
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if !output.status.success() {
        let message = claude_failure_message(output.status, &stdout, &stderr);
        return ClaudeStatus {
            installed: true,
            ready: false,
            detail: Some(format!(
                "Claude Code is installed, but it is not ready: {message}"
            )),
            subscription_type: None,
        };
    }

    match serde_json::from_str::<ClaudeAuthStatus>(&stdout) {
        Ok(auth) if auth.logged_in => {
            let subscription_type = auth.subscription_type;
            ClaudeStatus {
                installed: true,
                ready: true,
                detail: Some(claude_ready_detail(subscription_type.as_deref())),
                subscription_type,
            }
        }
        Ok(_) => ClaudeStatus {
            installed: true,
            ready: false,
            detail: Some(
                "Claude Code is installed, but it is not signed in. Run claude login in Terminal, then click Recheck."
                    .to_string(),
            ),
            subscription_type: None,
        },
        Err(e) => {
            let trimmed = stdout.trim();
            let suffix = if trimmed.is_empty() {
                e.to_string()
            } else {
                format!("{e}: {trimmed}")
            };
            ClaudeStatus {
                installed: true,
                ready: false,
                detail: Some(format!(
                    "Claude Code is installed, but Anchor could not read its sign-in status: {suffix}"
                )),
                subscription_type: None,
            }
        }
    }
}

fn claude_auth_status_command() -> Command {
    let mut cmd = Command::new("claude");
    configure_claude_process(&mut cmd);
    cmd.arg("auth")
        .arg("status")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd
}

fn wait_with_timeout(mut child: Child, timeout: Duration) -> Result<Output, String> {
    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|e| format!("wait for claude auth status: {e}"));
            }
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                return child.wait_with_output().map(|_| ()).map_or_else(
                    |e| {
                        Err(format!(
                            "Claude Code status check timed out and could not be stopped: {e}"
                        ))
                    },
                    |_| Err("Claude Code status check timed out.".to_string()),
                );
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(format!("check claude auth status: {e}")),
        }
    }
}

fn claude_ready_detail(subscription_type: Option<&str>) -> String {
    match subscription_type {
        Some(value) if !value.trim().is_empty() => {
            format!(
                "Claude Code is signed in with a {} subscription.",
                human_subscription_type(value)
            )
        }
        _ => "Claude Code is signed in.".to_string(),
    }
}

fn human_subscription_type(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("max") {
        return "Max".to_string();
    }
    if trimmed.eq_ignore_ascii_case("pro") {
        return "Pro".to_string();
    }
    trimmed.to_string()
}

// Same logic as notes.rs::ensure_inside: normalize without following
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

fn claude_failure_message(status: ExitStatus, stdout: &str, stderr: &str) -> String {
    let trimmed = stderr.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }

    if let Some(message) = claude_json_error_message(stdout) {
        return message;
    }

    let trimmed = stdout.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }

    match status.code() {
        Some(code) => format!("Claude Code exited with code {code} and did not print an error."),
        None => "Claude Code was terminated and did not print an error.".to_string(),
    }
}

fn claude_json_error_message(stdout: &str) -> Option<String> {
    let parsed = serde_json::from_str::<ClaudeJsonResult>(stdout).ok()?;
    if !parsed.is_error {
        return None;
    }
    let result = parsed.result?.trim().to_string();
    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

enum ClaudeToolPolicy {
    NoTools,
    ReadOnly,
}

fn remove_claude_billing_env(cmd: &mut Command) {
    // Anchor uses Claude Code subscription auth. Do not inherit API-billing
    // credentials from the parent shell if the user has them exported.
    cmd.env_remove("ANTHROPIC_API_KEY");
    cmd.env_remove("ANTHROPIC_AUTH_TOKEN");
}

fn claude_working_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("com.santiagoalonso.anchor")
                .join("claude");
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = env::var_os("APPDATA") {
            return PathBuf::from(appdata)
                .join("com.santiagoalonso.anchor")
                .join("claude");
        }
    }

    if let Some(data_home) = env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(data_home)
            .join("com.santiagoalonso.anchor")
            .join("claude");
    }

    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("com.santiagoalonso.anchor")
            .join("claude");
    }

    env::temp_dir()
        .join("com.santiagoalonso.anchor")
        .join("claude")
}

fn prepare_claude_working_dir() -> Result<PathBuf, String> {
    let dir = claude_working_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create claude working dir: {e}"))?;

    // san's local Claude/Codex hooks honor this sentinel. Creating it in
    // Anchor's private CLI cwd prevents hook-written recent.md files from
    // touching watched source folders during dev.
    let no_recent = dir.join(".no-recent");
    if !no_recent.exists() {
        fs::write(&no_recent, "").map_err(|e| format!("write claude .no-recent: {e}"))?;
    }

    Ok(dir)
}

fn configure_claude_process(cmd: &mut Command) {
    remove_claude_billing_env(cmd);

    match prepare_claude_working_dir() {
        Ok(dir) => {
            cmd.current_dir(dir);
        }
        Err(e) => {
            log::warn!("claude working dir setup failed: {e}");
        }
    }
}

fn apply_claude_base_args(cmd: &mut Command, tool_policy: ClaudeToolPolicy) {
    configure_claude_process(cmd);

    cmd.arg("--dangerously-skip-permissions").arg("--print");

    match tool_policy {
        ClaudeToolPolicy::NoTools => {
            cmd.arg("--tools").arg("");
        }
        ClaudeToolPolicy::ReadOnly => {
            cmd.arg("--allowedTools")
                .arg("Read")
                .arg("--disallowedTools")
                .arg("Write,Edit,MultiEdit,NotebookEdit,Bash");
        }
    }
}

// One-shot chat with claude: no file argument, just a prompt on stdin.
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
    let mut cmd = Command::new("claude");
    apply_claude_base_args(&mut cmd, ClaudeToolPolicy::NoTools);
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

    if output.status.success() {
        Ok(AiExecutionResult {
            success: true,
            output: stdout,
            error: None,
        })
    } else {
        let error = claude_failure_message(output.status, &stdout, &stderr);
        Ok(AiExecutionResult {
            success: false,
            output: stdout,
            error: Some(error),
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
    apply_claude_base_args(&mut cmd, ClaudeToolPolicy::ReadOnly);
    cmd.arg("--output-format").arg("json");

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
        let error = claude_failure_message(output.status, &stdout, &stderr);
        return Ok(AiSessionResult {
            success: false,
            output: stdout,
            error: Some(error),
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
        let result = parsed.result.unwrap_or_default();
        let error = if result.trim().is_empty() {
            "claude reported is_error=true".to_string()
        } else {
            result.clone()
        };
        return Ok(AiSessionResult {
            success: false,
            output: result,
            error: Some(error),
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[cfg(unix)]
    fn exit_status(code: i32) -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(code << 8)
    }

    #[test]
    fn strips_api_key_from_claude_process() {
        let mut cmd = Command::new("claude");
        apply_claude_base_args(&mut cmd, ClaudeToolPolicy::NoTools);

        let removes_api_key = cmd
            .get_envs()
            .any(|(key, value)| key == OsStr::new("ANTHROPIC_API_KEY") && value.is_none());

        assert!(removes_api_key);
    }

    #[test]
    fn strips_api_key_from_claude_status_process() {
        let cmd = claude_auth_status_command();

        let removes_api_key = cmd
            .get_envs()
            .any(|(key, value)| key == OsStr::new("ANTHROPIC_API_KEY") && value.is_none());

        assert!(removes_api_key);
    }

    #[test]
    fn sets_private_working_dir_for_claude_process() {
        let mut cmd = Command::new("claude");
        apply_claude_base_args(&mut cmd, ClaudeToolPolicy::NoTools);

        let current_dir = cmd
            .get_current_dir()
            .expect("claude command should have a private cwd");

        assert!(current_dir.ends_with(Path::new("com.santiagoalonso.anchor/claude")));
        assert!(current_dir.join(".no-recent").exists());
    }

    #[test]
    fn formats_subscription_status_detail() {
        assert_eq!(
            claude_ready_detail(Some("max")),
            "Claude Code is signed in with a Max subscription."
        );
    }

    #[cfg(unix)]
    #[test]
    fn failure_message_keeps_stdout_error_detail() {
        let message = claude_failure_message(exit_status(1), "Credit balance is too low\n", "");

        assert_eq!(message, "Credit balance is too low");
    }

    #[cfg(unix)]
    #[test]
    fn failure_message_reads_json_error_result() {
        let stdout = r#"{"is_error":true,"result":"Credit balance is too low"}"#;
        let message = claude_failure_message(exit_status(1), stdout, "");

        assert_eq!(message, "Credit balance is too low");
    }
}
