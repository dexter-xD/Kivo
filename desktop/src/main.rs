#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod http;
mod storage;

use http::client::{cancel_http_request, cancel_oauth_exchange, oauth_exchange_token, send_http_request};
use storage::{
    export_collection_file, export_request_file,
    get_app_config, get_default_storage_path, get_env_vars, get_resolved_storage_path,
    get_collection_config, import_collection_file, import_request_file, load_app_state, open_config_directory, reveal_item, save_app_state,
    parse_grpc_proto_file, list_grpc_proto_files_in_directory,
    save_collection_config, save_env_vars, set_storage_path, switch_storage_path,
    validate_storage_path,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            send_http_request,
            cancel_http_request,
            oauth_exchange_token,
            cancel_oauth_exchange,
            load_app_state,
            save_app_state,
            open_config_directory,
            reveal_item,
            get_app_config,
            set_storage_path,
            validate_storage_path,
            switch_storage_path,
            get_default_storage_path,
            get_env_vars,
            save_env_vars,
            get_collection_config,
            save_collection_config,
            get_resolved_storage_path,
            import_collection_file,
            import_request_file,
            parse_grpc_proto_file,
            list_grpc_proto_files_in_directory,
            export_collection_file,
            export_request_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

