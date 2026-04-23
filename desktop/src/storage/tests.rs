use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

use super::{
    fs_get_env_vars, fs_load_workspaces, fs_save_collection_config, fs_save_env_vars,
    fs_save_workspaces, load_collection_config_from_path, parse_env_file_ordered,
    sanitize_name, write_env_file, AuthRecord, CollectionConfig, CollectionRecord,
    CollectionScripts, EnvVar, KeyValueRow, OAuthConfig, RequestRecord, RequestTextOrJson, ResponseMeta, SavedResponse,
    WorkspaceRecord,
};

fn make_request(name: &str) -> RequestRecord {
    RequestRecord {
        name: name.to_string(),
        method: "GET".to_string(),
        url: "https://example.com".to_string(),
        query_params: vec![],
        headers: vec![],
        auth: AuthRecord { auth_type: "none".to_string(), token: String::new(), username: String::new(), password: String::new(), api_key_name: String::new(), api_key_value: String::new(), api_key_in: "header".to_string(), oauth2: OAuthConfig::default() },
        body_type: "json".to_string(),
        body: RequestTextOrJson::Text(String::new()),
        body_rows: vec![],
        body_file_path: String::new(),
        graphql_variables: RequestTextOrJson::Text("{}".to_string()),
        docs: String::new(),
        tags: vec![],
        url_encoding: true,
        follow_redirects: true,
        max_redirects: 5,
        timeout_ms: 0,
        active_editor_tab: "Params".to_string(),
        active_response_tab: "Body".to_string(),
        response_body_view: "JSON".to_string(),
        last_response: None,
    }
}

fn make_request_with_response(name: &str) -> RequestRecord {
    let mut r = make_request(name);
    r.last_response = Some(SavedResponse {
        status: 200,
        badge: "200 OK".to_string(),
        status_text: "200 OK".to_string(),
        duration: "42 ms".to_string(),
        size: "512 B".to_string(),
        headers: HashMap::from([("content-type".to_string(), "application/json".to_string())]),
        cookies: vec!["session=abc".to_string()],
        body: r#"{"ok":true}"#.to_string(),
        raw_body: r#"{"ok":true}"#.to_string(),
        is_json: true,
        meta: ResponseMeta { url: "https://example.com".to_string(), method: "GET".to_string() },
        saved_at: "2026-04-06".to_string(),
    });
    r
}

fn ws(name: &str, collections: Vec<CollectionRecord>) -> WorkspaceRecord {
    WorkspaceRecord { name: name.to_string(), description: None, collections }
}

fn col(name: &str, requests: Vec<RequestRecord>) -> CollectionRecord {
    CollectionRecord { name: name.to_string(), requests }
}

#[cfg(test)]
mod sanitize_tests {
    use super::*;

    #[test]
    fn plain_name_unchanged() { assert_eq!(sanitize_name("auth"), "auth"); }

    #[test]
    fn forward_slash_replaced() { assert_eq!(sanitize_name("auth/user"), "auth_user"); }

    #[test]
    fn backslash_replaced() { assert_eq!(sanitize_name("auth\\user"), "auth_user"); }

    #[test]
    fn colon_replaced() { assert_eq!(sanitize_name("C:drive"), "C_drive"); }

    #[test]
    fn all_special_chars_replaced() { assert_eq!(sanitize_name("/\\:*?\"<>|"), "_________"); }

    #[test]
    fn multiple_slashes() { assert_eq!(sanitize_name("/api/v1/users"), "_api_v1_users"); }

    #[test]
    fn leading_trailing_spaces_trimmed() { assert_eq!(sanitize_name("  auth  "), "auth"); }

    #[test]
    fn empty_string() { assert_eq!(sanitize_name(""), ""); }

    #[test]
    fn unicode_preserved() { assert_eq!(sanitize_name("café"), "café"); }

    #[test]
    fn numbers_and_dashes_preserved() { assert_eq!(sanitize_name("api-v2-users"), "api-v2-users"); }

    #[test]
    fn deeply_nested_path() { assert_eq!(sanitize_name("a/b/c/d/e"), "a_b_c_d_e"); }
}

#[cfg(test)]
mod env_file_tests {
    use super::*;

    #[test]
    fn parse_basic_key_value() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "KEY=value\n").unwrap();
        let vars = parse_env_file_ordered(&path);
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].key, "KEY");
        assert_eq!(vars[0].value, "value");
    }

    #[test]
    fn parse_skips_comments_and_blanks() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "# comment\n\nKEY=val\n").unwrap();
        let vars = parse_env_file_ordered(&path);
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].key, "KEY");
    }

    #[test]
    fn parse_strips_double_quotes() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "KEY=\"hello world\"\n").unwrap();
        assert_eq!(parse_env_file_ordered(&path)[0].value, "hello world");
    }

    #[test]
    fn parse_strips_single_quotes() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "KEY='hello world'\n").unwrap();
        assert_eq!(parse_env_file_ordered(&path)[0].value, "hello world");
    }

    #[test]
    fn parse_deduplicates_keys_keeps_first() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "KEY=first\nKEY=second\n").unwrap();
        let vars = parse_env_file_ordered(&path);
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].value, "first");
    }

    #[test]
    fn parse_nonexistent_file_returns_empty() {
        assert!(parse_env_file_ordered(Path::new("/nonexistent/.env")).is_empty());
    }

    #[test]
    fn parse_value_with_equals_sign() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "KEY=a=b=c\n").unwrap();
        assert_eq!(parse_env_file_ordered(&path)[0].value, "a=b=c");
    }

    #[test]
    fn parse_preserves_insertion_order() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        fs::write(&path, "Z=last\nA=first\nM=mid\n").unwrap();
        let vars = parse_env_file_ordered(&path);
        assert_eq!(vars[0].key, "Z");
        assert_eq!(vars[1].key, "A");
        assert_eq!(vars[2].key, "M");
    }

    #[test]
    fn write_and_read_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        let vars = vec![
            EnvVar { key: "HOST".to_string(), value: "localhost".to_string() },
            EnvVar { key: "PORT".to_string(), value: "8080".to_string() },
        ];
        write_env_file(&path, &vars).unwrap();
        let loaded = parse_env_file_ordered(&path);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].key, "HOST");
        assert_eq!(loaded[1].key, "PORT");
    }

    #[test]
    fn write_empty_vars_produces_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        write_env_file(&path, &[]).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "");
    }

    #[test]
    fn write_skips_blank_keys() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        let vars = vec![
            EnvVar { key: "  ".to_string(), value: "ignored".to_string() },
            EnvVar { key: "REAL".to_string(), value: "kept".to_string() },
        ];
        write_env_file(&path, &vars).unwrap();
        let loaded = parse_env_file_ordered(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].key, "REAL");
    }

    #[test]
    fn write_100_vars_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".env");
        let vars: Vec<EnvVar> = (0..100)
            .map(|i| EnvVar { key: format!("KEY_{}", i), value: format!("val_{}", i) })
            .collect();
        write_env_file(&path, &vars).unwrap();
        let loaded = parse_env_file_ordered(&path);
        assert_eq!(loaded.len(), 100);
        for (i, v) in loaded.iter().enumerate() {
            assert_eq!(v.key, format!("KEY_{}", i));
        }
    }
}

#[cfg(test)]
mod fs_env_vars_tests {
    use super::*;

    #[test]
    fn save_and_get_workspace_env_vars() {
        let dir = TempDir::new().unwrap();
        let ws_path = dir.path().join("ws");
        fs::create_dir_all(&ws_path).unwrap();
        let vars = vec![
            EnvVar { key: "BASE_URL".to_string(), value: "https://api.example.com".to_string() },
            EnvVar { key: "TOKEN".to_string(), value: "secret".to_string() },
        ];
        fs_save_env_vars(dir.path(), "ws", None, &vars).unwrap();
        let result = fs_get_env_vars(dir.path(), "ws", None);
        assert_eq!(result.workspace.len(), 2);
        assert_eq!(result.workspace[0].key, "BASE_URL");
        assert!(result.collection.is_empty());
        assert_eq!(result.merged["BASE_URL"], "https://api.example.com");
    }

    #[test]
    fn save_and_get_collection_env_vars() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![])])]).unwrap();
        let vars = vec![EnvVar { key: "API_KEY".to_string(), value: "xyz".to_string() }];
        fs_save_env_vars(dir.path(), "ws", Some("api"), &vars).unwrap();
        let result = fs_get_env_vars(dir.path(), "ws", Some("api"));
        assert_eq!(result.collection.len(), 1);
        assert_eq!(result.collection[0].key, "API_KEY");
    }

    #[test]
    fn collection_vars_override_workspace_vars_in_merged() {
        let dir = TempDir::new().unwrap();
        let ws_path = dir.path().join("ws");
        fs::create_dir_all(&ws_path).unwrap();
        fs_save_env_vars(dir.path(), "ws", None, &[
            EnvVar { key: "HOST".to_string(), value: "global.example.com".to_string() },
        ]).unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![])])]).unwrap();
        fs_save_env_vars(dir.path(), "ws", Some("api"), &[
            EnvVar { key: "HOST".to_string(), value: "collection.example.com".to_string() },
        ]).unwrap();
        let result = fs_get_env_vars(dir.path(), "ws", Some("api"));
        assert_eq!(result.merged["HOST"], "collection.example.com");
    }

    #[test]
    fn save_env_vars_fails_for_nonexistent_workspace() {
        let dir = TempDir::new().unwrap();
        let result = fs_save_env_vars(dir.path(), "ghost", None, &[]);
        assert!(result.is_err());
    }

    #[test]
    fn env_file_not_wiped_after_save_workspaces() {
        let dir = TempDir::new().unwrap();
        let workspaces = vec![ws("ws", vec![col("api", vec![make_request("r")])])];
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let col_env = dir.path().join("ws").join("collections").join("api").join(".env");
        fs::write(&col_env, "SECRET=abc\n").unwrap();
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        assert_eq!(fs::read_to_string(&col_env).unwrap(), "SECRET=abc\n");
    }
}

#[cfg(test)]
mod collection_config_tests {
    use super::*;

    #[test]
    fn returns_default_when_no_file() {
        let dir = TempDir::new().unwrap();
        let config = load_collection_config_from_path(dir.path());
        assert_eq!(config.default_auth.auth_type, "none");
        assert!(config.default_headers.is_empty());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![])])]).unwrap();
        let config = CollectionConfig {
            default_auth: AuthRecord { auth_type: "bearer".to_string(), token: "tok123".to_string(), username: String::new(), password: String::new(), api_key_name: String::new(), api_key_value: String::new(), api_key_in: "header".to_string(), oauth2: OAuthConfig::default() },
            default_headers: vec![
                KeyValueRow { key: "X-Api-Key".to_string(), value: "secret".to_string(), enabled: true },
            ],
            scripts: CollectionScripts {
                pre_request: "console.log('pre')".to_string(),
                post_response: "console.log('post')".to_string(),
            },
        };
        fs_save_collection_config(dir.path(), "ws", "api", &config).unwrap();
        let col_path = dir.path().join("ws").join("collections").join("api");
        let loaded = load_collection_config_from_path(&col_path);
        assert_eq!(loaded.default_auth.auth_type, "bearer");
        assert_eq!(loaded.default_auth.token, "tok123");
        assert_eq!(loaded.default_headers[0].key, "X-Api-Key");
        assert_eq!(loaded.scripts.pre_request, "console.log('pre')");
    }

    #[test]
    fn malformed_json_returns_default() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("collection.json"), "{ not valid json !!!").unwrap();
        let config = load_collection_config_from_path(dir.path());
        assert_eq!(config.default_auth.auth_type, "none");
    }

    #[test]
    fn collection_json_preserved_across_request_saves() {
        let dir = TempDir::new().unwrap();
        let workspaces = vec![ws("ws", vec![col("api", vec![make_request("r")])])];
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let config = CollectionConfig {
            default_auth: AuthRecord { auth_type: "bearer".to_string(), token: "preserved".to_string(), username: String::new(), password: String::new(), api_key_name: String::new(), api_key_value: String::new(), api_key_in: "header".to_string(), oauth2: OAuthConfig::default() },
            default_headers: vec![],
            scripts: CollectionScripts::default(),
        };
        fs_save_collection_config(dir.path(), "ws", "api", &config).unwrap();
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let col_path = dir.path().join("ws").join("collections").join("api");
        let loaded = load_collection_config_from_path(&col_path);
        assert_eq!(loaded.default_auth.token, "preserved");
    }

    #[test]
    fn collection_config_with_slash_name_saved_to_sanitized_path() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("auth/user", vec![])])]).unwrap();
        let config = CollectionConfig {
            default_auth: AuthRecord { auth_type: "bearer".to_string(), token: "tok".to_string(), username: String::new(), password: String::new(), api_key_name: String::new(), api_key_value: String::new(), api_key_in: "header".to_string(), oauth2: OAuthConfig::default() },
            default_headers: vec![],
            scripts: CollectionScripts::default(),
        };
        fs_save_collection_config(dir.path(), "ws", "auth/user", &config).unwrap();
        let col_path = dir.path().join("ws").join("collections").join("auth_user");
        let loaded = load_collection_config_from_path(&col_path);
        assert_eq!(loaded.default_auth.token, "tok");
    }
}

#[cfg(test)]
mod save_load_tests {
    use super::*;

    #[test]
    fn save_and_load_single_workspace_no_collections() {
        let dir = TempDir::new().unwrap();
        let workspaces = vec![WorkspaceRecord {
            name: "MyWorkspace".to_string(),
            description: Some("desc".to_string()),
            collections: vec![],
        }];
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "MyWorkspace");
        assert_eq!(loaded[0].description.as_deref(), Some("desc"));
        assert!(loaded[0].collections.is_empty());
    }

    #[test]
    fn save_and_load_requests() {
        let dir = TempDir::new().unwrap();
        let workspaces = vec![ws("ws", vec![col("auth", vec![
            make_request("GET /login"),
            make_request("POST /logout"),
        ])])];
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded[0].collections[0].requests.len(), 2);
    }

    #[test]
    fn request_files_created_on_disk() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("users", vec![
            make_request("GET /users"),
            make_request("DELETE /users/1"),
        ])])]).unwrap();
        let col_path = dir.path().join("ws").join("collections").join("users");
        let json_files: Vec<_> = fs::read_dir(&col_path).unwrap()
            .flatten()
            .filter(|e| e.path().extension().map_or(false, |x| x == "json"))
            .collect();
        assert_eq!(json_files.len(), 2);
    }

    #[test]
    fn collection_name_with_slash_sanitized_on_disk() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("auth/user", vec![make_request("r")])])]).unwrap();
        assert!(dir.path().join("ws").join("collections").join("auth_user").is_dir());
        assert!(!dir.path().join("ws").join("collections").join("auth").exists());
    }

    #[test]
    fn request_name_with_slash_sanitized_on_disk() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![make_request("/auth/login")])])]).unwrap();
        let col_path = dir.path().join("ws").join("collections").join("api");
        assert!(col_path.join("_auth_login.json").exists());
    }

    #[test]
    fn request_display_name_preserved_inside_json() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![make_request("/auth/login")])])]).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded[0].collections[0].requests[0].name, "/auth/login");
    }

    #[test]
    fn delete_request_removes_file_from_disk() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![
            make_request("req-a"), make_request("req-b"), make_request("req-c"),
        ])])]).unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![
            make_request("req-a"), make_request("req-c"),
        ])])]).unwrap();
        let col_path = dir.path().join("ws").join("collections").join("api");
        assert!(!col_path.join("req-b.json").exists());
        assert!(col_path.join("req-a.json").exists());
        assert!(col_path.join("req-c.json").exists());
    }

    #[test]
    fn delete_all_requests_leaves_empty_collection_dir() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![make_request("r1"), make_request("r2")])])]).unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![])])]).unwrap();
        let col_path = dir.path().join("ws").join("collections").join("api");
        let json_files: Vec<_> = fs::read_dir(&col_path).unwrap()
            .flatten()
            .filter(|e| e.path().extension().map_or(false, |x| x == "json"))
            .collect();
        assert!(json_files.is_empty());
    }

    #[test]
    fn delete_collection_removes_dir_from_disk() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![
            col("keep", vec![make_request("r")]),
            col("remove", vec![make_request("r")]),
        ])]).unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("keep", vec![make_request("r")])])]).unwrap();
        assert!(!dir.path().join("ws").join("collections").join("remove").exists());
        assert!(dir.path().join("ws").join("collections").join("keep").exists());
    }

    #[test]
    fn delete_workspace_removes_directory() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("keep", vec![]), ws("gone", vec![])]).unwrap();
        fs_save_workspaces(dir.path(), &[ws("keep", vec![])]).unwrap();
        assert!(dir.path().join("keep").exists());
        assert!(!dir.path().join("gone").exists());
    }

    #[test]
    fn workspace_without_workspace_json_not_loaded() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("orphan")).unwrap();
        fs_save_workspaces(dir.path(), &[ws("real", vec![])]).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "real");
    }

    #[test]
    fn update_request_content_on_resave() {
        let dir = TempDir::new().unwrap();
        let mut req = make_request("req");
        req.url = "https://old.example.com".to_string();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![req])])]).unwrap();
        let mut req2 = make_request("req");
        req2.url = "https://new.example.com".to_string();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![req2])])]).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded[0].collections[0].requests[0].url, "https://new.example.com");
    }
}

#[cfg(test)]
mod complex_scenario_tests {
    use super::*;

    #[test]
    fn full_request_data_survives_save_load() {
        let dir = TempDir::new().unwrap();
        let mut req = make_request_with_response("POST /auth/token");
        req.method = "POST".to_string();
        req.url = "https://api.example.com/auth/token".to_string();
        req.body = RequestTextOrJson::Text(r#"{"username":"admin","password":"secret"}"#.to_string());
        req.body_type = "json".to_string();
        req.query_params = vec![KeyValueRow { key: "v".to_string(), value: "2".to_string(), enabled: true }];
        req.headers = vec![KeyValueRow { key: "Content-Type".to_string(), value: "application/json".to_string(), enabled: true }];
        req.auth = AuthRecord { auth_type: "bearer".to_string(), token: "tok".to_string(), username: String::new(), password: String::new(), api_key_name: String::new(), api_key_value: String::new(), api_key_in: "header".to_string(), oauth2: OAuthConfig::default() };
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("auth", vec![req])])]).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        let r = &loaded[0].collections[0].requests[0];
        assert_eq!(r.name, "POST /auth/token");
        assert_eq!(r.method, "POST");
        assert_eq!(r.query_params[0].key, "v");
        assert_eq!(r.headers[0].key, "Content-Type");
        assert_eq!(r.auth.auth_type, "bearer");
        assert_eq!(r.last_response.as_ref().unwrap().status, 200);
        assert!(r.last_response.as_ref().unwrap().is_json);
    }

    #[test]
    fn rename_request_old_file_gone_new_file_present() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![make_request("old-name")])])]).unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![make_request("new-name")])])]).unwrap();
        let col_path = dir.path().join("ws").join("collections").join("api");
        assert!(!col_path.join("old-name.json").exists());
        assert!(col_path.join("new-name.json").exists());
    }

    #[test]
    fn collection_with_slash_name_loads_correctly() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("auth/user", vec![
            make_request("GET /me"), make_request("PUT /me"),
        ])])]).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded[0].collections[0].name, "auth/user");
        assert_eq!(loaded[0].collections[0].requests.len(), 2);
    }

    #[test]
    fn deeply_nested_request_names_with_slashes() {
        let dir = TempDir::new().unwrap();
        let names = vec!["/api/v2/admin/users", "/api/v2/admin/roles", "/api/v2/admin/permissions"];
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api/v2/admin", vec![
            make_request(names[0]), make_request(names[1]), make_request(names[2]),
        ])])]).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        let loaded_names: Vec<&str> = loaded[0].collections[0].requests.iter().map(|r| r.name.as_str()).collect();
        for name in &names {
            assert!(loaded_names.contains(name), "missing: {}", name);
        }
    }

    #[test]
    fn multiple_workspaces_multiple_collections() {
        let dir = TempDir::new().unwrap();
        let workspaces = vec![
            ws("ws-one", vec![col("col-a", vec![make_request("r1")])]),
            ws("ws-two", vec![
                col("col-b", vec![make_request("r2"), make_request("r3")]),
                col("col-c", vec![make_request("r4")]),
            ]),
        ];
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded.len(), 2);
        let ws2 = loaded.iter().find(|w| w.name == "ws-two").unwrap();
        assert_eq!(ws2.collections.len(), 2);
        let col_b = ws2.collections.iter().find(|c| c.name == "col-b").unwrap();
        assert_eq!(col_b.requests.len(), 2);
    }

    #[test]
    fn malformed_request_file_skipped_others_loaded() {
        let dir = TempDir::new().unwrap();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![make_request("good")])])]).unwrap();
        let col_path = dir.path().join("ws").join("collections").join("api");
        fs::write(col_path.join("broken.json"), "{ not valid json !!!").unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert!(loaded[0].collections[0].requests.iter().any(|r| r.name == "good"));
    }
}

#[cfg(test)]
mod stress_tests {
    use super::*;

    #[test]
    fn fifty_workspaces_ten_collections_twenty_requests() {
        let dir = TempDir::new().unwrap();
        let workspaces: Vec<WorkspaceRecord> = (0..50).map(|wi| ws(
            &format!("workspace-{}", wi),
            (0..10).map(|ci| col(
                &format!("collection-{}-{}", wi, ci),
                (0..20).map(|ri| make_request(&format!("request-{}-{}-{}", wi, ci, ri))).collect(),
            )).collect(),
        )).collect();
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded.len(), 50);
        for w in &loaded {
            assert_eq!(w.collections.len(), 10);
            for c in &w.collections {
                assert_eq!(c.requests.len(), 20);
            }
        }
    }

    #[test]
    fn repeated_save_load_cycles_stay_consistent() {
        let dir = TempDir::new().unwrap();
        let workspaces = vec![ws("ws", vec![col("api", (0..10).map(|i| make_request(&format!("req-{}", i))).collect())])];
        for _ in 0..20 {
            fs_save_workspaces(dir.path(), &workspaces).unwrap();
            let loaded = fs_load_workspaces(dir.path()).unwrap();
            assert_eq!(loaded[0].collections[0].requests.len(), 10);
        }
    }

    #[test]
    fn all_special_char_collection_names() {
        let dir = TempDir::new().unwrap();
        let names = vec!["auth/user", "api\\v2", "col:name", "col*wild", "col?query", "col\"q\"", "col<x>", "col|pipe"];
        let workspaces = vec![ws("ws", names.iter().map(|n| col(n, vec![make_request("r")])).collect())];
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded[0].collections.len(), names.len());
        for name in &names {
            assert!(loaded[0].collections.iter().any(|c| c.name == *name), "missing: {}", name);
        }
    }

    #[test]
    fn all_special_char_request_names() {
        let dir = TempDir::new().unwrap();
        let names = vec!["/api/v1/users", "GET /auth/login", "POST /api/v2/token", "DELETE /users/1/roles/2"];
        let workspaces = vec![ws("ws", vec![col("api", names.iter().map(|n| make_request(n)).collect())])];
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        let loaded_names: Vec<&str> = loaded[0].collections[0].requests.iter().map(|r| r.name.as_str()).collect();
        for name in &names {
            assert!(loaded_names.contains(name), "missing: {}", name);
        }
    }

    #[test]
    fn incremental_delete_requests_one_by_one() {
        let dir = TempDir::new().unwrap();
        let mut requests: Vec<RequestRecord> = (0..10).map(|i| make_request(&format!("req-{}", i))).collect();
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", requests.clone())])]).unwrap();
        for expected in (0..10).rev() {
            requests.pop();
            fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", requests.clone())])]).unwrap();
            let loaded = fs_load_workspaces(dir.path()).unwrap();
            assert_eq!(loaded[0].collections[0].requests.len(), expected);
        }
    }

    #[test]
    fn delete_half_of_twenty_collections() {
        let dir = TempDir::new().unwrap();
        let all: Vec<CollectionRecord> = (0..20).map(|i| col(&format!("col-{}", i), vec![make_request("r")])).collect();
        fs_save_workspaces(dir.path(), &[ws("ws", all)]).unwrap();
        let kept: Vec<CollectionRecord> = (0..20).filter(|i| i % 2 == 0).map(|i| col(&format!("col-{}", i), vec![make_request("r")])).collect();
        fs_save_workspaces(dir.path(), &[ws("ws", kept)]).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        assert_eq!(loaded[0].collections.len(), 10);
        for c in &loaded[0].collections {
            let idx: usize = c.name.split('-').last().unwrap().parse().unwrap();
            assert_eq!(idx % 2, 0);
        }
    }

    #[test]
    fn request_with_100kb_body_roundtrips() {
        let dir = TempDir::new().unwrap();
        let mut req = make_request("POST /upload");
        req.body = RequestTextOrJson::Text("x".repeat(100_000));
        fs_save_workspaces(dir.path(), &[ws("ws", vec![col("api", vec![req])])]).unwrap();
        let loaded = fs_load_workspaces(dir.path()).unwrap();
        match &loaded[0].collections[0].requests[0].body {
            RequestTextOrJson::Text(body) => assert_eq!(body.len(), 100_000),
            RequestTextOrJson::Json(_) => panic!("expected text body"),
        }
    }

    #[test]
    fn env_file_intact_across_fifteen_saves() {
        let dir = TempDir::new().unwrap();
        let workspaces = vec![ws("ws", vec![col("api", vec![make_request("r")])])];
        fs_save_workspaces(dir.path(), &workspaces).unwrap();
        let col_env = dir.path().join("ws").join("collections").join("api").join(".env");
        write_env_file(&col_env, &[
            EnvVar { key: "BASE_URL".to_string(), value: "https://api.example.com".to_string() },
            EnvVar { key: "API_KEY".to_string(), value: "supersecret".to_string() },
        ]).unwrap();
        for _ in 0..15 {
            fs_save_workspaces(dir.path(), &workspaces).unwrap();
        }
        let loaded = parse_env_file_ordered(&col_env);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].key, "BASE_URL");
        assert_eq!(loaded[1].key, "API_KEY");
    }
}
