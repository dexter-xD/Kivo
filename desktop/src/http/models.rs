use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OAuthParamRow {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub enabled: bool,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OAuthPayload {
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
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuthPayload {
    #[serde(default)]
    pub api_key_in: String,
    #[serde(default)]
    pub api_key_name: String,
    #[serde(default)]
    pub api_key_value: String,
    #[serde(default)]
    pub oauth2: Option<OAuthPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPayload {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    #[serde(default)]
    pub body_file_path: Option<String>,

    #[serde(default)]
    pub request_id: String,

    #[serde(default)]
    pub workspace_name: String,

    #[serde(default)]
    pub collection_name: String,

    #[serde(default)]
    pub auth_type: String,

    #[serde(default)]
    pub inherit_headers: Option<bool>,

    #[serde(default)]
    pub auth_payload: Option<AuthPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcRequestPayload {
    pub url: String,
    pub grpc_proto_file_path: String,
    pub grpc_method_path: String,
    #[serde(default)]
    pub grpc_streaming_mode: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub workspace_name: String,
    #[serde(default)]
    pub collection_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenExchangePayload {
    #[serde(default)]
    pub workspace_name: String,
    #[serde(default)]
    pub collection_name: String,
    #[serde(default)]
    pub request_id: String,
    pub oauth: OAuthPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenExchangeResult {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub scope: String,
    pub expires_in: Option<u64>,
    pub expires_at: String,
    pub raw: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponsePayload {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration_ms: u128,
}
