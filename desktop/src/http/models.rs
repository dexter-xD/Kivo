use std::collections::HashMap;
use crate::storage::AuthRecord;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPayload {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,

    #[serde(default)]
    pub workspace_name: String,

    #[serde(default)]
    pub collection_name: String,

    #[serde(default)]
    pub auth_type: String,

    #[serde(default)]
    pub auth: Option<AuthRecord>,

    #[serde(default)]
    pub inherit_headers: Option<bool>,
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

