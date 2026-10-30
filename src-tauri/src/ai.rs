use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

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

// Claude Code runs exactly as the user set it up: their own subscription sign-in or
// their own API key. Anchor never removes or overrides an authentication method
// (Anthropic's terms for apps that run Claude Code require this).
fn configure_claude_process(cmd: &mut Command) {
    match prepare_claude_working_dir() {
        Ok(dir) => {
            cmd.current_dir(dir);
        }
        Err(e) => {
            log::warn!("claude working dir setup failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::path::Path;

    #[cfg(unix)]
    fn exit_status(code: i32) -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(code << 8)
    }

    fn overrides_auth_env(cmd: &Command) -> bool {
        cmd.get_envs().any(|(key, _)| {
            key == OsStr::new("ANTHROPIC_API_KEY") || key == OsStr::new("ANTHROPIC_AUTH_TOKEN")
        })
    }

    #[test]
    fn keeps_users_auth_setup_for_claude_process() {
        let mut cmd = Command::new("claude");
        configure_claude_process(&mut cmd);

        assert!(!overrides_auth_env(&cmd));
    }

    #[test]
    fn keeps_users_auth_setup_for_claude_status_process() {
        let cmd = claude_auth_status_command();

        assert!(!overrides_auth_env(&cmd));
    }

    #[test]
    fn sets_private_working_dir_for_claude_process() {
        let mut cmd = Command::new("claude");
        configure_claude_process(&mut cmd);

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
