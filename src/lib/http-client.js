import { invoke } from "@tauri-apps/api/core";

export function sendHttpRequest(payload) {
  return invoke("send_http_request", { payload });
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

export function saveAppState(payload) {
  const cleanPayload = {
    ...payload,
    workspaces: payload.workspaces?.map((workspace) => ({
      ...workspace,
      collections: workspace.collections?.map((collection) => ({
        ...collection,
        requests: collection.requests?.map((request) => ({
          ...request,
          lastResponse: null
        }))
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

