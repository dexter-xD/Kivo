use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const WORKSPACE_FILE_NAME: &str = "workspace.json";

fn default_sidebar_width() -> u16 {
    304
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAppState {
    pub version: u8,
    pub storage_path: Option<PathBuf>,
    pub active_workspace_name: String,
    pub active_collection_name: String,
    pub active_request_name: String,
    pub sidebar_tab: String,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u16,
    pub workspaces: Vec<WorkspaceRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub name: String,
    pub description: Option<String>,
    pub collections: Vec<CollectionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub resource_type: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMeta {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub info: WorkspaceInfo,
    pub collections: Vec<CollectionMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRecord {
    pub name: String,
    pub requests: Vec<RequestRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestRecord {
    pub name: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub query_params: Vec<KeyValueRow>,
    #[serde(default)]
    pub headers: Vec<KeyValueRow>,
    pub auth: AuthRecord,
    pub body_type: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub docs: String,
    pub active_editor_tab: String,
    pub active_response_tab: String,
    pub response_body_view: String,
    pub last_response: Option<SavedResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValueRow {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRecord {
    #[serde(rename = "type")]
    pub auth_type: String,
    #[serde(default)]
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedResponse {
    pub status: u16,
    pub badge: String,
    pub status_text: String,
    pub duration: String,
    pub size: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub cookies: Vec<String>,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub raw_body: String,
    #[serde(default)]
    pub is_json: bool,
    pub meta: ResponseMeta,
    #[serde(default)]
    pub saved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMeta {
    pub url: String,
    pub method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    pub request_name: String,
    pub method: String,
    pub status: u16,
    pub status_text: String,
    pub duration: String,
    pub size: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub saved_at: String,
    #[serde(default)]
    pub saved_at_ts: u64,
}

fn default_state() -> PersistedAppState {
    PersistedAppState {
        version: 1,
        storage_path: None,
        active_workspace_name: String::new(),
        active_collection_name: String::new(),
        active_request_name: String::new(),
        sidebar_tab: "requests".to_string(),
        sidebar_width: default_sidebar_width(),
        workspaces: vec![],
    }
}

fn get_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|err| format!("Failed to create app data directory: {err}"))?;
    }

    Ok(app_dir.join("state.json"))
}

#[tauri::command]
pub fn get_app_config(app: AppHandle) -> Result<PersistedAppState, String> {
    let path = get_state_path(&app)?;

    if !path.exists() {
        return Ok(default_state());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read state: {err}"))?;

    serde_json::from_str(&contents).map_err(|err| format!("Failed to parse state: {err}"))
}

#[tauri::command]
pub fn set_storage_path(app: AppHandle, path: String) -> Result<(), String> {
    let state_path = get_state_path(&app)?;
    let storage_path = PathBuf::from(path);

    let mut state = if state_path.exists() {
        let contents = fs::read_to_string(&state_path)
            .map_err(|err| format!("Failed to read state: {err}"))?;
        serde_json::from_str::<PersistedAppState>(&contents)
            .unwrap_or_else(|_| default_state())
    } else {
        default_state()
    };

    state.storage_path = Some(storage_path);

    let serialized = serde_json::to_string_pretty(&state)
        .map_err(|err| format!("Failed to serialize state: {err}"))?;

    fs::write(&state_path, serialized).map_err(|err| format!("Failed to write state: {err}"))
}

#[tauri::command]
pub fn get_default_storage_path(app: AppHandle) -> Result<String, String> {
    let document_dir = app
        .path()
        .document_dir()
        .map_err(|err| format!("Failed to resolve document directory: {err}"))?;

    Ok(document_dir.join("Kivo").to_string_lossy().to_string())
}

fn get_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    let state = get_app_config(app.clone())?;

    if let Some(path) = state.storage_path {
        Ok(path)
    } else {
        app.path()
            .app_data_dir()
            .map_err(|err| format!("Failed to resolve app data directory: {err}"))
    }
}

#[tauri::command]
pub fn load_app_state(app: AppHandle) -> Result<PersistedAppState, String> {
    let root = get_storage_root(&app)?;

    if !root.exists() {
        return Ok(default_state());
    }

    let mut workspaces = Vec::new();

    let entries = fs::read_dir(&root).map_err(|err| format!("Failed to read storage root: {err}"))?;

    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read directory entry: {err}"))?;
        let path = entry.path();

        if path.is_dir() {
            let workspace_file_path = path.join(WORKSPACE_FILE_NAME);
            if workspace_file_path.exists() {
                let workspace_json = fs::read_to_string(&workspace_file_path)
                    .map_err(|err| format!("Failed to read workspace.json: {err}"))?;
                let workspace_file: WorkspaceFile = serde_json::from_str(&workspace_json)
                    .map_err(|err| format!("Failed to parse workspace.json: {err}"))?;

                let mut collections = Vec::new();

        for col_meta in workspace_file.collections {
                    // Collection path is relative to workspace folder
                    let col_path = if col_meta.path.starts_with("/") || col_meta.path.contains(":\\") {
                        PathBuf::from(&col_meta.path)
                    } else {
                        path.join(&col_meta.path)
                    };

                    if col_path.exists() && col_path.is_dir() {
                        let mut requests = Vec::new();
                        let req_entries = fs::read_dir(&col_path)
                            .map_err(|err| format!("Failed to read collection directory: {err}"))?;

                        for req_entry in req_entries {
                            let req_entry = req_entry.map_err(|err| {
                                format!("Failed to read request directory entry: {err}")
                            })?;
                            let req_path = req_entry.path();

                            if req_path.is_file()
                                && req_path.extension().map_or(false, |ext| ext == "json")
                            {
                                let req_json = fs::read_to_string(&req_path)
                                    .map_err(|err| format!("Failed to read request file: {err}"))?;
                                let request: RequestRecord = serde_json::from_str(&req_json)
                                    .map_err(|err| format!("Failed to parse request file: {err}"))?;
                                requests.push(request);
                            }
                        }

                        collections.push(CollectionRecord {
                            name: col_meta.name,
                            requests,
                        });
                    }
                }

                workspaces.push(WorkspaceRecord {
                    name: workspace_file.info.name,
                    description: workspace_file.info.description,
                    collections,
                });
            }
        }
    }

    // We still need a way to store global app state like active workspace, etc.
    // For now, let's try to find if there's a global state file in AppData.
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    let state_file_path = app_data_dir.join("state.json");

    if state_file_path.exists() {
        let state_json = fs::read_to_string(&state_file_path)
            .map_err(|err| format!("Failed to read state.json: {err}"))?;
        let mut state: PersistedAppState = serde_json::from_str(&state_json)
            .map_err(|err| format!("Failed to parse state.json: {err}"))?;
        state.workspaces = workspaces;
        Ok(state)
    } else {
        let mut state = default_state();
        state.workspaces = workspaces;
        Ok(state)
    }
}

#[tauri::command]
pub fn save_app_state(app: AppHandle, payload: PersistedAppState) -> Result<(), String> {
    let root = get_storage_root(&app)?;

    if !root.exists() {
        fs::create_dir_all(&root).map_err(|err| format!("Failed to create storage root: {err}"))?;
    }

    // 1. Save global state (active workspace, etc.) in AppData
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app data directory: {err}"))?;
    let state_file_path = app_data_dir.join("state.json");

    let mut state_to_save = payload.clone();
    state_to_save.workspaces = vec![]; // Don't save full data in global state

    let state_json = serde_json::to_string_pretty(&state_to_save)
        .map_err(|err| format!("Failed to serialize state.json: {err}"))?;
    fs::write(&state_file_path, state_json)
        .map_err(|err| format!("Failed to write state.json: {err}"))?;

    // 2. Cleanup: Remove workspaces that are no longer in the state
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_dir() {
                    let dir_name = entry.file_name().to_string_lossy().to_string();
                    if !payload.workspaces.iter().any(|w| w.name == dir_name) {
                        // Only delete if it looks like a Kivo workspace (has workspace.json)
                        if path.join(WORKSPACE_FILE_NAME).exists() {
                            let _ = fs::remove_dir_all(&path);
                        }
                    }
                }
            }
        }
    }

    // 3. Save each workspace
    for workspace in payload.workspaces {
        let workspace_path = root.join(&workspace.name);
        if !workspace_path.exists() {
            fs::create_dir_all(&workspace_path)
                .map_err(|err| format!("Failed to create workspace directory: {err}"))?;
        }

        let mut collections_meta = Vec::new();
        let collections_root = workspace_path.join("collections");
        if !collections_root.exists() {
            let _ = fs::create_dir_all(&collections_root);
        }

        // Cleanup: Remove collections that are no longer in the workspace
        if let Ok(entries) = fs::read_dir(&collections_root) {
            for entry in entries {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    if path.is_dir() {
                        let dir_name = entry.file_name().to_string_lossy().to_string();
                        if !workspace.collections.iter().any(|c| c.name == dir_name) {
                            let _ = fs::remove_dir_all(&path);
                        }
                    }
                }
            }
        }

        // 4. Save each collection
        for collection in workspace.collections {
            let collection_dir_name = format!("collections/{}", collection.name);
            let collection_path = workspace_path.join(&collection_dir_name);

            if !collection_path.exists() {
                fs::create_dir_all(&collection_path)
                    .map_err(|err| format!("Failed to create collection directory: {err}"))?;
            }

            // Clean up existing files in collection directory to handle renames/deletes
            let existing_entries = fs::read_dir(&collection_path)
                .map_err(|err| format!("Failed to read collection directory: {err}"))?;
            for entry in existing_entries {
                let entry = entry.map_err(|err| format!("Failed to read entry: {err}"))?;
                if entry.path().is_file() {
                    fs::remove_file(entry.path())
                        .map_err(|err| format!("Failed to remove old request file: {err}"))?;
                }
            }

            // Save requests as individual JSON files
            for request in collection.requests {
                let request_file_name = format!("{}.json", request.name);
                let request_path = collection_path.join(request_file_name);
                let request_json = serde_json::to_string_pretty(&request)
                    .map_err(|err| format!("Failed to serialize request: {err}"))?;
                fs::write(request_path, request_json)
                    .map_err(|err| format!("Failed to write request file: {err}"))?;
            }

            collections_meta.push(CollectionMeta {
                name: collection.name.clone(),
                path: collection_dir_name,
            });
        }

        // 5. Save workspace.json metadata
        let workspace_file = WorkspaceFile {
            info: WorkspaceInfo {
                name: workspace.name.clone(),
                resource_type: "workspace".to_string(),
                description: workspace.description.clone(),
            },
            collections: collections_meta,
        };

        let workspace_json = serde_json::to_string_pretty(&workspace_file)
            .map_err(|err| format!("Failed to serialize workspace.json: {err}"))?;
        fs::write(workspace_path.join(WORKSPACE_FILE_NAME), workspace_json)
            .map_err(|err| format!("Failed to write workspace.json: {err}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_config_directory(app: AppHandle) -> Result<(), String> {
    let config = get_app_config(app.clone())?;

    let path = if let Some(storage_path) = config.storage_path {
        storage_path
    } else {
        app.path()
            .app_data_dir()
            .map_err(|err| format!("Failed to resolve app data directory: {err}"))?
    };

    if !path.exists() {
        fs::create_dir_all(&path).map_err(|err| format!("Failed to create storage directory: {err}"))?;
    }

    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path.to_string_lossy().to_string(), None::<String>)
        .map_err(|err| format!("Failed to open storage directory: {err}"))?;

    Ok(())
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
        // Find the collection path from workspace.json
        let workspace_file_path = path.join(WORKSPACE_FILE_NAME);
        if workspace_file_path.exists() {
            let workspace_json = fs::read_to_string(&workspace_file_path)
                .map_err(|err| format!("Failed to read workspace.json: {err}"))?;
            let workspace_file: WorkspaceFile = serde_json::from_str(&workspace_json)
                .map_err(|err| format!("Failed to parse workspace.json: {err}"))?;

            if let Some(col_meta) = workspace_file.collections.iter().find(|c| c.name == col_name) {
                if col_meta.path.starts_with("/") || col_meta.path.contains(":\\") {
                    path = PathBuf::from(&col_meta.path);
                } else {
                    path = path.join(&col_meta.path);
                }

                if let Some(req_name) = request_name {
                    // Requests are stored as {request_name}.json in the collection folder
                    let req_file_path = path.join(format!("{}.json", req_name));
                    if req_file_path.exists() {
                        path = req_file_path;
                    }
                }
            }
        }
    }

    if !path.exists() {
        // Fallback to parent if specific file doesn't exist
        if let Some(parent) = path.parent() {
            if parent.exists() {
                path = parent.to_path_buf();
            }
        }
    }

    tauri_plugin_opener::OpenerExt::opener(&app)
        .reveal_item_in_dir(path.to_string_lossy().to_string())
        .map_err(|err| format!("Failed to reveal item: {err}"))?;

    Ok(())
}

