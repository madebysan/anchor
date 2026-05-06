mod ai;
mod config;
mod notes;
mod watcher;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let initial = config::load_config(app.handle());
            app.manage(config::ConfigState(Mutex::new(initial)));
            app.manage(watcher::WatcherState::new());

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
            notes::list_notes,
            notes::list_note_tree,
            notes::read_note,
            notes::write_note,
            notes::rename_note,
            notes::delete_note,
            notes::write_export_file,
            notes::open_path,
            watcher::start_watching_notes,
            ai::ai_check_claude_cli,
            ai::ai_chat_claude,
            ai::ai_invoke_claude,
            ai::ai_execute_claude,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
