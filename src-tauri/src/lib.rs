mod ai;
mod config;
mod notes;
mod watcher;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// macOS apps launched from Finder inherit a minimal PATH (~/usr/bin:/bin:..).
/// Shell-installed tools (`claude` via Homebrew at /opt/homebrew/bin, etc.) are
/// invisible. Augment PATH at startup with common dev-tool locations so our
/// own `find_in_path` and subprocess spawns can locate them.
fn augment_path() {
    let mut paths: Vec<PathBuf> =
        std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();

    let mut extras: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/local/sbin"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        for sub in [".local/bin", ".npm-global/bin", ".cargo/bin", ".bun/bin"] {
            extras.push(PathBuf::from(&home).join(sub));
        }
    }

    for p in extras {
        if !paths.contains(&p) {
            paths.push(p);
        }
    }

    if let Ok(joined) = std::env::join_paths(paths) {
        // SAFETY: called before any threads spawn (early in run()).
        unsafe {
            std::env::set_var("PATH", joined);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    augment_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let initial = config::load_config(app.handle());
            app.manage(config::ConfigState(Mutex::new(initial)));
            app.manage(watcher::WatcherState::new());
            app.manage(ai::AiProcessState::new());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::get_notes_folder,
            config::set_notes_folder,
            notes::list_note_tree,
            notes::read_note,
            notes::write_note,
            notes::rename_note,
            notes::rename_folder,
            notes::create_folder,
            notes::delete_folder,
            notes::delete_note,
            notes::write_export_file,
            notes::open_path,
            notes::reveal_path,
            watcher::start_watching_notes,
            ai::ai_check_claude_cli,
            ai::ai_cancel_claude,
            ai::ai_chat_claude,
            ai::ai_invoke_claude,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
