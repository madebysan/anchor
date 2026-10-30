//! Claude Code IDE connection.
//!
//! Claude Code discovers editors through lock files in `~/.claude/ide/`. Each
//! file names a localhost WebSocket port and an auth token; a Claude session
//! started with `CLAUDE_CODE_SSE_PORT` pointing at that port connects, speaks
//! JSON-RPC (MCP over WebSocket), and receives `selection_changed`
//! notifications. That is how "In note.md" and "3 lines selected" appear above
//! Claude's prompt in Anchor's terminal.
//!
//! Anchor runs one server for the app. The editor pushes its state through
//! `ide_update_context`; the server forwards it to every connected Claude and
//! replays the latest state when a new Claude connects, so the first question
//! after starting Claude already knows the open note.

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::ErrorKind;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::http::{HeaderValue, StatusCode};
use tungstenite::{Error as WsError, Message, WebSocket};

const IDE_NAME: &str = "Anchor";
const AUTH_HEADER: &str = "x-claude-code-ide-authorization";
/// How long a connection thread blocks on a read before checking its outbox.
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
/// Claude ignores editor updates for a moment after it connects, so the open
/// note is sent again at these points (measured from the handshake).
const REPLAY_AFTER: [Duration; 3] = [
    Duration::from_millis(800),
    Duration::from_secs(2),
    Duration::from_secs(5),
];

#[derive(Default)]
struct EditorContext {
    active_file: Option<String>,
    open_files: Vec<String>,
    /// Params of the latest `selection_changed` notification for the active note.
    selection: Option<Value>,
}

struct Inner {
    app: AppHandle,
    token: String,
    port: u16,
    lock_path: Mutex<Option<PathBuf>>,
    context: Mutex<EditorContext>,
    clients: Mutex<Vec<(u64, Sender<String>)>>,
    next_client_id: AtomicU64,
}

pub struct IdeState(Mutex<Option<Arc<Inner>>>);

impl IdeState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    fn shared(&self) -> Option<Arc<Inner>> {
        self.0.lock().ok().and_then(|guard| guard.clone())
    }

    /// Port Claude should connect to, for the terminal's environment.
    pub fn port(&self) -> Option<u16> {
        self.shared().map(|inner| inner.port)
    }
}

#[derive(Serialize, Clone)]
struct ClientsChanged {
    connected: usize,
}

#[derive(Serialize, Clone)]
struct OpenFileRequest {
    path: String,
}

/// Bind the server and write the lock file. Failure only disables the
/// integration; the editor keeps working.
pub fn start(app: &AppHandle, state: &IdeState, notes_folder: Option<&Path>) {
    sweep_stale_lock_files();

    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => listener,
        Err(e) => {
            log::warn!("Claude IDE server did not start: {e}");
            return;
        }
    };
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            log::warn!("Claude IDE server has no address: {e}");
            return;
        }
    };
    let token = match random_token() {
        Ok(token) => token,
        Err(e) => {
            log::warn!("Claude IDE server could not create a token: {e}");
            return;
        }
    };

    let inner = Arc::new(Inner {
        app: app.clone(),
        token,
        port,
        lock_path: Mutex::new(None),
        context: Mutex::new(EditorContext::default()),
        clients: Mutex::new(Vec::new()),
        next_client_id: AtomicU64::new(1),
    });
    if let Some(folder) = notes_folder {
        write_lock_file(&inner, folder);
    }
    if let Ok(mut slot) = state.0.lock() {
        *slot = Some(inner.clone());
    }

    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let inner = inner.clone();
            thread::spawn(move || serve_connection(inner, stream));
        }
    });
}

/// Point the lock file at a new notes folder (after the user changes it).
pub fn update_workspace(state: &IdeState, notes_folder: &Path) {
    if let Some(inner) = state.shared() {
        write_lock_file(&inner, notes_folder);
    }
}

/// Remove the lock file so Claude stops offering a closed Anchor.
pub fn shutdown(state: &IdeState) {
    let Some(inner) = state.shared() else { return };
    let path = inner.lock_path.lock().ok().and_then(|mut slot| slot.take());
    if let Some(path) = path {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub fn ide_update_context(
    state: tauri::State<'_, IdeState>,
    active_file: Option<String>,
    open_files: Vec<String>,
    selection: Option<Value>,
) {
    let Some(inner) = state.shared() else { return };
    if let Ok(mut context) = inner.context.lock() {
        context.active_file = active_file;
        context.open_files = open_files;
        context.selection = selection.clone();
    }
    if let Some(params) = selection {
        broadcast(&inner, &notification("selection_changed", params));
    }
}

#[tauri::command]
pub fn ide_connected_clients(state: tauri::State<'_, IdeState>) -> usize {
    state
        .shared()
        .and_then(|inner| inner.clients.lock().ok().map(|clients| clients.len()))
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Lock files

fn lock_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude").join("ide"))
}

fn write_lock_file(inner: &Inner, notes_folder: &Path) {
    let Some(dir) = lock_dir() else { return };
    if let Err(e) = fs::create_dir_all(&dir) {
        log::warn!("Could not create {}: {e}", dir.display());
        return;
    }
    restrict_permissions(&dir, 0o700);

    // Claude matches its working directory against these folders. List the
    // folder as configured and its resolved form, in case it is a symlink.
    let mut folders = vec![notes_folder.to_string_lossy().to_string()];
    if let Ok(resolved) = fs::canonicalize(notes_folder) {
        let resolved = resolved.to_string_lossy().to_string();
        if !folders.contains(&resolved) {
            folders.push(resolved);
        }
    }

    let path = dir.join(format!("{}.lock", inner.port));
    let body = json!({
        "pid": std::process::id(),
        "workspaceFolders": folders,
        "ideName": IDE_NAME,
        "transport": "ws",
        "authToken": inner.token,
    });
    if let Err(e) = fs::write(&path, body.to_string()) {
        log::warn!("Could not write {}: {e}", path.display());
        return;
    }
    restrict_permissions(&path, 0o600);
    if let Ok(mut slot) = inner.lock_path.lock() {
        *slot = Some(path);
    }
}

/// Delete Anchor lock files left by a crashed Anchor. Other editors' files
/// are never touched.
fn sweep_stale_lock_files() {
    let Some(dir) = lock_dir() else { return };
    let Ok(entries) = fs::read_dir(&dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("lock") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else { continue };
        let Ok(lock) = serde_json::from_str::<Value>(&raw) else { continue };
        if lock.get("ideName").and_then(Value::as_str) != Some(IDE_NAME) {
            continue;
        }
        let pid = lock.get("pid").and_then(Value::as_u64).unwrap_or(0);
        if pid > 0 && !process_alive(pid as u32) {
            let _ = fs::remove_file(&path);
        }
    }
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn process_alive(_pid: u32) -> bool {
    true
}

#[cfg(unix)]
fn restrict_permissions(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path, _mode: u32) {}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

// ---------------------------------------------------------------------------
// Connections

fn serve_connection(inner: Arc<Inner>, stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT));
    let token = inner.token.clone();
    let accept = |request: &Request, mut response: Response| -> Result<Response, ErrorResponse> {
        let authorized = request
            .headers()
            .get(AUTH_HEADER)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value == token);
        if !authorized {
            let mut rejection = ErrorResponse::new(Some("unauthorized".to_string()));
            *rejection.status_mut() = StatusCode::UNAUTHORIZED;
            return Err(rejection);
        }
        // Claude's WebSocket client may ask for a subprotocol; agree to the
        // first one, as a stock WebSocket server would.
        if let Some(protocol) = request
            .headers()
            .get("sec-websocket-protocol")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if let Ok(value) = HeaderValue::from_str(protocol) {
                response.headers_mut().insert("sec-websocket-protocol", value);
            }
        }
        Ok(response)
    };
    let Ok(mut socket) = tungstenite::accept_hdr(stream, accept) else { return };
    let _ = socket.get_ref().set_read_timeout(Some(POLL_INTERVAL));

    let (outbox, inbox) = mpsc::channel::<String>();
    let client_id = inner.next_client_id.fetch_add(1, Ordering::Relaxed);
    let connected = match inner.clients.lock() {
        Ok(mut clients) => {
            clients.push((client_id, outbox));
            clients.len()
        }
        Err(_) => return,
    };
    let _ = inner.app.emit("ide-clients-changed", ClientsChanged { connected });

    run_connection(&inner, &mut socket, &inbox);

    let connected = match inner.clients.lock() {
        Ok(mut clients) => {
            clients.retain(|(id, _)| *id != client_id);
            clients.len()
        }
        Err(_) => 0,
    };
    let _ = inner.app.emit("ide-clients-changed", ClientsChanged { connected });
}

fn run_connection(
    inner: &Inner,
    socket: &mut WebSocket<TcpStream>,
    inbox: &Receiver<String>,
) {
    let connected_at = Instant::now();
    let mut replays_sent = 0;
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => {
                for reply in handle_message(inner, text.as_str()) {
                    if socket.send(Message::text(reply)).is_err() {
                        return;
                    }
                }
            }
            Ok(Message::Close(_)) => return,
            Ok(_) => {}
            Err(WsError::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => return,
        }

        while let Ok(message) = inbox.try_recv() {
            if socket.send(Message::text(message)).is_err() {
                return;
            }
        }

        if replays_sent < REPLAY_AFTER.len() && connected_at.elapsed() >= REPLAY_AFTER[replays_sent] {
            replays_sent += 1;
            if let Some(message) = current_selection_notification(inner) {
                if socket.send(Message::text(message)).is_err() {
                    return;
                }
            }
        }
    }
}

fn broadcast(inner: &Inner, message: &str) {
    if let Ok(mut clients) = inner.clients.lock() {
        clients.retain(|(_, client)| client.send(message.to_string()).is_ok());
    }
}

fn notification(method: &str, params: Value) -> String {
    json!({ "jsonrpc": "2.0", "method": method, "params": params }).to_string()
}

fn current_selection_notification(inner: &Inner) -> Option<String> {
    let context = inner.context.lock().ok()?;
    let params = context.selection.clone()?;
    Some(notification("selection_changed", params))
}

/// Answer one JSON-RPC message. Returns the frames to send back, in order.
fn handle_message(inner: &Inner, raw: &str) -> Vec<String> {
    let Ok(message) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let id = message.get("id").cloned().filter(|id| !id.is_null());
    let params = message.get("params").cloned().unwrap_or(Value::Null);

    let result = match method {
        "initialize" => {
            let version = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2024-11-05");
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": true } },
                "serverInfo": { "name": IDE_NAME, "version": env!("CARGO_PKG_VERSION") },
            }))
        }
        // Replay the open note the moment Claude is ready for notifications.
        "notifications/initialized" => {
            return current_selection_notification(inner).into_iter().collect();
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
            call_tool(inner, name, &arguments)
        }
        "prompts/list" => Ok(json!({ "prompts": [] })),
        "resources/list" => Ok(json!({ "resources": [] })),
        _ => Err((-32601, format!("Method not found: {method}"))),
    };

    let Some(id) = id else { return Vec::new() };
    let mut replies = vec![match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string(),
        Err((code, text)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": text } })
                .to_string()
        }
    }];
    if method == "initialize" {
        replies.extend(current_selection_notification(inner));
    }
    replies
}

fn text_result(text: String) -> Value {
    json!({ "content": [{ "type": "text", "text": text }] })
}

fn call_tool(inner: &Inner, name: &str, arguments: &Value) -> Result<Value, (i64, String)> {
    let context = inner
        .context
        .lock()
        .map_err(|_| (-32603, "editor state unavailable".to_string()))?;
    match name {
        "getCurrentSelection" | "getLatestSelection" => {
            let payload = match &context.selection {
                Some(selection) => {
                    let mut payload = selection.clone();
                    payload["success"] = json!(true);
                    payload
                }
                None => json!({ "success": false, "message": "No note is open in Anchor" }),
            };
            Ok(text_result(payload.to_string()))
        }
        "getOpenEditors" => {
            let tabs: Vec<Value> = context
                .open_files
                .iter()
                .map(|path| {
                    json!({
                        "uri": format!("file://{path}"),
                        "isActive": context.active_file.as_deref() == Some(path.as_str()),
                        "label": Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()),
                        "languageId": "markdown",
                        "isDirty": false,
                    })
                })
                .collect();
            Ok(text_result(json!({ "tabs": tabs }).to_string()))
        }
        "getWorkspaceFolders" => {
            let folders: Vec<Value> = inner
                .lock_path
                .lock()
                .ok()
                .and_then(|slot| slot.clone())
                .and_then(|path| fs::read_to_string(path).ok())
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|lock| lock.get("workspaceFolders").cloned())
                .and_then(|value| value.as_array().cloned())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .map(|path| {
                    json!({
                        "name": Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()),
                        "uri": format!("file://{path}"),
                        "path": path,
                    })
                })
                .collect();
            let root = folders.first().and_then(|f| f.get("path").cloned());
            Ok(text_result(
                json!({ "success": true, "folders": folders, "rootPath": root }).to_string(),
            ))
        }
        "getDiagnostics" => Ok(text_result("[]".to_string())),
        "openFile" => {
            let path = arguments
                .get("filePath")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if path.is_empty() {
                return Err((-32602, "filePath is required".to_string()));
            }
            let _ = inner.app.emit("ide-open-file", OpenFileRequest { path: path.clone() });
            Ok(text_result(format!("Opened {path} in Anchor")))
        }
        // Anchor reviews edits itself, so there are no diff tabs to close.
        "close_tab" | "closeAllDiffTabs" => Ok(text_result("OK".to_string())),
        _ => Err((-32601, format!("Unknown tool: {name}"))),
    }
}

fn tool_definitions() -> Value {
    let no_arguments = json!({ "type": "object", "properties": {} });
    json!([
        {
            "name": "getCurrentSelection",
            "description": "Get the selected text and cursor position in the note open in Anchor",
            "inputSchema": no_arguments,
        },
        {
            "name": "getLatestSelection",
            "description": "Get the most recent selection in Anchor",
            "inputSchema": no_arguments,
        },
        {
            "name": "getOpenEditors",
            "description": "List the notes open in Anchor",
            "inputSchema": no_arguments,
        },
        {
            "name": "getWorkspaceFolders",
            "description": "Get Anchor's notes folder",
            "inputSchema": no_arguments,
        },
        {
            "name": "getDiagnostics",
            "description": "Anchor has no diagnostics; always empty",
            "inputSchema": { "type": "object", "properties": { "uri": { "type": "string" } } },
        },
        {
            "name": "openFile",
            "description": "Open a note in Anchor",
            "inputSchema": {
                "type": "object",
                "properties": { "filePath": { "type": "string" } },
                "required": ["filePath"],
            },
        },
        {
            "name": "close_tab",
            "description": "No-op; Anchor has no diff tabs",
            "inputSchema": { "type": "object", "properties": { "tab_name": { "type": "string" } } },
        },
        {
            "name": "closeAllDiffTabs",
            "description": "No-op; Anchor has no diff tabs",
            "inputSchema": no_arguments,
        },
    ])
}
