use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};

#[cfg(test)]
mod tests;

pub mod export;
pub mod import;
pub mod io;
pub mod models;

pub use models::{
    default_state, CollectionConfig, CollectionRecord, EnvVar, EnvVarsResult,
    ImportedCollectionResult, ImportedRequestsResult, PersistedAppState, RequestRecord,
    StoragePathValidationResult, StorageSwitchPayload, WorkspaceFile,
};

#[cfg(test)]
pub use models::{
    AuthRecord, CollectionScripts, KeyValueRow, OAuthConfig, RequestTextOrJson, ResponseMeta,
    SavedResponse, WorkspaceRecord,
};


pub use import::parse_collection_content;

pub use export::{build_export_value, serialize_export_value};

pub use io::{
    fs_get_env_vars, fs_load_workspaces, fs_save_collection_config, fs_save_env_vars,
    fs_save_workspaces, get_collection_dir, load_collection_config_from_path, load_env_vars,
    WORKSPACE_FILE_NAME,
};

#[cfg(test)]
pub use io::{parse_env_file_ordered, sanitize_name, write_env_file};

fn get_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create app data directory: {e}"))?;
    }
    Ok(app_dir.join("state.json"))
}

#[tauri::command]
pub fn get_app_config(app: AppHandle) -> Result<PersistedAppState, String> {
    let path = get_state_path(&app)?;
    if !path.exists() {
        return Ok(default_state());
    }
    let contents = fs::read_to_string(&path).map_err(|e| format!("Failed to read state: {e}"))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse state: {e}"))
}

#[tauri::command]
pub fn set_storage_path(app: AppHandle, path: String) -> Result<(), String> {
    let state_path = get_state_path(&app)?;
    let mut state = if state_path.exists() {
        let contents =
            fs::read_to_string(&state_path).map_err(|e| format!("Failed to read state: {e}"))?;
        serde_json::from_str::<PersistedAppState>(&contents).unwrap_or_else(|_| default_state())
    } else {
        default_state()
    };
    state.storage_path = Some(PathBuf::from(path));
    let serialized = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialize state: {e}"))?;
    fs::write(&state_path, serialized).map_err(|e| format!("Failed to write state: {e}"))
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(l), Ok(r)) => l == r,
        _ => left == right,
    }
}

fn path_ends_with_kivo(path: &Path) -> bool {
    path.components()
        .rev()
        .find_map(|component| {
            if let Component::Normal(segment) = component {
                return Some(segment.to_string_lossy().eq_ignore_ascii_case("kivo"));
            }
            None
        })
        .unwrap_or(false)
}

fn resolve_kivo_storage_path(raw: &str) -> PathBuf {
    let selected = PathBuf::from(raw.trim());
    if path_ends_with_kivo(&selected) {
        selected
    } else {
        selected.join("Kivo")
    }
}

fn ensure_writable(path: &Path) -> bool {
    let probe = path.join(format!(".kivo-write-test-{}", std::process::id()));
    let can_write = fs::create_dir_all(&probe).is_ok();
    if can_write {
        let _ = fs::remove_dir_all(&probe);
    }
    can_write
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }

    fs::create_dir_all(target).map_err(|e| format!("Failed to create target directory: {e}"))?;

    for entry in
        fs::read_dir(source).map_err(|e| format!("Failed to read source directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read source entry: {e}"))?;
        let src_path = entry.path();
        let dst_path = target.join(entry.file_name());
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read source metadata: {e}"))?;

        if metadata.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if metadata.is_file() {
            if let Some(parent) = dst_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create destination parent: {e}"))?;
            }
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy file {}: {e}", src_path.to_string_lossy()))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn validate_storage_path(path: String) -> Result<StoragePathValidationResult, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is required".to_string());
    }

    let candidate = resolve_kivo_storage_path(trimmed);
    let exists = candidate.exists();
    let is_directory = exists && candidate.is_dir();
    let writable = if exists {
        is_directory && ensure_writable(&candidate)
    } else {
        match candidate.parent() {
            Some(parent) if parent.exists() && parent.is_dir() => ensure_writable(parent),
            _ => false,
        }
    };

    Ok(StoragePathValidationResult {
        exists,
        is_directory,
        writable,
    })
}

#[tauri::command]
pub fn switch_storage_path(app: AppHandle, payload: StorageSwitchPayload) -> Result<(), String> {
    let next_path_raw = payload.path.trim();
    if next_path_raw.is_empty() {
        return Err("Path is required".to_string());
    }

    let next_root = resolve_kivo_storage_path(next_path_raw);
    if next_root.exists() && !next_root.is_dir() {
        return Err("Selected path must be a directory".to_string());
    }

    if !next_root.exists() {
        fs::create_dir_all(&next_root)
            .map_err(|e| format!("Failed to create selected path: {e}"))?;
    }

    if !ensure_writable(&next_root) {
        return Err("Selected path is not writable".to_string());
    }

    let current_root = get_storage_root(&app)?;
    if paths_equal(&current_root, &next_root) {
        return Err("Selected path is already the current storage path".to_string());
    }

    match payload.mode.as_str() {
        "copy" => {
            copy_dir_recursive(&current_root, &next_root)?;
        }
        "fresh" => {
            fs::create_dir_all(&next_root)
                .map_err(|e| format!("Failed to prepare destination directory: {e}"))?;
        }
        _ => {
            return Err("Invalid migration mode".to_string());
        }
    }

    set_storage_path(app, next_root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_default_storage_path(app: AppHandle) -> Result<String, String> {
    if let Ok(doc) = app.path().document_dir() {
        return Ok(doc.join("Kivo").to_string_lossy().to_string());
    }
    if let Ok(home) = app.path().home_dir() {
        return Ok(home.join("Kivo").to_string_lossy().to_string());
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve any storage directory: {e}"))?;
    Ok(app_data.join("data").to_string_lossy().to_string())
}

pub fn get_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    let state = get_app_config(app.clone())?;
    if let Some(path) = state.storage_path {
        return Ok(path);
    }
    if let Ok(doc) = app.path().document_dir() {
        return Ok(doc.join("Kivo"));
    }
    if let Ok(home) = app.path().home_dir() {
        return Ok(home.join("Kivo"));
    }
    app.path()
        .app_data_dir()
        .map(|d| d.join("data"))
        .map_err(|e| format!("Failed to resolve fallback storage directory: {e}"))
}

#[tauri::command]
pub fn load_app_state(app: AppHandle) -> Result<PersistedAppState, String> {
    let root = get_storage_root(&app)?;
    let workspaces = fs_load_workspaces(&root)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    let state_file_path = app_data_dir.join("state.json");
    let mut state = if state_file_path.exists() {
        let json = fs::read_to_string(&state_file_path)
            .map_err(|e| format!("Failed to read state.json: {e}"))?;
        serde_json::from_str::<PersistedAppState>(&json)
            .map_err(|e| format!("Failed to parse state.json: {e}"))?
    } else {
        default_state()
    };
    state.workspaces = workspaces;
    Ok(state)
}

#[tauri::command]
pub fn save_app_state(app: AppHandle, payload: PersistedAppState) -> Result<(), String> {
    let root = get_storage_root(&app)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    let state_file_path = app_data_dir.join("state.json");
    let mut state_to_save = payload.clone();
    state_to_save.workspaces = vec![];
    if state_to_save.storage_path.is_none() {
        if let Ok(config) = get_app_config(app.clone()) {
            state_to_save.storage_path = config.storage_path;
        }
    }
    let state_json = serde_json::to_string_pretty(&state_to_save)
        .map_err(|e| format!("Failed to serialize state.json: {e}"))?;
    fs::write(&state_file_path, state_json)
        .map_err(|e| format!("Failed to write state.json: {e}"))?;
    fs_save_workspaces(&root, &payload.workspaces)
}

#[tauri::command]
pub fn get_env_vars(
    app: AppHandle,
    workspace_name: String,
    collection_name: Option<String>,
) -> Result<EnvVarsResult, String> {
    let root = get_storage_root(&app)?;
    Ok(fs_get_env_vars(
        &root,
        &workspace_name,
        collection_name.as_deref(),
    ))
}

#[tauri::command]
pub fn save_env_vars(
    app: AppHandle,
    workspace_name: String,
    collection_name: Option<String>,
    vars: Vec<EnvVar>,
) -> Result<(), String> {
    let root = get_storage_root(&app)?;
    fs_save_env_vars(&root, &workspace_name, collection_name.as_deref(), &vars)
}

#[tauri::command]
pub fn get_collection_config(
    app: AppHandle,
    workspace_name: String,
    collection_name: String,
) -> Result<CollectionConfig, String> {
    let root = get_storage_root(&app)?;
    let col_path = get_collection_dir(&root, &workspace_name, &collection_name);
    Ok(load_collection_config_from_path(&col_path))
}

#[tauri::command]
pub fn import_collection_file(file_path: String) -> Result<ImportedCollectionResult, String> {
    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read import file: {e}"))?;
    parse_collection_content(&content)
}

#[tauri::command]
pub fn import_request_file(file_path: String) -> Result<ImportedRequestsResult, String> {
    let imported = import_collection_file(file_path)?;
    Ok(ImportedRequestsResult {
        detected_format: imported.detected_format,
        requests: imported.collection.requests,
    })
}

#[tauri::command]
pub fn export_collection_file(
    file_path: String,
    format: String,
    name: String,
    collection: CollectionRecord,
) -> Result<(), String> {
    let value = build_export_value(&format, &name, &collection.requests)?;
    let content = serialize_export_value(&format, &value)?;
    fs::write(&file_path, content).map_err(|e| format!("Failed to write export file: {e}"))
}

#[tauri::command]
pub fn export_request_file(
    file_path: String,
    format: String,
    name: String,
    request: RequestRecord,
) -> Result<(), String> {
    let value = build_export_value(&format, &name, &[request])?;
    let content = serialize_export_value(&format, &value)?;
    fs::write(&file_path, content).map_err(|e| format!("Failed to write export file: {e}"))
}

#[tauri::command]
pub fn save_collection_config(
    app: AppHandle,
    workspace_name: String,
    collection_name: String,
    config: CollectionConfig,
) -> Result<(), String> {
    let root = get_storage_root(&app)?;
    fs_save_collection_config(&root, &workspace_name, &collection_name, &config)
}

#[tauri::command]
pub fn get_resolved_storage_path(app: AppHandle) -> Result<String, String> {
    let root = get_storage_root(&app)?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_config_directory(app: AppHandle) -> Result<(), String> {
    let config = get_app_config(app.clone())?;
    let path = if let Some(p) = config.storage_path {
        p
    } else {
        app.path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data directory: {e}"))?
    };
    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|e| format!("Failed to create storage directory: {e}"))?;
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| format!("Failed to open storage directory: {e}"))
}

#[tauri::command]
pub fn reveal_item(
    app: AppHandle,
    workspace_name: String,
    collection_name: Option<String>,
    request_name: Option<String>,
) -> Result<(), String> {
    let root = get_storage_root(&app)?;
    let mut path = root.join(&workspace_name);
    if let Some(col_name) = collection_name {
        let ws_file_path = path.join(WORKSPACE_FILE_NAME);
        if ws_file_path.exists() {
            let ws_json = fs::read_to_string(&ws_file_path)
                .map_err(|e| format!("Failed to read workspace.json: {e}"))?;
            let ws_file: WorkspaceFile = serde_json::from_str(&ws_json)
                .map_err(|e| format!("Failed to parse workspace.json: {e}"))?;
            if let Some(col_meta) = ws_file.collections.iter().find(|c| c.name == col_name) {
                let col_meta_path = PathBuf::from(&col_meta.path);
                path = if col_meta_path.is_absolute() {
                    col_meta_path
                } else {
                    path.join(&col_meta.path)
                };
                if let Some(req_name) = request_name {
                    let req_path = path.join(format!("{}.json", req_name));
                    if req_path.exists() {
                        path = req_path;
                    }
                }
            }
        }
    }
    if !path.exists() {
        if let Some(parent) = path.parent() {
            if parent.exists() {
                path = parent.to_path_buf();
            }
        }
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .reveal_item_in_dir(path.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to reveal item: {e}"))
}
