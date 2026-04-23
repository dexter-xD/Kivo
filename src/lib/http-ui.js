import { normalizeAuthState } from "@/lib/oauth.js";

const methodTones = {
  GET: "tone-get-text tone-get-bg",
  POST: "tone-post-text tone-post-bg",
  PUT: "tone-put-text tone-put-bg",
  PATCH: "tone-patch-text tone-patch-bg",
  DELETE: "tone-delete-text tone-delete-bg",
  HEAD: "tone-get-text tone-get-bg",
  OPTIONS: "tone-put-text tone-put-bg"
};

const bodyContentTypes = {
  json: "application/json",
  "form-urlencoded": "application/x-www-form-urlencoded",
  graphql: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  text: "text/plain",
  file: "application/octet-stream"
};

export const codegenLanguageOptions = [
  { value: "shell", label: "Shell" },
  { value: "javascript", label: "JavaScript" },
  { value: "nodejs", label: "Node.js" },
  { value: "python", label: "Python" },
  { value: "powershell", label: "PowerShell" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "csharp", label: "C#" },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby" },
  { value: "swift", label: "Swift" },
  { value: "c", label: "C" }
];

export function getMethodTone(method) {
  return methodTones[method] ?? "tone-default-text tone-default-bg";
}

export function normalizeUrl(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function isBodyAllowed(method, bodyType) {
  if (bodyType === "none") {
    return false;
  }

  return true;
}

export function getDefaultContentType(bodyType) {
  return bodyContentTypes[bodyType] ?? "";
}

function hasHeader(headers, name) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function getEnabledRows(rows = []) {
  return rows.filter((row) => row?.enabled && String(row.key || "").trim());
}

function serializeBodyByType(request, method, resolveValue = (value) => String(value ?? "")) {
  const bodyType = request?.bodyType ?? "json";

  if (!isBodyAllowed(method, bodyType)) {
    return { body: "", contentType: "" };
  }

  if (bodyType === "form-urlencoded") {
    const params = new URLSearchParams();
    getEnabledRows(request?.bodyRows).forEach((row) => {
      params.append(resolveValue(row.key).trim(), resolveValue(row.value));
    });

    return {
      body: params.toString(),
      contentType: getDefaultContentType(bodyType)
    };
  }

  if (bodyType === "form-data") {
    const boundary = `----KivoBoundary${Math.random().toString(16).slice(2)}`;
    const body = getEnabledRows(request?.bodyRows)
      .map((row) => [
        `--${boundary}`,
        `Content-Disposition: form-data; name="${resolveValue(row.key).trim().replace(/"/g, '\\"')}"`,
        "",
        resolveValue(row.value)
      ].join("\r\n"))
      .concat(`--${boundary}--`)
      .join("\r\n");

    return {
      body,
      contentType: `multipart/form-data; boundary=${boundary}`
    };
  }

  if (bodyType === "graphql") {
    let variables = {};

    try {
      const parsed = JSON.parse(resolveValue(request?.graphqlVariables || "{}"));
      variables = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      variables = {};
    }

    return {
      body: JSON.stringify({
        query: resolveValue(request?.body || ""),
        variables
      }),
      contentType: getDefaultContentType(bodyType)
    };
  }

  if (bodyType === "file") {
    return {
      body: "",
      contentType: getDefaultContentType(bodyType)
    };
  }

  return {
    body: resolveValue(request?.body || ""),
    contentType: getDefaultContentType(bodyType)
  };
}

export function serializeHeaders(rows = [], auth = { type: "none", token: "" }, bodyType = "json", explicitContentType = "", resolveValue = (value) => String(value ?? "")) {
  const headers = rows.reduce((accumulator, row) => {
    if (!row?.enabled || !String(row.key || "").trim()) {
      return accumulator;
    }

    accumulator[resolveValue(row.key).trim()] = resolveValue(row.value).trim();
    return accumulator;
  }, {});

  if (auth?.type === "bearer" && resolveValue(auth.token).trim()) {
    headers.Authorization = `Bearer ${resolveValue(auth.token).trim()}`;
  }

  if (auth?.type === "basic" && (auth.username || auth.password)) {
    const encoded = btoa(`${resolveValue(auth.username)}:${resolveValue(auth.password)}`);
    headers.Authorization = `Basic ${encoded}`;
  }

  if (auth?.type === "apikey" && auth.apiKeyIn !== "query" && resolveValue(auth.apiKeyName).trim()) {
    headers[resolveValue(auth.apiKeyName).trim()] = resolveValue(auth.apiKeyValue);
  }

  if (auth?.type === "oauth2" && resolveValue(auth?.oauth2?.accessToken).trim()) {
    const tokenType = resolveValue(auth?.oauth2?.tokenType || "Bearer").trim() || "Bearer";
    headers.Authorization = `${tokenType} ${resolveValue(auth.oauth2.accessToken).trim()}`;
  }

  const contentType = explicitContentType || getDefaultContentType(bodyType);

  if (contentType && !hasHeader(headers, "content-type")) {
    headers["Content-Type"] = contentType;
  }

  return headers;
}

export function buildUrlWithParams(rawUrl, params = []) {
  const normalized = normalizeUrl(rawUrl);

  if (!normalized) {
    return "";
  }

  try {
    const url = new URL(normalized);
    url.search = "";

    params.forEach((param) => {
      if (param?.enabled && String(param.key || "").trim()) {
        url.searchParams.append(String(param.key).trim(), String(param.value || ""));
      }
    });

    return url.toString();
  } catch {
    return normalized;
  }
}

export function buildRequestExport(request) {
  const method = String(request?.method || "GET").toUpperCase();
  const bodyType = request?.bodyType ?? "json";
  const auth = request?.auth ?? { type: "none" };
  const { body, contentType } = serializeBodyByType(request, method);
  const headers = serializeHeaders(request?.headers ?? [], auth, bodyType, contentType);
  let url = buildUrlWithParams(request?.url ?? "", request?.queryParams ?? []);

  if (auth.type === "apikey" && auth.apiKeyIn === "query" && String(auth.apiKeyName || "").trim()) {
    try {
      const parsed = new URL(url);
      parsed.searchParams.append(String(auth.apiKeyName).trim(), String(auth.apiKeyValue || ""));
      url = parsed.toString();
    } catch {
    }
  }

  return {
    name: request?.name || "Untitled Request",
    method,
    url,
    bodyType,
    headers,
    body,
    hasBody: Boolean(body)
  };
}

function resolveTemplateValue(value, mergedEnv = {}) {
  return String(value ?? "").replace(/\{\{([^}]+)\}\}/g, (_, key) => mergedEnv[key.trim()] ?? "");
}

function hasHeaderName(headers, name) {
  const lookup = String(name || "").toLowerCase();
  return Object.keys(headers).some((key) => String(key).toLowerCase() === lookup);
}

function appendQueryParam(url, key, value) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.append(String(key), String(value));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function buildResolvedRequestExport(request, context = {}) {
  const method = String(request?.method || "GET").toUpperCase();
  const bodyType = request?.bodyType ?? "json";
  const mergedEnv = context?.envVars?.merged ?? {};
  const resolveValue = (value) => resolveTemplateValue(value, mergedEnv);
  const requestAuth = normalizeAuthState(request?.auth ?? { type: "none" });
  const collectionAuth = normalizeAuthState(context?.collectionConfig?.defaultAuth ?? { type: "none" });
  const effectiveAuth = requestAuth.type === "inherit" ? collectionAuth : requestAuth;
  const inheritHeaders = request?.inheritHeaders ?? true;

  const { body, contentType } = serializeBodyByType(request, method, resolveValue);
  const defaultHeaders = inheritHeaders ? context?.collectionConfig?.defaultHeaders ?? [] : [];
  const headerRows = [...defaultHeaders, ...(request?.headers ?? [])];
  const headers = serializeHeaders(headerRows, { type: "none" }, bodyType, contentType, resolveValue);

  const shouldAddInheritedAuth = requestAuth.type === "inherit" && !hasHeaderName(headers, "authorization");
  if (shouldAddInheritedAuth || requestAuth.type !== "inherit") {
    const authHeaders = serializeHeaders([], effectiveAuth, bodyType, "", resolveValue);
    Object.entries(authHeaders).forEach(([key, value]) => {
      headers[key] = value;
    });
  }

  const resolvedUrl = resolveValue(request?.url ?? "");
  const resolvedQueryParams = (request?.queryParams ?? []).map((row) => ({
    ...row,
    key: resolveValue(row?.key ?? ""),
    value: resolveValue(row?.value ?? ""),
  }));
  let url = buildUrlWithParams(resolvedUrl, resolvedQueryParams);

  if (requestAuth.type === "inherit" && effectiveAuth.type === "apikey" && effectiveAuth.apiKeyIn === "query" && resolveValue(effectiveAuth.apiKeyName).trim()) {
    url = appendQueryParam(url, resolveValue(effectiveAuth.apiKeyName).trim(), resolveValue(effectiveAuth.apiKeyValue));
  }

  if (requestAuth.type === "apikey" && effectiveAuth.apiKeyIn === "query" && resolveValue(effectiveAuth.apiKeyName).trim()) {
    try {
      const parsed = new URL(url);
      const key = resolveValue(effectiveAuth.apiKeyName).trim();
      const alreadyHas = parsed.searchParams.has(key);
      if (!alreadyHas) {
        parsed.searchParams.append(key, resolveValue(effectiveAuth.apiKeyValue));
      }
      url = parsed.toString();
    } catch {
    }
  }

  return {
    name: request?.name || "Untitled Request",
    method,
    url,
    bodyType,
    headers,
    body,
    hasBody: Boolean(body)
  };
}

export function buildRequestPayload(request, workspaceName, collectionName) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
  const auth = request?.auth ?? { type: "none" };
  const bodyType = request?.bodyType ?? "json";
  const bodyFilePath = bodyType === "file" ? String(request?.bodyFilePath ?? "") : "";

  return {
    method,
    url,
    headers,
    body: bodyType === "file" ? null : (hasBody ? body : null),
    bodyFilePath: bodyFilePath || null,
    workspaceName: workspaceName || "",
    collectionName: collectionName || "",
    authType: auth.type ?? "none",
    inheritHeaders: request?.inheritHeaders ?? true,
    authPayload: auth.type === "inherit" ? null : {
      apiKeyIn: auth.apiKeyIn ?? "header",
      apiKeyName: auth.apiKeyName ?? "",
      apiKeyValue: auth.apiKeyValue ?? "",
      oauth2: auth.type === "oauth2" ? auth.oauth2 ?? null : null,
    },
  };
}

function quoteString(value) {
  return JSON.stringify(String(value ?? ""));
}

function escapeShellString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function buildFetchSnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;
  const lines = [
    `const url = ${quoteString(url)};`,
    "",
    "const options = {",
    `  method: ${quoteString(method)},`
  ];

  if (Object.keys(headers).length) {
    lines.push(`  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, "\n  ")},`);
  }

  if (hasBody) {
    lines.push(`  body: ${quoteString(body)},`);
  }

  lines.push("};", "", "fetch(url, options)");
  lines.push("  .then((response) => response.text())");
  lines.push("  .then((result) => console.log(result))");
  lines.push("  .catch((error) => console.error(error));");

  return lines.join("\n");
}

function buildPythonSnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;

  return [
    "import requests",
    "",
    `url = ${quoteString(url)}`,
    `headers = ${JSON.stringify(headers, null, 2)}`,
    hasBody ? `payload = ${quoteString(body)}` : null,
    "",
    `response = requests.request(${quoteString(method)}, url, headers=headers${hasBody ? ", data=payload" : ""})`,
    "print(response.text)"
  ].filter(Boolean).join("\n");
}

function buildPowerShellSnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;
  const headerLines = Object.entries(headers).map(([key, value]) => `  ${quoteString(key)} = ${quoteString(value)}`);

  return [
    headerLines.length ? "$headers = @{" : "$headers = @{}",
    ...(headerLines.length ? [...headerLines, "}"] : []),
    !headerLines.length ? "" : "",
    hasBody ? `$body = ${escapeShellString(body)}` : null,
    `$response = Invoke-RestMethod -Uri ${quoteString(url)} -Method ${quoteString(method)} -Headers $headers${hasBody ? " -Body $body" : ""}`,
    "$response"
  ].filter((line, index, lines) => !(line === "" && lines[index - 1] === "")).join("\n");
}

function buildGoSnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;
  const headerLines = Object.entries(headers).map(([key, value]) => `\treq.Header.Add(${quoteString(key)}, ${quoteString(value)})`);

  return [
    "package main",
    "",
    "import (",
    '\t"fmt"',
    '\t"io"',
    '\t"net/http"',
    hasBody ? '\t"strings"' : null,
    ")",
    "",
    "func main() {",
    hasBody ? `\tpayload := strings.NewReader(${quoteString(body)})` : null,
    `\treq, err := http.NewRequest(${quoteString(method)}, ${quoteString(url)}, ${hasBody ? "payload" : "nil"})`,
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "",
    ...headerLines,
    ...(headerLines.length ? [""] : []),
    "\tres, err := http.DefaultClient.Do(req)",
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "\tdefer res.Body.Close()",
    "",
    "\tbody, err := io.ReadAll(res.Body)",
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "",
    '\tfmt.Println(string(body))',
    "}"
  ].filter(Boolean).join("\n");
}

function buildJavaSnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;
  const headerLines = Object.entries(headers).map(([key, value]) => `.header(${quoteString(key)}, ${quoteString(value)})`);
  const publisher = hasBody ? `HttpRequest.BodyPublishers.ofString(${quoteString(body)})` : "HttpRequest.BodyPublishers.noBody()";

  return [
    "import java.net.URI;",
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "import java.net.http.HttpResponse;",
    "",
    "HttpClient client = HttpClient.newHttpClient();",
    "HttpRequest request = HttpRequest.newBuilder()",
    `    .uri(URI.create(${quoteString(url)}))`,
    ...headerLines.map((line) => `    ${line}`),
    `    .method(${quoteString(method)}, ${publisher})`,
    "    .build();",
    "",
    "HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());",
    "System.out.println(response.body());"
  ].join("\n");
}

function buildCSharpSnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;
  const contentTypeEntry = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type");
  const headerLines = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() !== "content-type")
    .map(([key, value]) => `request.Headers.TryAddWithoutValidation(${quoteString(key)}, ${quoteString(value)});`);

  return [
    "using System;",
    "using System.Net.Http;",
    "using System.Text;",
    "",
    "using var client = new HttpClient();",
    `using var request = new HttpRequestMessage(new HttpMethod(${quoteString(method)}), ${quoteString(url)});`,
    ...headerLines,
    hasBody
      ? `request.Content = new StringContent(${quoteString(body)}${contentTypeEntry ? `, Encoding.UTF8, ${quoteString(contentTypeEntry[1])}` : ""});`
      : null,
    "",
    "using var response = await client.SendAsync(request);",
    "var result = await response.Content.ReadAsStringAsync();",
    "Console.WriteLine(result);"
  ].filter(Boolean).join("\n");
}

function buildPhpSnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;
  const headerLines = Object.entries(headers).map(([key, value]) => `    ${quoteString(`${key}: ${value}`)},`);

  return [
    "<?php",
    "",
    "$curl = curl_init();",
    "",
    "curl_setopt_array($curl, [",
    `  CURLOPT_URL => ${quoteString(url)},`,
    "  CURLOPT_RETURNTRANSFER => true,",
    `  CURLOPT_CUSTOMREQUEST => ${quoteString(method)},`,
    headerLines.length ? "  CURLOPT_HTTPHEADER => [" : null,
    ...headerLines,
    headerLines.length ? "  ]," : null,
    hasBody ? `  CURLOPT_POSTFIELDS => ${quoteString(body)},` : null,
    "]);",
    "",
    "$response = curl_exec($curl);",
    "curl_close($curl);",
    "",
    "echo $response;"
  ].filter(Boolean).join("\n");
}

function buildRubySnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;
  const className = { GET: "Get", POST: "Post", PUT: "Put", PATCH: "Patch", DELETE: "Delete" }[method] ?? "Get";
  const headerLines = Object.entries(headers).map(([key, value]) => `request[${quoteString(key)}] = ${quoteString(value)}`);

  return [
    'require "uri"',
    'require "net/http"',
    "",
    `url = URI(${quoteString(url)})`,
    "http = Net::HTTP.new(url.host, url.port)",
    'http.use_ssl = url.scheme == "https"',
    "",
    `request = Net::HTTP::${className}.new(url)`,
    ...headerLines,
    hasBody ? `request.body = ${quoteString(body)}` : null,
    "",
    "response = http.request(request)",
    "puts response.read_body"
  ].filter(Boolean).join("\n");
}

function buildSwiftSnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;
  const headerLines = Object.entries(headers).map(([key, value]) => `request.setValue(${quoteString(value)}, forHTTPHeaderField: ${quoteString(key)})`);

  return [
    "import Foundation",
    "",
    `let url = URL(string: ${quoteString(url)})!`,
    "var request = URLRequest(url: url)",
    `request.httpMethod = ${quoteString(method)}`,
    ...headerLines,
    hasBody ? `request.httpBody = ${quoteString(body)}.data(using: .utf8)` : null,
    "",
    "let task = URLSession.shared.dataTask(with: request) { data, _, error in",
    "    if let error {",
    "        print(error)",
    "        return",
    "    }",
    "",
    "    let responseText = String(data: data ?? Data(), encoding: .utf8) ?? \"\"",
    "    print(responseText)",
    "}",
    "",
    "task.resume()"
  ].filter(Boolean).join("\n");
}

function buildCSnippet(requestExport) {
  const { method, url, headers, body, hasBody } = requestExport;
  const headerLines = Object.entries(headers).map(([key, value]) => `    headers = curl_slist_append(headers, ${quoteString(`${key}: ${value}`)});`);

  return [
    "#include <curl/curl.h>",
    "",
    "int main(void) {",
    "    CURL *curl = curl_easy_init();",
    "    if (!curl) {",
    "        return 1;",
    "    }",
    "",
    "    struct curl_slist *headers = NULL;",
    ...headerLines,
    `    curl_easy_setopt(curl, CURLOPT_URL, ${quoteString(url)});`,
    `    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, ${quoteString(method)});`,
    headerLines.length ? "    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);" : null,
    hasBody ? `    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, ${quoteString(body)});` : null,
    "    CURLcode result = curl_easy_perform(curl);",
    "",
    "    curl_slist_free_all(headers);",
    "    curl_easy_cleanup(curl);",
    "",
    "    return result == CURLE_OK ? 0 : 1;",
    "}"
  ].filter(Boolean).join("\n");
}

export function buildCurlCommand(request, context = null) {
  const requestExport = context ? buildResolvedRequestExport(request, context) : buildRequestExport(request);
  const { method, url, headers, body, hasBody } = requestExport;
  const parts = [
    "curl",
    "--request",
    method,
    "--url",
    escapeShellString(url)
  ];

  Object.entries(headers).forEach(([key, value]) => {
    parts.push("--header", escapeShellString(`${key}: ${value}`));
  });

  if (hasBody) {
    parts.push("--data-raw", escapeShellString(body));
  }

  return parts.join(" ");
}

export function generateCodeSnippet(request, language, context = null) {
  const requestExport = context
    ? buildResolvedRequestExport(request, context)
    : buildRequestExport(request);

  switch (language) {
    case "javascript":
    case "nodejs":
      return buildFetchSnippet(requestExport);
    case "python":
      return buildPythonSnippet(requestExport);
    case "powershell":
      return buildPowerShellSnippet(requestExport);
    case "go":
      return buildGoSnippet(requestExport);
    case "java":
      return buildJavaSnippet(requestExport);
    case "csharp":
      return buildCSharpSnippet(requestExport);
    case "php":
      return buildPhpSnippet(requestExport);
    case "ruby":
      return buildRubySnippet(requestExport);
    case "swift":
      return buildSwiftSnippet(requestExport);
    case "c":
      return buildCSnippet(requestExport);
    case "shell":
    default:
      return buildCurlCommand(request, context);
  }
}

export const requestBodyModes = [
  { value: "json", label: "JSON" },
  { value: "form-data", label: "Form Data" },
  { value: "form-urlencoded", label: "Form URL Encoded" },
  { value: "graphql", label: "GraphQL" },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML" },
  { value: "text", label: "Plain Text" },
  { value: "file", label: "File" },
  { value: "none", label: "No Body" }
];
