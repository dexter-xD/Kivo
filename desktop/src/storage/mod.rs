use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[cfg(test)]
mod tests;

const WORKSPACE_FILE_NAME: &str = "workspace.json";
const COLLECTION_CONFIG_FILE_NAME: &str = "collection.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

fn is_default_oauth_config(value: &OAuthConfig) -> bool {
    value == &OAuthConfig::default()
}

fn is_default_api_key_in(value: &String) -> bool {
    value.is_empty() || value == "header"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVarsResult {
    pub workspace: Vec<EnvVar>,
    pub collection: Vec<EnvVar>,
    pub merged: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CollectionScripts {
    #[serde(default)]
    pub pre_request: String,
    #[serde(default)]
    pub post_response: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionConfig {
    #[serde(default)]
    pub default_headers: Vec<KeyValueRow>,
    #[serde(default = "default_auth_record")]
    pub default_auth: AuthRecord,
    #[serde(default)]
    pub scripts: CollectionScripts,
}

fn default_auth_record() -> AuthRecord {
    AuthRecord {
        auth_type: "none".to_string(),
        token: String::new(),
        username: String::new(),
        password: String::new(),
        api_key_name: String::new(),
        api_key_value: String::new(),
        api_key_in: "header".to_string(),
        oauth2: OAuthConfig::default(),
    }
}

fn default_true() -> bool {
    true
}

fn default_max_redirects() -> u32 {
    5
}

impl Default for CollectionConfig {
    fn default() -> Self {
        CollectionConfig {
            default_headers: vec![],
            default_auth: default_auth_record(),
            scripts: CollectionScripts::default(),
        }
    }
}

pub(crate) fn parse_env_file_ordered(path: &Path) -> Vec<EnvVar> {
    let Ok(content) = fs::read_to_string(path) else { return vec![] };
    let mut seen = std::collections::HashSet::new();
    let mut vars = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(eq_pos) = line.find('=') {
            let key = line[..eq_pos].trim().to_string();
            if key.is_empty() || seen.contains(&key) {
                continue;
            }
            let raw_val = line[eq_pos + 1..].trim();
            let value = if (raw_val.starts_with('"') && raw_val.ends_with('"'))
                || (raw_val.starts_with('\'') && raw_val.ends_with('\''))
            {
                raw_val[1..raw_val.len() - 1].to_string()
            } else {
                raw_val.to_string()
            };
            seen.insert(key.clone());
            vars.push(EnvVar { key, value });
        }
    }
    vars
}

fn parse_env_file(path: &Path) -> HashMap<String, String> {
    parse_env_file_ordered(path).into_iter().map(|v| (v.key, v.value)).collect()
}

pub(crate) fn write_env_file(path: &Path, vars: &[EnvVar]) -> Result<(), String> {
    let lines: Vec<String> = vars
        .iter()
        .filter(|v| !v.key.trim().is_empty())
        .map(|v| format!("{}={}", v.key.trim(), v.value))
        .collect();
    let content = if lines.is_empty() { String::new() } else { lines.join("\n") + "\n" };
    fs::write(path, content).map_err(|e| format!("Failed to write .env: {e}"))
}

pub(crate) fn ensure_env_and_gitignore(dir: &Path) {
    let env_path = dir.join(".env");
    if !env_path.exists() {
        let _ = fs::write(&env_path, "");
    }
    let gitignore_path = dir.join(".gitignore");
    if !gitignore_path.exists() {
        let _ = fs::write(&gitignore_path, ".env\n");
    } else if let Ok(content) = fs::read_to_string(&gitignore_path) {
        if !content.lines().any(|l| l.trim() == ".env") {
            let appended = format!("{}\n.env\n", content.trim_end());
            let _ = fs::write(&gitignore_path, appended);
        }
    }
}

pub(crate) fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

pub(crate) fn get_collection_dir(root: &Path, workspace_name: &str, collection_name: &str) -> PathBuf {
    root.join(workspace_name).join("collections").join(sanitize_name(collection_name))
}

pub fn load_env_vars(workspace_path: &Path, collection_path: Option<&Path>) -> HashMap<String, String> {
    let mut vars = parse_env_file(&workspace_path.join(".env"));
    if let Some(col_path) = collection_path {
        for (k, v) in parse_env_file(&col_path.join(".env")) {
            vars.insert(k, v);
        }
    }
    vars
}

pub fn load_collection_config_from_path(collection_path: &Path) -> CollectionConfig {
    let path = collection_path.join(COLLECTION_CONFIG_FILE_NAME);
    let Ok(json) = fs::read_to_string(&path) else { return CollectionConfig::default() };
    serde_json::from_str(&json).unwrap_or_default()
}

fn default_sidebar_width() -> u16 { 304 }
fn default_sidebar_tab() -> String { "requests".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAppState {
    #[serde(default)]
    pub version: u8,
    pub storage_path: Option<PathBuf>,
    #[serde(default)]
    pub active_workspace_name: String,
    #[serde(default)]
    pub active_collection_name: String,
    #[serde(default)]
    pub active_request_name: String,
    #[serde(default = "default_sidebar_tab")]
    pub sidebar_tab: String,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u16,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
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
#[serde(untagged)]
pub enum RequestTextOrJson {
    Text(String),
    Json(serde_json::Value),
}

fn is_empty_request_text_or_json(value: &RequestTextOrJson) -> bool {
    matches!(value, RequestTextOrJson::Text(text) if text.trim().is_empty())
}

impl Default for RequestTextOrJson {
    fn default() -> Self {
        RequestTextOrJson::Text(String::new())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestRecord {
    pub name: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub query_params: Vec<KeyValueRow>,
    #[serde(default)]
    pub headers: Vec<KeyValueRow>,
    #[serde(default = "default_auth_record")]
    pub auth: AuthRecord,
    #[serde(default)]
    pub body_type: String,
    #[serde(default, skip_serializing_if = "is_empty_request_text_or_json")]
    pub body: RequestTextOrJson,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub body_rows: Vec<KeyValueRow>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub body_file_path: String,
    #[serde(default, skip_serializing_if = "is_empty_request_text_or_json")]
    pub graphql_variables: RequestTextOrJson,
    #[serde(default)]
    pub docs: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default = "default_true")]
    pub url_encoding: bool,
    #[serde(default = "default_true")]
    pub follow_redirects: bool,
    #[serde(default = "default_max_redirects")]
    pub max_redirects: u32,
    #[serde(default)]
    pub timeout_ms: u64,
    #[serde(default)]
    pub active_editor_tab: String,
    #[serde(default)]
    pub active_response_tab: String,
    #[serde(default)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthParamRow {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OAuthConfig {
    #[serde(default)]
    pub grant_type: String,
    #[serde(default)]
    pub auth_url: String,
    #[serde(default)]
    pub token_url: String,
    #[serde(default)]
    pub callback_url: String,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub audience: String,
    #[serde(default)]
    pub resource: String,
    #[serde(default)]
    pub authorization_code: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub token_type: String,
    #[serde(default)]
    pub expires_at: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub use_pkce: bool,
    #[serde(default)]
    pub code_verifier: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub client_auth_method: String,
    #[serde(default)]
    pub extra_token_params: Vec<OAuthParamRow>,
    #[serde(default)]
    pub last_error: String,
    #[serde(default)]
    pub last_warning: String,
    #[serde(default)]
    pub last_status: String,
}

impl Default for OAuthConfig {
    fn default() -> Self {
        Self {
            grant_type: "authorization_code".to_string(),
            auth_url: String::new(),
            token_url: String::new(),
            callback_url: String::new(),
            client_id: String::new(),
            client_secret: String::new(),
            scope: String::new(),
            audience: String::new(),
            resource: String::new(),
            authorization_code: String::new(),
            access_token: String::new(),
            refresh_token: String::new(),
            token_type: "Bearer".to_string(),
            expires_at: String::new(),
            username: String::new(),
            password: String::new(),
            use_pkce: true,
            code_verifier: String::new(),
            state: String::new(),
            client_auth_method: "basic".to_string(),
            extra_token_params: vec![],
            last_error: String::new(),
            last_warning: String::new(),
            last_status: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRecord {
    #[serde(rename = "type")]
    pub auth_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub token: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub username: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub password: String,
    #[serde(default, rename = "apiKeyName", skip_serializing_if = "String::is_empty")]
    pub api_key_name: String,
    #[serde(default, rename = "apiKeyValue", skip_serializing_if = "String::is_empty")]
    pub api_key_value: String,
    #[serde(default, rename = "apiKeyIn", skip_serializing_if = "is_default_api_key_in")]
    pub api_key_in: String,
    #[serde(default, skip_serializing_if = "is_default_oauth_config")]
    pub oauth2: OAuthConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedResponse {
    #[serde(default)]
    pub status: u16,
    #[serde(default)]
    pub badge: String,
    #[serde(default)]
    pub status_text: String,
    #[serde(default)]
    pub duration: String,
    #[serde(default)]
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
    #[serde(default)]
    pub meta: ResponseMeta,
    #[serde(default)]
    pub saved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMeta {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub method: String,
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

pub(crate) fn fs_load_workspaces(root: &Path) -> Result<Vec<WorkspaceRecord>, String> {
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut workspaces = Vec::new();
    let entries = fs::read_dir(root).map_err(|e| format!("Failed to read storage root: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let ws_file_path = path.join(WORKSPACE_FILE_NAME);
        if !ws_file_path.exists() {
            continue;
        }
        let ws_json = fs::read_to_string(&ws_file_path)
            .map_err(|e| format!("Failed to read workspace.json: {e}"))?;
        let ws_file: WorkspaceFile = serde_json::from_str(&ws_json)
            .map_err(|e| format!("Failed to parse workspace.json: {e}"))?;
        let mut collections = Vec::new();
        for col_meta in ws_file.collections {
            let col_meta_path = PathBuf::from(&col_meta.path);
            let col_path = if col_meta_path.is_absolute() {
                col_meta_path
            } else {
                path.join(&col_meta.path)
            };
            if !col_path.exists() || !col_path.is_dir() {
                continue;
            }
            let mut requests = Vec::new();
            let req_entries = fs::read_dir(&col_path)
                .map_err(|e| format!("Failed to read collection directory: {e}"))?;
            for req_entry in req_entries {
                let req_entry = req_entry.map_err(|e| format!("Failed to read request entry: {e}"))?;
                let req_path = req_entry.path();
                let is_config = req_path.file_name().map_or(false, |n| n == COLLECTION_CONFIG_FILE_NAME);
                if req_path.is_file()
                    && req_path.extension().map_or(false, |e| e == "json")
                    && !is_config
                {
                    let req_json = fs::read_to_string(&req_path)
                        .map_err(|e| format!("Failed to read request file: {e}"))?;
                    match serde_json::from_str::<RequestRecord>(&req_json) {
                        Ok(r) => requests.push(r),
                        Err(e) => eprintln!("Skipping malformed request file {:?}: {e}", req_path),
                    }
                }
            }
            collections.push(CollectionRecord { name: col_meta.name, requests });
        }
        workspaces.push(WorkspaceRecord {
            name: ws_file.info.name,
            description: ws_file.info.description,
            collections,
        });
    }
    Ok(workspaces)
}

pub(crate) fn fs_save_workspaces(root: &Path, workspaces: &[WorkspaceRecord]) -> Result<(), String> {
    if !root.exists() {
        fs::create_dir_all(root).map_err(|e| format!("Failed to create storage root: {e}"))?;
    }
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if path.join(WORKSPACE_FILE_NAME).exists()
                    && !workspaces.iter().any(|w| w.name == dir_name)
                {
                    let _ = fs::remove_dir_all(&path);
                }
            }
        }
    }
    for workspace in workspaces {
        let ws_path = root.join(&workspace.name);
        if !ws_path.exists() {
            fs::create_dir_all(&ws_path)
                .map_err(|e| format!("Failed to create workspace directory: {e}"))?;
        }
        ensure_env_and_gitignore(&ws_path);
        let collections_root = ws_path.join("collections");
        if !collections_root.exists() {
            fs::create_dir_all(&collections_root)
                .map_err(|e| format!("Failed to create collections dir: {e}"))?;
        }
        if let Ok(entries) = fs::read_dir(&collections_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let dir_name = entry.file_name().to_string_lossy().to_string();
                    if !workspace.collections.iter().any(|c| sanitize_name(&c.name) == dir_name) {
                        let _ = fs::remove_dir_all(&path);
                    }
                }
            }
        }
        let mut collections_meta = Vec::new();
        for collection in &workspace.collections {
            let safe_col = sanitize_name(&collection.name);
            let col_dir_name = format!("collections/{}", safe_col);
            let col_path = ws_path.join(&col_dir_name);
            if !col_path.exists() {
                fs::create_dir_all(&col_path)
                    .map_err(|e| format!("Failed to create collection directory: {e}"))?;
            }
            ensure_env_and_gitignore(&col_path);
            for entry in fs::read_dir(&col_path)
                .map_err(|e| format!("Failed to read collection directory: {e}"))?
            {
                let entry = entry.map_err(|e| format!("Failed to read entry: {e}"))?;
                let ep = entry.path();
                if ep.is_file() && ep.extension().map_or(false, |e| e == "json") {
                    let is_config = ep.file_name().map_or(false, |n| n == COLLECTION_CONFIG_FILE_NAME);
                    if !is_config {
                        let _ = fs::remove_file(&ep);
                    }
                }
            }
            for request in &collection.requests {
                let safe_req = sanitize_name(&request.name);
                let req_path = col_path.join(format!("{}.json", safe_req));
                let req_json = serde_json::to_string_pretty(request)
                    .map_err(|e| format!("Failed to serialize request: {e}"))?;
                fs::write(req_path, req_json)
                    .map_err(|e| format!("Failed to write request file: {e}"))?;
            }
            collections_meta.push(CollectionMeta { name: collection.name.clone(), path: col_dir_name });
        }
        let ws_file = WorkspaceFile {
            info: WorkspaceInfo {
                name: workspace.name.clone(),
                resource_type: "workspace".to_string(),
                description: workspace.description.clone(),
            },
            collections: collections_meta,
        };
        let ws_json = serde_json::to_string_pretty(&ws_file)
            .map_err(|e| format!("Failed to serialize workspace.json: {e}"))?;
        fs::write(ws_path.join(WORKSPACE_FILE_NAME), ws_json)
            .map_err(|e| format!("Failed to write workspace.json: {e}"))?;
    }
    Ok(())
}

pub(crate) fn fs_get_env_vars(root: &Path, workspace_name: &str, collection_name: Option<&str>) -> EnvVarsResult {
    let ws_path = root.join(workspace_name);
    let workspace_vars = parse_env_file_ordered(&ws_path.join(".env"));
    let collection_vars = match collection_name {
        Some(col) => {
            let col_path = get_collection_dir(root, workspace_name, col);
            parse_env_file_ordered(&col_path.join(".env"))
        }
        None => vec![],
    };
    let mut merged = HashMap::new();
    for v in &workspace_vars { merged.insert(v.key.clone(), v.value.clone()); }
    for v in &collection_vars { merged.insert(v.key.clone(), v.value.clone()); }
    EnvVarsResult { workspace: workspace_vars, collection: collection_vars, merged }
}

pub(crate) fn fs_save_env_vars(
    root: &Path,
    workspace_name: &str,
    collection_name: Option<&str>,
    vars: &[EnvVar],
) -> Result<(), String> {
    let env_path = match collection_name {
        Some(col) => {
            let col_path = get_collection_dir(root, workspace_name, col);
            if !col_path.exists() {
                fs::create_dir_all(&col_path)
                    .map_err(|e| format!("Failed to create collection dir: {e}"))?;
            }
            col_path.join(".env")
        }
        None => {
            let ws_path = root.join(workspace_name);
            if !ws_path.exists() {
                return Err(format!("Workspace '{}' does not exist", workspace_name));
            }
            ws_path.join(".env")
        }
    };
    write_env_file(&env_path, vars)
}

pub(crate) fn fs_save_collection_config(
    root: &Path,
    workspace_name: &str,
    collection_name: &str,
    config: &CollectionConfig,
) -> Result<(), String> {
    let col_path = get_collection_dir(root, workspace_name, collection_name);
    if !col_path.exists() {
        fs::create_dir_all(&col_path)
            .map_err(|e| format!("Failed to create collection dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize collection config: {e}"))?;
    fs::write(col_path.join(COLLECTION_CONFIG_FILE_NAME), json)
        .map_err(|e| format!("Failed to write collection.json: {e}"))
}

fn get_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app.path().app_data_dir()
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
        let contents = fs::read_to_string(&state_path)
            .map_err(|e| format!("Failed to read state: {e}"))?;
        serde_json::from_str::<PersistedAppState>(&contents).unwrap_or_else(|_| default_state())
    } else {
        default_state()
    };
    state.storage_path = Some(PathBuf::from(path));
    let serialized = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialize state: {e}"))?;
    fs::write(&state_path, serialized).map_err(|e| format!("Failed to write state: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePathValidationResult {
    pub exists: bool,
    pub is_directory: bool,
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSwitchPayload {
    pub path: String,
    pub mode: String,
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(l), Ok(r)) => l == r,
        _ => left == right,
    }
}

fn path_ends_with_kivo(path: &Path) -> bool {
    path.components().rev().find_map(|component| {
        if let Component::Normal(segment) = component {
            return Some(segment.to_string_lossy().eq_ignore_ascii_case("kivo"));
        }
        None
    }).unwrap_or(false)
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

    fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create target directory: {e}"))?;

    for entry in fs::read_dir(source).map_err(|e| format!("Failed to read source directory: {e}"))? {
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
    let app_data = app.path().app_data_dir()
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
    app.path().app_data_dir()
        .map(|d| d.join("data"))
        .map_err(|e| format!("Failed to resolve fallback storage directory: {e}"))
}

#[tauri::command]
pub fn load_app_state(app: AppHandle) -> Result<PersistedAppState, String> {
    let root = get_storage_root(&app)?;
    let workspaces = fs_load_workspaces(&root)?;
    let app_data_dir = app.path().app_data_dir()
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
    let app_data_dir = app.path().app_data_dir()
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
    Ok(fs_get_env_vars(&root, &workspace_name, collection_name.as_deref()))
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
    let path = if let Some(p) = config.storage_path { p } else {
        app.path().app_data_dir()
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
                    if req_path.exists() { path = req_path; }
                }
            }
        }
    }
    if !path.exists() {
        if let Some(parent) = path.parent() {
            if parent.exists() { path = parent.to_path_buf(); }
        }
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .reveal_item_in_dir(path.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to reveal item: {e}"))
}

