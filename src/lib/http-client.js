import { invoke } from "@tauri-apps/api/core";

export function sendHttpRequest(payload) {
  return invoke("send_http_request", { payload });
}

function sanitizeRequestForSave(request) {
  const bodyType = String(request?.bodyType ?? "json");

  const sanitized = {
    name: String(request?.name ?? ""),
    pinned: Boolean(request?.pinned),
    method: String(request?.method ?? "GET"),
    url: String(request?.url ?? ""),
    queryParams: Array.isArray(request?.queryParams) ? request.queryParams : [],
    headers: Array.isArray(request?.headers) ? request.headers : [],
    auth: sanitizeAuthForSave(request?.auth),
    bodyType,
    docs: String(request?.docs ?? ""),
    activeEditorTab: String(request?.activeEditorTab ?? "Params"),
    activeResponseTab: String(request?.activeResponseTab ?? "Body"),
    responseBodyView: String(request?.responseBodyView ?? "JSON"),
    inheritHeaders: request?.inheritHeaders ?? true,
    lastResponse: null
  };

  if (bodyType === "form-data" || bodyType === "form-urlencoded") {
    sanitized.bodyRows = Array.isArray(request?.bodyRows) ? request.bodyRows : [];
  } else if (bodyType === "file") {
    sanitized.bodyFilePath = String(request?.bodyFilePath ?? "");
  } else if (bodyType === "graphql") {
    sanitized.body = typeof request?.body === "string" ? request.body : "";
    sanitized.graphqlVariables = sanitizeGraphqlVariablesForSave(request);
  } else if (bodyType !== "none") {
    sanitized.body = sanitizeRequestBodyForSave(request);
  }

  return sanitized;
}

export function cancelHttpRequest(requestId) {
  return invoke("cancel_http_request", { requestId });
}

export function exchangeOAuthToken(payload) {
  return invoke("oauth_exchange_token", { payload });
}

export function cancelOAuthExchange(requestId) {
  return invoke("cancel_oauth_exchange", { requestId });
}

export function loadAppState() {
  return invoke("load_app_state");
}

function sanitizeAuthForSave(auth) {
  const authType = String(auth?.type || "none");

  if (authType === "none" || authType === "inherit") {
    return { type: authType };
  }

  if (authType === "bearer") {
    return {
      type: "bearer",
      token: String(auth?.token ?? "")
    };
  }

  if (authType === "basic") {
    return {
      type: "basic",
      username: String(auth?.username ?? ""),
      password: String(auth?.password ?? "")
    };
  }

  if (authType === "apikey") {
    return {
      type: "apikey",
      apiKeyName: String(auth?.apiKeyName ?? ""),
      apiKeyValue: String(auth?.apiKeyValue ?? ""),
      apiKeyIn: String(auth?.apiKeyIn ?? "header")
    };
  }

  if (authType === "oauth2") {
    return {
      type: "oauth2",
      oauth2: auth?.oauth2 && typeof auth.oauth2 === "object" ? auth.oauth2 : {}
    };
  }

  return { type: "none" };
}

function sanitizeGraphqlVariablesForSave(request) {
  const raw = request?.graphqlVariables;

  if (request?.bodyType !== "graphql") {
    return "";
  }

  if (typeof raw !== "string") {
    return raw;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function sanitizeRequestBodyForSave(request) {
  const raw = request?.body;
  const bodyType = request?.bodyType;

  if (bodyType === "graphql") {
    return raw;
  }

  if (bodyType !== "json") {
    return raw;
  }

  if (typeof raw !== "string") {
    return raw;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

export function saveAppState(payload) {
  const cleanPayload = {
    ...payload,
    workspaces: payload.workspaces?.map((workspace) => ({
      ...workspace,
      collections: workspace.collections?.map((collection) => ({
        ...collection,
        requests: collection.requests?.map((request) => sanitizeRequestForSave(request))
      }))
    }))
  };

  return invoke("save_app_state", { payload: cleanPayload });
}

export function getEnvVars(workspaceName, collectionName) {
  return invoke("get_env_vars", {
    workspaceName,
    collectionName: collectionName || null,
  });
}

export function saveEnvVars(workspaceName, collectionName, vars) {
  return invoke("save_env_vars", {
    workspaceName,
    collectionName: collectionName || null,
    vars,
  });
}

export function getCollectionConfig(workspaceName, collectionName) {
  return invoke("get_collection_config", { workspaceName, collectionName });
}

export function saveCollectionConfig(workspaceName, collectionName, config) {
  return invoke("save_collection_config", { workspaceName, collectionName, config });
}

export function getResolvedStoragePath() {
  return invoke("get_resolved_storage_path");
}

export function validateStoragePath(path) {
  return invoke("validate_storage_path", { path });
}

export function switchStoragePath(path, mode) {
  return invoke("switch_storage_path", { payload: { path, mode } });
}

