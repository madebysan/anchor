use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Default, Debug, Clone)]
pub struct AppConfig {
    pub notes_folder: Option<PathBuf>,
}

pub struct ConfigState(pub Mutex<AppConfig>);

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir lookup failed: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;
    Ok(dir.join("config.json"))
}

pub fn load_config(app: &AppHandle) -> AppConfig {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(_) => return AppConfig::default(),
    };
    let contents = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return AppConfig::default(),
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

pub fn save_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let json =
        serde_json::to_string_pretty(config).map_err(|e| format!("serialize config: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write config: {e}"))
}

#[tauri::command]
pub fn get_notes_folder(state: tauri::State<'_, ConfigState>) -> Option<String> {
    let config = state.0.lock().expect("config mutex poisoned");
    config
        .notes_folder
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_notes_folder(
    app: AppHandle,
    state: tauri::State<'_, ConfigState>,
    path: String,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !Path::new(&path_buf).is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    let mut config = state.0.lock().expect("config mutex poisoned");
    config.notes_folder = Some(path_buf);
    save_config(&app, &config)
}
