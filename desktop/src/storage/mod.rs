use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[cfg(test)]
mod tests;

const WORKSPACE_FILE_NAME: &str = "workspace.json";
const COLLECTION_CONFIG_FILE_NAME: &str = "collection.json";
const COLLECTION_STATE_FILE_NAME: &str = ".kivo-collection-state.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedCollectionResult {
    pub detected_format: String,
    pub collection: CollectionRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedRequestsResult {
    pub detected_format: String,
    pub requests: Vec<RequestRecord>,
}

fn empty_request(name: String, method: String, url: String) -> RequestRecord {
    RequestRecord {
        name,
        method,
        url,
        query_params: vec![],
        headers: vec![],
        auth: default_auth_record(),
        body_type: "none".to_string(),
        body: RequestTextOrJson::Text(String::new()),
        body_rows: vec![],
        body_file_path: String::new(),
        graphql_variables: RequestTextOrJson::Text(String::new()),
        docs: String::new(),
        tags: vec![],
        url_encoding: true,
        follow_redirects: true,
        max_redirects: 5,
        timeout_ms: 0,
        folder_path: String::new(),
        active_editor_tab: "Params".to_string(),
        active_response_tab: "Body".to_string(),
        response_body_view: "JSON".to_string(),
        last_response: None,
    }
}

fn split_url_query(raw_url: &str) -> (String, Vec<KeyValueRow>) {
    let url = raw_url.trim();
    let mut rows = vec![];
    let Some((base, query)) = url.split_once('?') else {
        return (url.to_string(), rows);
    };
    for part in query.split('&') {
        if part.trim().is_empty() {
            continue;
        }
        let (key, value) = part.split_once('=').unwrap_or((part, ""));
        rows.push(KeyValueRow {
            key: key.to_string(),
            value: value.to_string(),
            enabled: true,
        });
    }
    (base.to_string(), rows)
}

fn as_str(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(|v| v.as_str())
        .map_or_else(String::new, ToString::to_string)
}

fn parse_headers_array(value: Option<&serde_json::Value>) -> Vec<KeyValueRow> {
    let mut headers = vec![];
    if let Some(items) = value.and_then(|v| v.as_array()) {
        for item in items {
            let key = as_str(item.get("key"));
            if key.trim().is_empty() {
                continue;
            }
            headers.push(KeyValueRow {
                key,
                value: as_str(item.get("value")),
                enabled: item.get("disabled").and_then(|v| v.as_bool()).map_or(true, |v| !v),
            });
        }
    }
    headers
}

fn parse_headers_object(value: Option<&serde_json::Value>) -> Vec<KeyValueRow> {
    let mut headers = vec![];
    if let Some(obj) = value.and_then(|v| v.as_object()) {
        for (key, value) in obj {
            if key.trim().is_empty() {
                continue;
            }
            headers.push(KeyValueRow {
                key: key.to_string(),
                value: value.as_str().unwrap_or("").to_string(),
                enabled: true,
            });
        }
    }
    headers
}

fn parse_headers_any(value: Option<&serde_json::Value>) -> Vec<KeyValueRow> {
    let array_headers = parse_headers_array(value);
    if !array_headers.is_empty() {
        return array_headers;
    }
    parse_headers_object(value)
}

fn parse_url_value(value: Option<&serde_json::Value>) -> String {
    let Some(value) = value else { return String::new(); };
    if let Some(url) = value.as_str() {
        return url.to_string();
    }
    as_str(value.get("raw"))
        .if_empty_then(|| as_str(value.get("url")))
        .if_empty_then(|| as_str(value.get("href")))
}

fn parse_postman_url(url: Option<&serde_json::Value>) -> String {
    let Some(url) = url else { return String::new(); };
    if let Some(raw) = url.as_str() {
        return raw.to_string();
    }
    if let Some(raw) = url.get("raw").and_then(|v| v.as_str()) {
        return raw.to_string();
    }

    let host = url
        .get("host")
        .and_then(|v| v.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(".")
        })
        .unwrap_or_default();
    let path = url
        .get("path")
        .and_then(|v| v.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default();

    let mut built = if host.is_empty() {
        format!("/{}", path.trim_start_matches('/'))
    } else {
        format!("https://{}/{}", host, path.trim_start_matches('/'))
    };

    if let Some(query) = url.get("query").and_then(|v| v.as_array()) {
        let pairs = query
            .iter()
            .filter_map(|entry| {
                let key = entry.get("key").and_then(|v| v.as_str())?;
                if key.trim().is_empty() {
                    return None;
                }
                let value = entry.get("value").and_then(|v| v.as_str()).unwrap_or("");
                Some(format!("{}={}", key, value))
            })
            .collect::<Vec<_>>();
        if !pairs.is_empty() {
            built.push('?');
            built.push_str(&pairs.join("&"));
        }
    }

    built
}

fn import_postman_items(
    items: &[serde_json::Value],
    folder_prefix: &str,
    requests: &mut Vec<RequestRecord>,
    folders: &mut BTreeSet<String>,
) {
    for item in items {
        let name = as_str(item.get("name"));
        if let Some(children) = item.get("item").and_then(|v| v.as_array()) {
            let next_folder = if folder_prefix.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", folder_prefix, name)
            };
            if !next_folder.trim().is_empty() {
                folders.insert(next_folder.clone());
            }
            import_postman_items(children, &next_folder, requests, folders);
            continue;
        }

        let req_json = item.get("request").unwrap_or(&serde_json::Value::Null);
        let method = as_str(req_json.get("method")).to_uppercase();
        let raw_url = parse_postman_url(req_json.get("url"));
        let (url, query_params) = split_url_query(&raw_url);

        let mut request = empty_request(
            if name.trim().is_empty() {
                format!("{} {}", if method.is_empty() { "GET" } else { &method }, if url.is_empty() { "/" } else { &url })
            } else {
                name
            },
            if method.is_empty() { "GET".to_string() } else { method },
            url,
        );
        request.query_params = query_params;
        request.headers = parse_headers_array(req_json.get("header"));
        request.folder_path = folder_prefix.to_string();

        if let Some(body) = req_json.get("body") {
            let mode = as_str(body.get("mode"));
            if mode == "raw" {
                request.body_type = "json".to_string();
                request.body = RequestTextOrJson::Text(as_str(body.get("raw")));
            } else if mode == "urlencoded" || mode == "formdata" {
                request.body_type = if mode == "urlencoded" {
                    "form-urlencoded".to_string()
                } else {
                    "form-data".to_string()
                };
                request.body_rows = body
                    .get(if mode == "urlencoded" { "urlencoded" } else { "formdata" })
                    .and_then(|v| v.as_array())
                    .map(|rows| {
                        rows
                            .iter()
                            .map(|row| KeyValueRow {
                                key: as_str(row.get("key")),
                                value: as_str(row.get("value")),
                                enabled: row.get("disabled").and_then(|v| v.as_bool()).map_or(true, |v| !v),
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
            }
        }

        requests.push(request);
    }
}

fn detect_format(value: &serde_json::Value) -> String {
    if value.get("openapi").is_some() {
        return "openapi3".to_string();
    }
    if value.get("swagger").and_then(|v| v.as_str()).map_or(false, |v| v == "2.0") {
        return "swagger2".to_string();
    }
    if value.get("item").is_some() || value.get("info").and_then(|v| v.get("_postman_id")).is_some() {
        return "postman".to_string();
    }
    if value.get("requests").is_some()
        || value.get("folders").is_some()
        || value.get("bruno").is_some()
        || value.get("collection").is_some()
        || value.get("items").is_some()
    {
        return "bruno".to_string();
    }
    "unknown".to_string()
}

fn import_openapi_like(value: &serde_json::Value, format: &str) -> CollectionRecord {
    let name = value
        .get("info")
        .and_then(|v| v.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or(if format == "swagger2" { "Swagger Import" } else { "OpenAPI Import" })
        .to_string();

    let mut requests = vec![];
    if let Some(paths) = value.get("paths").and_then(|v| v.as_object()) {
        for (path, path_item) in paths {
            let Some(path_obj) = path_item.as_object() else { continue; };
            for method in ["get", "post", "put", "patch", "delete", "head", "options"] {
                let Some(op) = path_obj.get(method) else { continue; };
                let op_name = op
                    .get("operationId")
                    .and_then(|v| v.as_str())
                    .or_else(|| op.get("summary").and_then(|v| v.as_str()))
                    .unwrap_or("");
                let req_name = if op_name.trim().is_empty() {
                    format!("{} {}", method.to_uppercase(), path)
                } else {
                    op_name.to_string()
                };
                let mut request = empty_request(req_name, method.to_uppercase(), path.to_string());

                if let Some(params) = op.get("parameters").and_then(|v| v.as_array()) {
                    for param in params {
                        if param.get("in").and_then(|v| v.as_str()) == Some("query") {
                            let key = as_str(param.get("name"));
                            if key.trim().is_empty() {
                                continue;
                            }
                            request.query_params.push(KeyValueRow {
                                key,
                                value: String::new(),
                                enabled: true,
                            });
                        }
                    }
                }

                requests.push(request);
            }
        }
    }

    CollectionRecord {
        name,
        folders: vec![],
        folder_settings: vec![],
        requests,
    }
}

fn import_bruno(value: &serde_json::Value) -> CollectionRecord {
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("info").and_then(|v| v.get("name")).and_then(|v| v.as_str()))
        .or_else(|| value.get("collection").and_then(|v| v.get("name")).and_then(|v| v.as_str()))
        .unwrap_or("Bruno Import")
        .to_string();

    let mut requests = vec![];
    let mut folders = BTreeSet::new();

    fn collect_bruno_items(
        items: &[serde_json::Value],
        folder_prefix: &str,
        folders: &mut BTreeSet<String>,
        requests: &mut Vec<RequestRecord>,
    ) {
        for item in items {
            let name = as_str(item.get("name"))
                .if_empty_then(|| as_str(item.get("info").and_then(|info| info.get("name"))));
            let node_type = as_str(item.get("type"))
                .if_empty_then(|| as_str(item.get("info").and_then(|info| info.get("type"))))
                .to_lowercase();
            let child_items = item
                .get("items")
                .and_then(|v| v.as_array())
                .or_else(|| item.get("item").and_then(|v| v.as_array()))
                .or_else(|| item.get("requests").and_then(|v| v.as_array()));

            if child_items.is_some() && (node_type == "folder" || node_type == "group" || node_type == "collection" || item.get("request").is_none()) {
                let next_folder = if folder_prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", folder_prefix, name)
                };
                if !next_folder.trim().is_empty() {
                    folders.insert(next_folder.clone());
                }
                if let Some(children) = child_items {
                    collect_bruno_items(children, &next_folder, folders, requests);
                }
                continue;
            }

            let method = as_str(item.get("method"))
                .if_empty_then(|| as_str(item.get("request").and_then(|req| req.get("method"))))
                .if_empty_then(|| as_str(item.get("http").and_then(|http| http.get("method"))))
                .if_empty_then(|| as_str(item.get("graphql").and_then(|graphql| graphql.get("method"))))
                .to_uppercase();
            let url = parse_url_value(item.get("url"))
                .if_empty_then(|| parse_url_value(item.get("request").and_then(|req| req.get("url"))))
                .if_empty_then(|| as_str(item.get("request").and_then(|req| req.get("rawUrl"))))
                .if_empty_then(|| parse_url_value(item.get("http").and_then(|http| http.get("url"))))
                .if_empty_then(|| parse_url_value(item.get("graphql").and_then(|graphql| graphql.get("url"))));

            if method.trim().is_empty() && url.trim().is_empty() {
                continue;
            }

            let mut request = empty_request(
                name.if_empty_then(|| format!("{} {}", if method.is_empty() { "GET" } else { &method }, if url.is_empty() { "/" } else { &url })),
                if method.is_empty() { "GET".to_string() } else { method },
                url,
            );

            request.folder_path = as_str(item.get("folder"));
            if request.folder_path.trim().is_empty() {
                request.folder_path = folder_prefix.to_string();
            }
            if !request.folder_path.is_empty() {
                folders.insert(request.folder_path.clone());
            }

            request.headers = parse_headers_any(
                item.get("headers")
                    .or_else(|| item.get("request").and_then(|req| req.get("headers")))
                    .or_else(|| item.get("http").and_then(|http| http.get("headers"))),
            );

            if let Some(body) = item
                .get("body")
                .and_then(|v| v.as_str())
                .or_else(|| item.get("request").and_then(|req| req.get("body")).and_then(|v| v.as_str()))
                .or_else(|| item.get("request").and_then(|req| req.get("body")).and_then(|v| v.get("raw")).and_then(|v| v.as_str()))
                .or_else(|| item.get("http").and_then(|http| http.get("body")).and_then(|v| v.get("raw")).and_then(|v| v.as_str()))
                .or_else(|| item.get("http").and_then(|http| http.get("body")).and_then(|v| v.get("data")).and_then(|v| v.as_str()))
                .or_else(|| item.get("graphql").and_then(|graphql| graphql.get("body")).and_then(|v| v.get("query")).and_then(|v| v.as_str()))
            {
                request.body_type = if node_type == "graphql" { "graphql".to_string() } else { "json".to_string() };
                request.body = RequestTextOrJson::Text(body.to_string());
            }

            if node_type == "graphql" {
                if request.url.trim().is_empty() {
                    request.url = as_str(item.get("graphql").and_then(|graphql| graphql.get("url")));
                }
                if request.method.trim().is_empty() {
                    request.method = as_str(item.get("graphql").and_then(|graphql| graphql.get("method"))).to_uppercase();
                }
                if request.method.trim().is_empty() {
                    request.method = "POST".to_string();
                }
            }

            requests.push(request);
        }
    }

    let items = value
        .get("requests")
        .and_then(|v| v.as_array())
        .or_else(|| value.get("collection").and_then(|v| v.get("requests")).and_then(|v| v.as_array()))
        .or_else(|| value.get("items").and_then(|v| v.as_array()))
        .or_else(|| value.get("item").and_then(|v| v.as_array()));

    if let Some(items) = items {
        collect_bruno_items(items, "", &mut folders, &mut requests);
    }

    CollectionRecord {
        name,
        folders: folders.into_iter().collect(),
        folder_settings: vec![],
        requests,
    }
}

trait IfEmptyThen {
    fn if_empty_then<F: FnOnce() -> String>(self, fallback: F) -> String;
}

impl IfEmptyThen for String {
    fn if_empty_then<F: FnOnce() -> String>(self, fallback: F) -> String {
        if self.trim().is_empty() {
            fallback()
        } else {
            self
        }
    }
}

fn import_collection_value(value: &serde_json::Value) -> Result<ImportedCollectionResult, String> {
    let detected_format = detect_format(value);
    let collection = match detected_format.as_str() {
        "postman" => {
            let mut requests = vec![];
            let mut folders = BTreeSet::new();
            if let Some(items) = value.get("item").and_then(|v| v.as_array()) {
                import_postman_items(items, "", &mut requests, &mut folders);
            }
            CollectionRecord {
                name: value
                    .get("info")
                    .and_then(|v| v.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Postman Import")
                    .to_string(),
                folders: folders.into_iter().collect(),
                folder_settings: vec![],
                requests,
            }
        }
        "openapi3" => import_openapi_like(value, "openapi3"),
        "swagger2" => import_openapi_like(value, "swagger2"),
        "bruno" => import_bruno(value),
        _ => return Err("Unsupported collection format. Use Postman, OpenAPI 3, Swagger 2, or Bruno.".to_string()),
    };

    Ok(ImportedCollectionResult {
        detected_format,
        collection,
    })
}

fn parse_collection_content(content: &str) -> Result<ImportedCollectionResult, String> {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(content) {
        return import_collection_value(&json);
    }

    let yaml = serde_yaml::from_str::<serde_yaml::Value>(content)
        .map_err(|_| "Unable to parse file as JSON or YAML.".to_string())?;
    let json_value = serde_json::to_value(yaml)
        .map_err(|e| format!("Unable to convert YAML value: {e}"))?;
    import_collection_value(&json_value)
}

fn request_to_postman_item(request: &RequestRecord) -> serde_json::Value {
    let mut body = serde_json::Map::new();
    let body_type = if request.body_type.trim().is_empty() { "none" } else { request.body_type.as_str() };
    if body_type == "json" || body_type == "text" || body_type == "xml" || body_type == "yaml" || body_type == "graphql" {
        body.insert("mode".to_string(), serde_json::Value::String("raw".to_string()));
        let raw = match &request.body {
            RequestTextOrJson::Text(text) => text.clone(),
            RequestTextOrJson::Json(json) => serde_json::to_string_pretty(json).unwrap_or_default(),
        };
        body.insert("raw".to_string(), serde_json::Value::String(raw));
    }

    let header = request
        .headers
        .iter()
        .filter(|h| h.enabled && !h.key.trim().is_empty())
        .map(|h| serde_json::json!({ "key": h.key, "value": h.value }))
        .collect::<Vec<_>>();

    serde_json::json!({
        "name": request.name,
        "request": {
            "method": request.method,
            "header": header,
            "url": request.url,
            "body": serde_json::Value::Object(body),
        }
    })
}

#[derive(Default)]
struct ExportFolderNode<'a> {
    requests: Vec<&'a RequestRecord>,
    children: BTreeMap<String, ExportFolderNode<'a>>,
}

fn build_export_folder_tree<'a>(requests: &'a [RequestRecord]) -> ExportFolderNode<'a> {
    fn normalize_folder_segments(path: &str) -> Vec<String> {
        path
            .split('/')
            .map(|segment| segment.trim())
            .filter(|segment| !segment.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>()
    }

    let mut root = ExportFolderNode::default();
    for request in requests {
        let mut cursor = &mut root;
        let segments = normalize_folder_segments(&request.folder_path);
        for segment in segments {
            cursor = cursor.children.entry(segment).or_default();
        }
        cursor.requests.push(request);
    }

    root
}

fn postman_items_from_tree(node: &ExportFolderNode) -> Vec<serde_json::Value> {
    let mut items = vec![];

    for (folder_name, child) in &node.children {
        items.push(serde_json::json!({
            "name": folder_name,
            "item": postman_items_from_tree(child),
        }));
    }

    for request in &node.requests {
        items.push(request_to_postman_item(request));
    }

    items
}

fn requests_to_openapi_doc(requests: &[RequestRecord], title: &str, version: &str, openapi_version: &str) -> serde_json::Value {
    let mut paths = serde_json::Map::new();
    for request in requests {
        let method = request.method.to_lowercase();
        let path_key = if request.url.trim().is_empty() { "/".to_string() } else { request.url.clone() };
        let entry = paths
            .entry(path_key)
            .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
        if let Some(obj) = entry.as_object_mut() {
            obj.insert(
                method,
                serde_json::json!({
                    "summary": request.name,
                    "responses": {
                        "200": { "description": "OK" }
                    }
                }),
            );
        }
    }

    if openapi_version == "2.0" {
        serde_json::json!({
            "swagger": "2.0",
            "info": { "title": title, "version": version },
            "paths": paths,
        })
    } else {
        serde_json::json!({
            "openapi": openapi_version,
            "info": { "title": title, "version": version },
            "paths": paths,
        })
    }
}

fn request_body_as_text(request: &RequestRecord) -> String {
    match &request.body {
        RequestTextOrJson::Text(text) => text.clone(),
        RequestTextOrJson::Json(json) => serde_json::to_string_pretty(json).unwrap_or_default(),
    }
}

fn default_open_collection_item_settings() -> serde_json::Value {
    serde_json::json!({
        "encodeUrl": true,
        "timeout": 0,
        "followRedirects": true,
        "maxRedirects": 5,
    })
}

fn request_to_open_collection_item(request: &RequestRecord, seq: usize) -> serde_json::Value {
    let body_text = request_body_as_text(request);
    let is_graphql = request.body_type == "graphql";

    if is_graphql {
        return serde_json::json!({
            "info": {
                "name": request.name,
                "type": "graphql",
                "seq": seq,
            },
            "graphql": {
                "url": request.url,
                "method": if request.method.trim().is_empty() { "POST" } else { request.method.as_str() },
                "body": {
                    "query": body_text,
                    "variables": "",
                },
                "auth": "inherit",
            },
            "settings": default_open_collection_item_settings(),
        });
    }

    let http_body = if body_text.trim().is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::json!({
            "type": if request.body_type == "json" { "json" } else { "text" },
            "data": body_text,
        })
    };

    let mut http = serde_json::Map::new();
    http.insert("method".to_string(), serde_json::Value::String(if request.method.trim().is_empty() { "GET".to_string() } else { request.method.clone() }));
    http.insert("url".to_string(), serde_json::Value::String(request.url.clone()));
    http.insert("auth".to_string(), serde_json::Value::String("inherit".to_string()));
    if !http_body.is_null() {
        http.insert("body".to_string(), http_body);
    }

    serde_json::json!({
        "info": {
            "name": request.name,
            "type": "http",
            "seq": seq,
        },
        "http": serde_json::Value::Object(http),
        "settings": default_open_collection_item_settings(),
    })
}

fn open_collection_items_from_tree(node: &ExportFolderNode, seq: &mut usize) -> Vec<serde_json::Value> {
    let mut items = vec![];

    for (folder_name, child) in &node.children {
        let folder_seq = *seq;
        *seq += 1;
        items.push(serde_json::json!({
            "info": {
                "name": folder_name,
                "type": "folder",
                "seq": folder_seq,
            },
            "request": {
                "auth": "inherit",
            },
            "items": open_collection_items_from_tree(child, seq),
        }));
    }

    for request in &node.requests {
        let request_seq = *seq;
        *seq += 1;
        items.push(request_to_open_collection_item(request, request_seq));
    }

    items
}

fn requests_to_bruno_doc(requests: &[RequestRecord], name: &str) -> serde_json::Value {
    let tree = build_export_folder_tree(requests);
    let mut seq = 1usize;
    let items = open_collection_items_from_tree(&tree, &mut seq);

    serde_json::json!({
        "opencollection": "1.0.0",
        "info": {
            "name": name
        },
        "config": {
            "proxy": {
                "inherit": true,
                "config": {
                    "protocol": "http",
                    "hostname": "",
                    "port": "",
                    "auth": {
                        "username": "",
                        "password": ""
                    },
                    "bypassProxy": ""
                }
            }
        },
        "items": items,
        "request": {
            "auth": "inherit"
        },
        "bundled": true,
        "extensions": {
            "bruno": {
                "ignore": ["node_modules", ".git"],
                "exportedUsing": "Kivo"
            }
        }
    })
}

fn serialize_export_value(format: &str, value: &serde_json::Value) -> Result<String, String> {
    if format == "bruno" || format.ends_with("yaml") || format.ends_with("yml") {
        return serde_yaml::to_string(value).map_err(|e| format!("Failed to serialize YAML: {e}"));
    }
    serde_json::to_string_pretty(value).map_err(|e| format!("Failed to serialize JSON: {e}"))
}

fn normalize_export_format(format: &str) -> String {
    match format.trim().to_lowercase().as_str() {
        "openapi3" | "openapi3.0" | "openapi" => "openapi3.0".to_string(),
        "swagger2" | "swagger2.0" | "swagger" => "swagger2.0".to_string(),
        "postman" => "postman".to_string(),
        "bruno" | "bruno-yml" | "bruno.yml" | "yml" | "yaml" => "bruno".to_string(),
        other => other.to_string(),
    }
}

fn build_export_value(format: &str, name: &str, requests: &[RequestRecord]) -> Result<serde_json::Value, String> {
    let normalized = normalize_export_format(format);
    match normalized.as_str() {
        "postman" => Ok(serde_json::json!({
            "info": {
                "name": name,
                "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
            },
            "item": postman_items_from_tree(&build_export_folder_tree(requests))
        })),
        "openapi3.0" => Ok(requests_to_openapi_doc(requests, name, "1.0.0", "3.0.0")),
        "swagger2.0" => Ok(requests_to_openapi_doc(requests, name, "1.0.0", "2.0")),
        "bruno" => Ok(requests_to_bruno_doc(requests, name)),
        _ => Err("Unsupported export format. Use postman, openapi3.0, swagger2.0, or bruno.".to_string()),
    }
}

fn default_inherit_auth_record() -> AuthRecord {
    AuthRecord {
        auth_type: "inherit".to_string(),
        token: String::new(),
        username: String::new(),
        password: String::new(),
        api_key_name: String::new(),
        api_key_value: String::new(),
        api_key_in: "header".to_string(),
        oauth2: OAuthConfig::default(),
    }
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

fn is_reserved_collection_json(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map_or(false, |name| {
            name == COLLECTION_CONFIG_FILE_NAME || name == COLLECTION_STATE_FILE_NAME
        })
}

fn collection_subdir_path(collection_path: &Path, folder_path: &str) -> PathBuf {
    let mut path = collection_path.to_path_buf();
    for segment in folder_path.split(['/', '\\']) {
        let trimmed = segment.trim();
        if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
            continue;
        }
        let safe_segment = sanitize_name(trimmed);
        if safe_segment.is_empty() {
            continue;
        }
        path.push(safe_segment);
    }
    path
}

fn collect_request_json_files(collection_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut stack = vec![collection_path.to_path_buf()];

    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(&current)
            .map_err(|e| format!("Failed to read collection directory: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read request entry: {e}"))?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }

            if path.is_file()
                && path.extension().map_or(false, |ext| ext == "json")
                && !is_reserved_collection_json(&path)
            {
                files.push(path);
            }
        }
    }

    Ok(files)
}

fn cleanup_empty_collection_dirs(collection_path: &Path) -> Result<(), String> {
    let mut dirs = Vec::new();
    let mut stack = vec![collection_path.to_path_buf()];

    while let Some(current) = stack.pop() {
        let entries = fs::read_dir(&current)
            .map_err(|e| format!("Failed to read collection directory: {e}"))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
            let path = entry.path();
            if path.is_dir() {
                dirs.push(path.clone());
                stack.push(path);
            }
        }
    }

    dirs.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for dir in dirs {
        if fs::read_dir(&dir).map_err(|e| format!("Failed to read directory: {e}"))?.next().is_none() {
            let _ = fs::remove_dir(&dir);
        }
    }

    Ok(())
}

fn infer_folder_path_from_location(collection_path: &Path, request_path: &Path) -> String {
    let parent = match request_path.parent() {
        Some(parent) => parent,
        None => return String::new(),
    };

    let relative = match parent.strip_prefix(collection_path) {
        Ok(relative) => relative,
        Err(_) => return String::new(),
    };

    let mut segments = Vec::new();
    for component in relative.components() {
        if let Component::Normal(segment) = component {
            segments.push(segment.to_string_lossy().to_string());
        }
    }

    segments.join("/")
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folders: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folder_settings: Vec<FolderSettingsRecord>,
    pub requests: Vec<RequestRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSettingsRecord {
    pub path: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub default_headers: Vec<KeyValueRow>,
    #[serde(default = "default_inherit_auth_record")]
    pub default_auth: AuthRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CollectionStateFile {
    #[serde(default)]
    folders: Vec<String>,
    #[serde(default)]
    folder_settings: Vec<FolderSettingsRecord>,
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub folder_path: String,
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
            for req_path in collect_request_json_files(&col_path)? {
                let req_json = fs::read_to_string(&req_path)
                    .map_err(|e| format!("Failed to read request file: {e}"))?;
                match serde_json::from_str::<RequestRecord>(&req_json) {
                    Ok(mut request) => {
                        if request.folder_path.trim().is_empty() {
                            request.folder_path = infer_folder_path_from_location(&col_path, &req_path);
                        }
                        requests.push(request);
                    }
                    Err(e) => eprintln!("Skipping malformed request file {:?}: {e}", req_path),
                }
            }
            let collection_state = {
                let state_path = col_path.join(COLLECTION_STATE_FILE_NAME);
                if state_path.exists() {
                    fs::read_to_string(&state_path)
                        .ok()
                        .and_then(|json| serde_json::from_str::<CollectionStateFile>(&json).ok())
                        .unwrap_or_default()
                } else {
                    CollectionStateFile::default()
                }
            };

            collections.push(CollectionRecord {
                name: col_meta.name,
                folders: collection_state.folders,
                folder_settings: collection_state.folder_settings,
                requests,
            });
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
            for req_path in collect_request_json_files(&col_path)? {
                let _ = fs::remove_file(req_path);
            }
            cleanup_empty_collection_dirs(&col_path)?;

            for folder_path in &collection.folders {
                let dir_path = collection_subdir_path(&col_path, folder_path);
                if !dir_path.exists() {
                    fs::create_dir_all(&dir_path)
                        .map_err(|e| format!("Failed to create folder directory: {e}"))?;
                }
            }

            for request in &collection.requests {
                let safe_req = sanitize_name(&request.name);
                let req_dir = collection_subdir_path(&col_path, &request.folder_path);
                if !req_dir.exists() {
                    fs::create_dir_all(&req_dir)
                        .map_err(|e| format!("Failed to create request directory: {e}"))?;
                }
                let req_path = req_dir.join(format!("{}.json", safe_req));
                let req_json = serde_json::to_string_pretty(request)
                    .map_err(|e| format!("Failed to serialize request: {e}"))?;
                fs::write(req_path, req_json)
                    .map_err(|e| format!("Failed to write request file: {e}"))?;
            }

            let collection_state_json = serde_json::to_string_pretty(&CollectionStateFile {
                folders: collection.folders.clone(),
                folder_settings: collection.folder_settings.clone(),
            })
            .map_err(|e| format!("Failed to serialize collection state: {e}"))?;

            fs::write(col_path.join(COLLECTION_STATE_FILE_NAME), collection_state_json)
                .map_err(|e| format!("Failed to write collection state file: {e}"))?;

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
pub fn import_collection_file(file_path: String) -> Result<ImportedCollectionResult, String> {
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read import file: {e}"))?;
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
    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write export file: {e}"))
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
    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write export file: {e}"))
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

