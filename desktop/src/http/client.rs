use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use bytes::Buf;
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage, MethodDescriptor, ReflectMessage};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::watch;
use tokio::time::timeout;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::transport::Endpoint;
use tonic::{Request, Status};

use super::models::{
    GrpcRequestPayload, OAuthTokenExchangePayload, OAuthTokenExchangeResult, RequestPayload,
    ResponsePayload,
};
use crate::storage::{get_collection_dir, get_storage_root, load_collection_config_from_path, load_env_vars};

#[derive(Clone)]
struct DynamicCodec {
    input: prost_reflect::MessageDescriptor,
    output: prost_reflect::MessageDescriptor,
}

impl DynamicCodec {
    fn new(input: prost_reflect::MessageDescriptor, output: prost_reflect::MessageDescriptor) -> Self {
        Self { input, output }
    }
}

struct DynamicEncoder {
    descriptor: prost_reflect::MessageDescriptor,
}

struct DynamicDecoder {
    descriptor: prost_reflect::MessageDescriptor,
}

impl Codec for DynamicCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicEncoder;
    type Decoder = DynamicDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicEncoder {
            descriptor: self.input.clone(),
        }
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicDecoder {
            descriptor: self.output.clone(),
        }
    }
}

impl Encoder for DynamicEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        if item.descriptor().full_name() != self.descriptor.full_name() {
            return Err(Status::invalid_argument("gRPC request body does not match selected method input type."));
        }

        item.encode(dst)
            .map_err(|err| Status::internal(format!("Failed to encode gRPC request payload: {err}")))
    }
}

impl Decoder for DynamicDecoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        if src.remaining() == 0 {
            return Ok(None);
        }

        let bytes = src.copy_to_bytes(src.remaining());
        let message = DynamicMessage::decode(self.descriptor.clone(), bytes)
            .map_err(|err| Status::internal(format!("Failed to decode gRPC response payload: {err}")))?;
        Ok(Some(message))
    }
}

static OAUTH_CANCEL_REGISTRY: OnceLock<Mutex<HashMap<String, watch::Sender<bool>>>> = OnceLock::new();
static HTTP_CANCEL_REGISTRY: OnceLock<Mutex<HashMap<String, watch::Sender<bool>>>> = OnceLock::new();

fn oauth_cancel_registry() -> &'static Mutex<HashMap<String, watch::Sender<bool>>> {
    OAUTH_CANCEL_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn http_cancel_registry() -> &'static Mutex<HashMap<String, watch::Sender<bool>>> {
    HTTP_CANCEL_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_oauth_cancel(request_id: &str) -> Option<watch::Receiver<bool>> {
    if request_id.trim().is_empty() {
        return None;
    }

    let (cancel_tx, cancel_rx) = watch::channel(false);
    let mut registry = oauth_cancel_registry().lock().unwrap();
    registry.insert(request_id.to_string(), cancel_tx);
    Some(cancel_rx)
}

fn unregister_oauth_cancel(request_id: &str) {
    if request_id.trim().is_empty() {
        return;
    }

    let mut registry = oauth_cancel_registry().lock().unwrap();
    registry.remove(request_id);
}

fn register_http_cancel(request_id: &str) -> Option<watch::Receiver<bool>> {
    if request_id.trim().is_empty() {
        return None;
    }

    let (cancel_tx, cancel_rx) = watch::channel(false);
    let mut registry = http_cancel_registry().lock().unwrap();
    registry.insert(request_id.to_string(), cancel_tx);
    Some(cancel_rx)
}

fn unregister_http_cancel(request_id: &str) {
    if request_id.trim().is_empty() {
        return;
    }

    let mut registry = http_cancel_registry().lock().unwrap();
    registry.remove(request_id);
}

struct OAuthCancelGuard {
    request_id: String,
}

struct HttpCancelGuard {
    request_id: String,
}

impl OAuthCancelGuard {
    fn new(request_id: String) -> Self {
        Self { request_id }
    }
}

impl HttpCancelGuard {
    fn new(request_id: String) -> Self {
        Self { request_id }
    }
}

impl Drop for HttpCancelGuard {
    fn drop(&mut self) {
        unregister_http_cancel(&self.request_id);
    }
}

impl Drop for OAuthCancelGuard {
    fn drop(&mut self) {
        unregister_oauth_cancel(&self.request_id);
    }
}

async fn send_oauth_form(
    request: reqwest::RequestBuilder,
    form: &[(String, String)],
    cancel_rx: &mut Option<watch::Receiver<bool>>,
    context: &str,
) -> Result<reqwest::Response, String> {
    if let Some(receiver) = cancel_rx.as_mut() {
        tokio::select! {
            changed = receiver.changed() => {
                match changed {
                    Ok(_) => {
                        if *receiver.borrow() {
                            return Err("OAuth token request cancelled by user.".to_string());
                        }
                        return Err("OAuth token request cancelled by user.".to_string());
                    }
                    Err(_) => {
                        return Err("OAuth token request cancelled by user.".to_string());
                    }
                }
            }
            response = request.form(form).send() => {
                response.map_err(|err| format!("{context}: {err}"))
            }
        }
    } else {
        request
            .form(form)
            .send()
            .await
            .map_err(|err| format!("{context}: {err}"))
    }
}

async fn send_http_request_with_cancel(
    request: reqwest::RequestBuilder,
    cancel_rx: &mut Option<watch::Receiver<bool>>,
) -> Result<reqwest::Response, String> {
    if let Some(receiver) = cancel_rx.as_mut() {
        tokio::select! {
            changed = receiver.changed() => {
                match changed {
                    Ok(_) => {
                        if *receiver.borrow() {
                            return Err("Request cancelled by user.".to_string());
                        }
                        return Err("Request cancelled by user.".to_string());
                    }
                    Err(_) => {
                        return Err("Request cancelled by user.".to_string());
                    }
                }
            }
            response = request.send() => {
                response.map_err(|err| err.to_string())
            }
        }
    } else {
        request.send().await.map_err(|err| err.to_string())
    }
}

#[tauri::command]
pub async fn cancel_oauth_exchange(request_id: String) -> Result<bool, String> {
    let trimmed = request_id.trim().to_string();
    if trimmed.is_empty() {
        return Ok(false);
    }

    let sender = {
        let mut registry = oauth_cancel_registry().lock().unwrap();
        registry.remove(&trimmed)
    };

    if let Some(cancel_tx) = sender {
        let _ = cancel_tx.send(true);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn cancel_http_request(request_id: String) -> Result<bool, String> {
    let trimmed = request_id.trim().to_string();
    if trimmed.is_empty() {
        return Ok(false);
    }

    let sender = {
        let mut registry = http_cancel_registry().lock().unwrap();
        registry.remove(&trimmed)
    };

    if let Some(cancel_tx) = sender {
        let _ = cancel_tx.send(true);
        Ok(true)
    } else {
        Ok(false)
    }
}

fn resolve_variables(input: &str, vars: &HashMap<String, String>) -> String {
    let mut result = input.to_string();
    for (key, value) in vars {
        let placeholder = format!("{{{{{}}}}}", key);
        result = result.replace(&placeholder, value);
    }
    result
}

fn normalize_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();

    if trimmed.is_empty() {
        return Err("Enter a URL first.".to_string());
    }

    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    reqwest::Url::parse(&candidate)
        .map(|url| url.to_string())
        .map_err(|_| format!("Invalid URL: {trimmed}"))
}

fn build_headers(headers: &HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut header_map = HeaderMap::new();

    for (key, value) in headers {
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|_| format!("Invalid header name: {key}"))?;
        let header_value =
            HeaderValue::from_str(value).map_err(|_| format!("Invalid header value for: {key}"))?;

        header_map.insert(name, header_value);
    }

    if !header_map.contains_key(USER_AGENT) {
        header_map.insert(USER_AGENT, HeaderValue::from_static("kivo/0.3"));
    }

    Ok(header_map)
}

fn get_env_context(app: &AppHandle, workspace_name: &str, collection_name: &str) -> HashMap<String, String> {
    let storage_root = get_storage_root(app).unwrap_or_default();
    let workspace_path = storage_root.join(workspace_name);
    let collection_path = if collection_name.is_empty() {
        None
    } else {
        Some(get_collection_dir(&storage_root, workspace_name, collection_name))
    };
    load_env_vars(&workspace_path, collection_path.as_deref())
}

fn resolve_payload_value(input: &str, env_vars: &HashMap<String, String>) -> String {
    resolve_variables(input, env_vars)
}

fn normalize_grpc_target(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Enter a gRPC server URL first.".to_string());
    }

    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };

    reqwest::Url::parse(&candidate)
        .map(|url| {
            let mut normalized = url.to_string();
            if normalized.ends_with('/') {
                normalized.pop();
            }
            normalized
        })
        .map_err(|_| format!("Invalid gRPC URL: {trimmed}"))
}

fn parse_grpc_method_parts(raw_path: &str) -> Result<(String, String), String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("Select a gRPC method first.".to_string());
    }

    let mut parts = trimmed.trim_start_matches('/').split('/');
    let service = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Invalid gRPC method path.".to_string())?;
    let method = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Invalid gRPC method path.".to_string())?;

    Ok((service.to_string(), method.to_string()))
}

fn compile_descriptor_pool(proto_file_path: &str) -> Result<DescriptorPool, String> {
    let proto_path = PathBuf::from(proto_file_path.trim());
    if !proto_path.exists() {
        return Err("Selected proto file does not exist.".to_string());
    }

    let include_dir = proto_path
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Failed to resolve proto parent directory.".to_string())?;

    let descriptor_set = protox::compile([proto_path], [include_dir])
        .map_err(|err| format!("Failed to compile proto descriptors: {err}"))?;

    DescriptorPool::from_file_descriptor_set(descriptor_set)
        .map_err(|err| format!("Failed to load descriptor pool: {err}"))
}

fn find_grpc_method_descriptor(
    pool: &DescriptorPool,
    requested_service: &str,
    requested_method: &str,
) -> Option<MethodDescriptor> {
    for service in pool.services() {
        let service_full = service.full_name();
        let service_short = service.name();
        let service_match = requested_service == service_full
            || requested_service == service_short
            || requested_service.ends_with(&format!(".{service_short}"));

        if !service_match {
            continue;
        }

        if let Some(method) = service
            .methods()
            .find(|method| method.name() == requested_method)
        {
            return Some(method);
        }
    }

    None
}

fn build_dynamic_request_message(
    descriptor: prost_reflect::MessageDescriptor,
    raw_body: Option<&str>,
) -> Result<DynamicMessage, String> {
    let body = raw_body.unwrap_or("{}").trim();
    let json_value = if body.is_empty() {
        Value::Object(serde_json::Map::new())
    } else {
        serde_json::from_str::<Value>(body)
            .map_err(|err| format!("Invalid JSON body for gRPC request: {err}"))?
    };

    let object_value = match json_value {
        Value::Object(map) => Value::Object(map),
        Value::Array(values) if !values.is_empty() => {
            match values.into_iter().next() {
                Some(Value::Object(map)) => Value::Object(map),
                _ => {
                    return Err(
                        "gRPC request body array must contain a JSON object as its first item."
                            .to_string(),
                    )
                }
            }
        }
        _ => {
            return Err("gRPC request body must be a JSON object for unary/server streaming calls."
                .to_string())
        }
    };

    let json_text = serde_json::to_string(&object_value)
        .map_err(|err| format!("Failed to serialize gRPC JSON body: {err}"))?;
    let mut deserializer = serde_json::Deserializer::from_str(&json_text);
    DynamicMessage::deserialize(descriptor, &mut deserializer)
        .map_err(|err| format!("Failed to map JSON body to proto message: {err}"))
}

#[tauri::command]
pub async fn send_grpc_request(
    app: AppHandle,
    payload: GrpcRequestPayload,
) -> Result<ResponsePayload, String> {
    let env_vars = get_env_context(&app, &payload.workspace_name, &payload.collection_name);

    let target = normalize_grpc_target(&resolve_payload_value(&payload.url, &env_vars))?;
    let proto_path = resolve_payload_value(&payload.grpc_proto_file_path, &env_vars);
    let (requested_service, requested_method) = parse_grpc_method_parts(&payload.grpc_method_path)?;
    let streaming_mode = payload.grpc_streaming_mode.trim().to_string();

    if streaming_mode == "client_stream" || streaming_mode == "bidi" {
        return Err("Client streaming and bidirectional streaming are not supported yet.".to_string());
    }

    let descriptor_pool = compile_descriptor_pool(&proto_path)?;
    let method_descriptor = find_grpc_method_descriptor(&descriptor_pool, &requested_service, &requested_method)
        .ok_or_else(|| {
            format!(
                "Method {}/{} was not found in selected proto descriptors.",
                requested_service, requested_method
            )
        })?;

    let path = format!(
        "/{}/{}",
        method_descriptor.parent_service().full_name(),
        method_descriptor.name()
    );
    let path_and_query = tonic::codegen::http::uri::PathAndQuery::from_str(&path)
        .map_err(|err| format!("Invalid gRPC method path: {err}"))?;

    let mut endpoint = Endpoint::from_shared(target.clone())
        .map_err(|err| format!("Invalid gRPC endpoint: {err}"))?;
    endpoint = endpoint.connect_timeout(Duration::from_secs(10));
    endpoint = endpoint.timeout(Duration::from_secs(45));

    let channel = endpoint
        .connect()
        .await
        .map_err(|err| format!("Failed to connect to gRPC server: {err}"))?;

    let request_body = payload
        .body
        .as_ref()
        .map(|body| resolve_payload_value(body, &env_vars));
    let request_message = build_dynamic_request_message(method_descriptor.input(), request_body.as_deref())?;

    let mut request = Request::new(request_message);
    for (key, value) in &payload.headers {
        let normalized_key = resolve_payload_value(key, &env_vars);
        let normalized_value = resolve_payload_value(value, &env_vars);
        if normalized_key.trim().is_empty() {
            continue;
        }
        let lower = normalized_key.to_ascii_lowercase();
        if lower == "content-type" || lower == "te" || lower == "host" {
            continue;
        }

        if let Ok(metadata_key) = tonic::metadata::MetadataKey::from_bytes(lower.as_bytes()) {
            if let Ok(metadata_value) = tonic::metadata::MetadataValue::try_from(normalized_value.as_str()) {
                request.metadata_mut().insert(metadata_key, metadata_value);
            }
        }
    }

    let started_at = Instant::now();
    let mut grpc = tonic::client::Grpc::new(channel);
    let codec = DynamicCodec::new(method_descriptor.input(), method_descriptor.output());

    timeout(Duration::from_secs(10), grpc.ready())
        .await
        .map_err(|_| "gRPC client timed out while waiting to become ready.".to_string())?
        .map_err(|err| format!("gRPC client not ready: {err}"))?;

    let (body, headers, status_code, status_text) = if method_descriptor.is_server_streaming() {
        let response = timeout(
            Duration::from_secs(20),
            grpc.server_streaming(request, path_and_query, codec),
        )
        .await
        .map_err(|_| "gRPC request timed out while starting server stream.".to_string())?
        .map_err(|status| {
            format!(
                "gRPC request failed ({}): {}",
                status.code(),
                status.message()
            )
        })?;

        let mut stream = response.into_inner();
        let mut values = Vec::new();
        loop {
            let next_item = timeout(Duration::from_secs(20), stream.message())
                .await
                .map_err(|_| "Timed out while waiting for gRPC stream message.".to_string())?
                .map_err(|status| {
                    format!(
                        "Failed while reading gRPC stream ({}): {}",
                        status.code(),
                        status.message()
                    )
                })?;

            let Some(message) = next_item else {
                break;
            };

            values.push(
                serde_json::to_value(&message)
                    .map_err(|err| format!("Failed to encode stream message as JSON: {err}"))?,
            );
        }

        let stream_body = serde_json::to_string_pretty(&values)
            .map_err(|err| format!("Failed to serialize gRPC stream response: {err}"))?;
        let mut response_headers = HashMap::new();
        response_headers.insert("content-type".to_string(), "application/json".to_string());
        response_headers.insert("x-kivo-grpc-mode".to_string(), "server_stream".to_string());

        (stream_body, response_headers, 200, "OK".to_string())
    } else {
        let response = timeout(Duration::from_secs(20), grpc.unary(request, path_and_query, codec))
            .await
            .map_err(|_| "gRPC unary request timed out.".to_string())?
            .map_err(|status| {
                format!(
                    "gRPC request failed ({}): {}",
                    status.code(),
                    status.message()
                )
            })?;

        let message = response.into_inner();
        let value = serde_json::to_value(&message)
            .map_err(|err| format!("Failed to encode gRPC response as JSON: {err}"))?;
        let unary_body = serde_json::to_string_pretty(&value)
            .map_err(|err| format!("Failed to serialize gRPC response: {err}"))?;

        let mut response_headers = HashMap::new();
        response_headers.insert("content-type".to_string(), "application/json".to_string());
        response_headers.insert("x-kivo-grpc-mode".to_string(), "unary".to_string());

        (unary_body, response_headers, 200, "OK".to_string())
    };

    Ok(ResponsePayload {
        status: status_code,
        status_text,
        headers,
        body,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

fn get_expiry_iso(expires_in: Option<u64>) -> String {
    expires_in
        .map(|seconds| {
            let expiry = chrono::Utc::now() + chrono::Duration::seconds(seconds as i64);
            expiry.to_rfc3339()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub async fn oauth_exchange_token(
    app: AppHandle,
    payload: OAuthTokenExchangePayload,
) -> Result<OAuthTokenExchangeResult, String> {
    let request_id = payload.request_id.trim().to_string();
    let _cancel_guard = OAuthCancelGuard::new(request_id.clone());
    let mut cancel_rx = register_oauth_cancel(&request_id);

    let env_vars = get_env_context(&app, &payload.workspace_name, &payload.collection_name);
    let oauth = payload.oauth;

    let token_url = normalize_url(&resolve_payload_value(&oauth.token_url, &env_vars))?;
    let grant_type = if oauth.grant_type.trim().is_empty() {
        "authorization_code".to_string()
    } else {
        oauth.grant_type.trim().to_string()
    };

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|err| err.to_string())?;

    let client_id = resolve_payload_value(&oauth.client_id, &env_vars);
    let client_secret = resolve_payload_value(&oauth.client_secret, &env_vars);
    let callback_url = resolve_payload_value(&oauth.callback_url, &env_vars);
    let authorization_code = resolve_payload_value(&oauth.authorization_code, &env_vars);
    let refresh_token = resolve_payload_value(&oauth.refresh_token, &env_vars);
    let username = resolve_payload_value(&oauth.username, &env_vars);
    let password = resolve_payload_value(&oauth.password, &env_vars);
    let scope = resolve_payload_value(&oauth.scope, &env_vars);
    let audience = resolve_payload_value(&oauth.audience, &env_vars);
    let resource = resolve_payload_value(&oauth.resource, &env_vars);
    let code_verifier = resolve_payload_value(&oauth.code_verifier, &env_vars);
    let client_auth_method = if oauth.client_auth_method.trim().is_empty() {
        "basic".to_string()
    } else {
        oauth.client_auth_method.trim().to_string()
    };

    let mut form: Vec<(String, String)> = vec![("grant_type".to_string(), grant_type.clone())];

    match grant_type.as_str() {
        "authorization_code" => {
            if authorization_code.trim().is_empty() {
                return Err("Authorization code is missing.".to_string());
            }
            form.push(("code".to_string(), authorization_code));
            if !callback_url.trim().is_empty() {
                form.push(("redirect_uri".to_string(), callback_url));
            }
            if !code_verifier.trim().is_empty() {
                form.push(("code_verifier".to_string(), code_verifier));
            }
        }
        "client_credentials" => {}
        "password" => {
            if username.trim().is_empty() || password.trim().is_empty() {
                return Err("Username and password are required for password grant.".to_string());
            }
            form.push(("username".to_string(), username));
            form.push(("password".to_string(), password));
        }
        "refresh_token" => {
            if refresh_token.trim().is_empty() {
                return Err("Refresh token is missing.".to_string());
            }
            form.push(("refresh_token".to_string(), refresh_token));
        }
        _ => return Err(format!("Unsupported OAuth grant type: {}", grant_type)),
    }

    if !scope.trim().is_empty() {
        form.push(("scope".to_string(), scope));
    }
    if !audience.trim().is_empty() {
        form.push(("audience".to_string(), audience));
    }
    if !resource.trim().is_empty() {
        form.push(("resource".to_string(), resource));
    }

    for row in oauth.extra_token_params {
        if row.enabled && !row.key.trim().is_empty() {
            form.push((
                resolve_payload_value(row.key.trim(), &env_vars),
                resolve_payload_value(&row.value, &env_vars),
            ));
        }
    }

    let can_use_basic = !client_id.trim().is_empty();
    let mut use_basic_auth = client_auth_method == "basic" && can_use_basic;

    let mut request_form = form.clone();
    if !use_basic_auth {
        if !client_id.trim().is_empty() {
            request_form.push(("client_id".to_string(), client_id.clone()));
        }
        if !client_secret.trim().is_empty() {
            request_form.push(("client_secret".to_string(), client_secret.clone()));
        }
    }

    let mut request = client
        .post(&token_url)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "kivo/0.3")
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded");

    if use_basic_auth {
        let encoded = BASE64_STANDARD.encode(format!("{}:{}", client_id, client_secret));
        request = request.header(AUTHORIZATION, format!("Basic {}", encoded));
    }

    let mut response = send_oauth_form(
        request,
        &request_form,
        &mut cancel_rx,
        "OAuth token request failed",
    ).await?;

    let mut status = response.status();
    let mut text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read OAuth response: {err}"))?;
    let mut raw_json: Value = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text.clone()));

    let should_retry_with_alternate = !status.is_success()
        && status.as_u16() == 401
        && raw_json
            .get("error")
            .and_then(|value| value.as_str())
            .map(|value| value == "invalid_client")
            .unwrap_or(false)
        && can_use_basic;

    if should_retry_with_alternate {
        use_basic_auth = !use_basic_auth;
        let mut retry_form = form.clone();
        if !use_basic_auth {
            if !client_id.trim().is_empty() {
                retry_form.push(("client_id".to_string(), client_id.clone()));
            }
            if !client_secret.trim().is_empty() {
                retry_form.push(("client_secret".to_string(), client_secret.clone()));
            }
        }

        let mut retry_request = client
            .post(&token_url)
            .header(ACCEPT, "application/json")
            .header(USER_AGENT, "kivo/0.3")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded");

        if use_basic_auth {
            let encoded = BASE64_STANDARD.encode(format!("{}:{}", client_id, client_secret));
            retry_request = retry_request.header(AUTHORIZATION, format!("Basic {}", encoded));
        }

        response = send_oauth_form(
            retry_request,
            &retry_form,
            &mut cancel_rx,
            "OAuth token retry failed",
        ).await?;

        status = response.status();
        text = response
            .text()
            .await
            .map_err(|err| format!("Failed to read OAuth retry response: {err}"))?;
        raw_json = serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text.clone()));
    }

    if !status.is_success() {
        let description = raw_json
            .get("error_description")
            .and_then(|value| value.as_str())
            .or_else(|| raw_json.get("error").and_then(|value| value.as_str()))
            .unwrap_or(&text);
        return Err(format!("OAuth token request failed ({}): {}", status.as_u16(), description));
    }

    let access_token = raw_json
        .get("access_token")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let refresh_token = raw_json
        .get("refresh_token")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let token_type = raw_json
        .get("token_type")
        .and_then(|value| value.as_str())
        .unwrap_or("Bearer")
        .to_string();
    let scope = raw_json
        .get("scope")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let expires_in = raw_json.get("expires_in").and_then(|value| value.as_u64());
    let expires_at = get_expiry_iso(expires_in);

    Ok(OAuthTokenExchangeResult {
        access_token,
        refresh_token,
        token_type,
        scope,
        expires_in,
        expires_at,
        raw: raw_json,
    })
}

#[tauri::command]
pub async fn send_http_request(
    app: AppHandle,
    payload: RequestPayload,
) -> Result<ResponsePayload, String> {
    let request_id = payload.request_id.trim().to_string();
    let _cancel_guard = HttpCancelGuard::new(request_id.clone());
    let mut cancel_rx = register_http_cancel(&request_id);

    let storage_root = get_storage_root(&app).unwrap_or_default();
    let workspace_path = storage_root.join(&payload.workspace_name);
    let collection_path = if payload.collection_name.is_empty() {
        None
    } else {
        Some(
            get_collection_dir(&storage_root, &payload.workspace_name, &payload.collection_name),
        )
    };

    let env_vars = load_env_vars(&workspace_path, collection_path.as_deref());

    let col_config = collection_path
        .as_deref()
        .map(load_collection_config_from_path)
        .unwrap_or_default();

    let mut merged_headers: HashMap<String, String> = HashMap::new();

    if payload.inherit_headers.unwrap_or(true) {
        merged_headers = col_config
            .default_headers
            .iter()
            .filter(|row| row.enabled && !row.key.trim().is_empty())
            .map(|row| {
                (
                    resolve_variables(row.key.trim(), &env_vars),
                    resolve_variables(&row.value, &env_vars),
                )
            })
            .collect();
    }

    for (k, v) in &payload.headers {
        merged_headers.insert(
            resolve_variables(k, &env_vars),
            resolve_variables(v, &env_vars),
        );
    }

    let has_auth_header = merged_headers
        .keys()
        .any(|k| k.to_lowercase() == "authorization");

    if payload.auth_type == "inherit" && !has_auth_header {
        let auth = &col_config.default_auth;
        match auth.auth_type.as_str() {
            "bearer" if !auth.token.is_empty() => {
                let resolved = resolve_variables(&auth.token, &env_vars);
                merged_headers.insert(
                    "Authorization".to_string(),
                    format!("Bearer {}", resolved),
                );
            }
            "basic" if !auth.username.is_empty() || !auth.password.is_empty() => {
                let u = resolve_variables(&auth.username, &env_vars);
                let p = resolve_variables(&auth.password, &env_vars);
                let encoded = BASE64_STANDARD.encode(format!("{}:{}", u, p));
                merged_headers.insert(
                    "Authorization".to_string(),
                    format!("Basic {}", encoded),
                );
            }
            "apikey" if !auth.api_key_name.is_empty() => {
                let name = resolve_variables(&auth.api_key_name, &env_vars);
                let value = resolve_variables(&auth.api_key_value, &env_vars);
                if auth.api_key_in != "query" {
                    merged_headers.insert(name, value);
                }
            }
            "oauth2" if !auth.oauth2.access_token.is_empty() => {
                let token_type = if auth.oauth2.token_type.trim().is_empty() {
                    "Bearer".to_string()
                } else {
                    resolve_variables(&auth.oauth2.token_type, &env_vars)
                };
                let token = resolve_variables(&auth.oauth2.access_token, &env_vars);
                merged_headers.insert(
                    "Authorization".to_string(),
                    format!("{} {}", token_type, token),
                );
            }
            _ => {}
        }
    }

    let resolved_url = resolve_variables(&payload.url, &env_vars);
    let resolved_body = payload
        .body
        .as_deref()
        .map(|b| resolve_variables(b, &env_vars));
    let resolved_body_file_path = payload
        .body_file_path
        .as_deref()
        .map(|path| resolve_variables(path, &env_vars));

    let mut url = normalize_url(&resolved_url)?;

    let should_inject_apikey_query = if payload.auth_type == "inherit" {
        col_config.default_auth.auth_type == "apikey"
            && col_config.default_auth.api_key_in == "query"
            && !col_config.default_auth.api_key_name.is_empty()
    } else {
        false
    };

    if should_inject_apikey_query {
        let name = resolve_variables(&col_config.default_auth.api_key_name, &env_vars);
        let value = resolve_variables(&col_config.default_auth.api_key_value, &env_vars);
        if let Ok(mut parsed) = reqwest::Url::parse(&url) {
            parsed.query_pairs_mut().append_pair(&name, &value);
            url = parsed.to_string();
        }
    }

    if payload.auth_type == "apikey" {
        if let Some(ref ap) = payload.auth_payload {
            if ap.api_key_in == "query" && !ap.api_key_name.is_empty() {
                let name = resolve_variables(&ap.api_key_name, &env_vars);
                let value = resolve_variables(&ap.api_key_value, &env_vars);
                if let Ok(mut parsed) = reqwest::Url::parse(&url) {
                    let already_has = parsed.query_pairs().any(|(k, _)| k == name);
                    if !already_has {
                        parsed.query_pairs_mut().append_pair(&name, &value);
                        url = parsed.to_string();
                    }
                }
            }
        }
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|err| err.to_string())?;

    let method_str = payload.method.to_uppercase();
    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|_| format!("Unsupported HTTP method: {}", payload.method))?;

    let mut request = client
        .request(method.clone(), &url)
        .headers(build_headers(&merged_headers)?);

    if let Some(path) = resolved_body_file_path {
        if !path.trim().is_empty() {
            let bytes = fs::read(&path).map_err(|err| format!("Failed to read body file: {err}"))?;
            request = request.body(bytes);
        }
    } else if let Some(body) = resolved_body {
        if !body.trim().is_empty() {
            request = request.body(body);
        }
    }

    let started_at = Instant::now();
    let response = send_http_request_with_cancel(request, &mut cancel_rx).await?;
    let duration_ms = started_at.elapsed().as_millis();

    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("Unknown").to_string();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.to_string(),
                value.to_str().unwrap_or("<binary>").to_string(),
            )
        })
        .collect::<HashMap<_, _>>();
    let body = response.text().await.map_err(|err| err.to_string())?;

    Ok(ResponsePayload {
        status: status.as_u16(),
        status_text,
        headers,
        body,
        duration_ms,
    })
}
