use std::collections::HashMap;
use std::time::Instant;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, USER_AGENT};

use super::models::{RequestPayload, ResponsePayload};

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
        header_map.insert(USER_AGENT, HeaderValue::from_static("kivo/0.1"));
    }

    Ok(header_map)
}

#[tauri::command]
pub async fn send_http_request(payload: RequestPayload) -> Result<ResponsePayload, String> {
    let url = normalize_url(&payload.url)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|err| err.to_string())?;
    let method_str = payload.method.to_uppercase();
    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|_| format!("Unsupported HTTP method: {}", payload.method))?;

    let mut request = client
        .request(method.clone(), &url)
        .headers(build_headers(&payload.headers)?);

    if let Some(body) = payload.body {
        if !body.trim().is_empty() {
            request = request.body(body);
        }
    }

    let started_at = Instant::now();
    let response = request.send().await.map_err(|err| err.to_string())?;
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
