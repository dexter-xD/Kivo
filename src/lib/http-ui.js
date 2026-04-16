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
  text: "text/plain"
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

function serializeBodyByType(request, method) {
  const bodyType = request?.bodyType ?? "json";

  if (!isBodyAllowed(method, bodyType)) {
    return { body: "", contentType: "" };
  }

  if (bodyType === "form-urlencoded") {
    const params = new URLSearchParams();
    getEnabledRows(request?.bodyRows).forEach((row) => {
      params.append(String(row.key).trim(), String(row.value || ""));
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
        `Content-Disposition: form-data; name="${String(row.key).trim().replace(/"/g, '\\"')}"`,
        "",
        String(row.value || "")
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
      const parsed = JSON.parse(String(request?.graphqlVariables || "{}"));
      variables = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      variables = {};
    }

    return {
      body: JSON.stringify({
        query: String(request?.body || ""),
        variables
      }),
      contentType: getDefaultContentType(bodyType)
    };
  }

  return {
    body: String(request?.body || ""),
    contentType: getDefaultContentType(bodyType)
  };
}

export function serializeHeaders(rows = [], auth = { type: "none", token: "" }, bodyType = "json", explicitContentType = "") {
  const headers = rows.reduce((accumulator, row) => {
    if (!row?.enabled || !String(row.key || "").trim()) {
      return accumulator;
    }

    accumulator[String(row.key).trim()] = String(row.value || "").trim();
    return accumulator;
  }, {});

  if (auth?.type === "bearer" && String(auth.token || "").trim()) {
    headers.Authorization = `Bearer ${String(auth.token).trim()}`;
  }

  if (auth?.type === "basic") {
    const user = String(auth.username || "").trim();
    const pass = String(auth.password || "").trim();
    if (user || pass) {
      try {
        const credentials = btoa(`${user}:${pass}`);
        headers.Authorization = `Basic ${credentials}`;
      } catch (e) {
        headers.Authorization = `Basic [encoding-error]`;
      }
    }
  }

  if (auth?.type === "apiKey" && auth.addTo !== "query") {
    const key = String(auth.key || "").trim();
    if (key) {
      headers[key] = String(auth.value || "").trim();
    }
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
  const { body, contentType } = serializeBodyByType(request, method);
  const headers = serializeHeaders(request?.headers ?? [], request?.auth ?? { type: "none", token: "" }, bodyType, contentType);
  const url = buildUrlWithParams(request?.url ?? "", request?.queryParams ?? []);

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

  return {
    method,
    url,
    headers,
    body: hasBody ? body : null,
    workspaceName: workspaceName || "",
    collectionName: collectionName || "",
    authType: request?.auth?.type ?? "none",
    auth: request?.auth ?? null,
    inheritHeaders: request?.inheritHeaders ?? true,
  };
}

function quoteString(value) {
  return JSON.stringify(String(value ?? ""));
}

function escapeShellString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function buildFetchSnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

function buildPythonSnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);

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

function buildPowerShellSnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

function buildGoSnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

function buildJavaSnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

function buildCSharpSnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

function buildPhpSnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

function buildRubySnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

function buildSwiftSnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

function buildCSnippet(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

export function buildCurlCommand(request) {
  const { method, url, headers, body, hasBody } = buildRequestExport(request);
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

export function generateCodeSnippet(request, language) {
  switch (language) {
    case "javascript":
    case "nodejs":
      return buildFetchSnippet(request);
    case "python":
      return buildPythonSnippet(request);
    case "powershell":
      return buildPowerShellSnippet(request);
    case "go":
      return buildGoSnippet(request);
    case "java":
      return buildJavaSnippet(request);
    case "csharp":
      return buildCSharpSnippet(request);
    case "php":
      return buildPhpSnippet(request);
    case "ruby":
      return buildRubySnippet(request);
    case "swift":
      return buildSwiftSnippet(request);
    case "c":
      return buildCSnippet(request);
    case "shell":
    default:
      return buildCurlCommand(request);
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
