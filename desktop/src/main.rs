#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod http;
mod storage;

use http::client::send_http_request;
use storage::{
    get_app_config, get_default_storage_path, load_app_state, open_config_directory, reveal_item,
    save_app_state, set_storage_path,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            send_http_request,
            load_app_state,
            save_app_state,
            open_config_directory,
            reveal_item,
            get_app_config,
            set_storage_path,
            get_default_storage_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
