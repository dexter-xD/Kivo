import { createDefaultAuthState, normalizeAuthState } from "@/lib/oauth.js";

export function formatSavedAt() {
  return new Date().toLocaleString();
}

export function createRow() {
  return { key: "", value: "", enabled: true };
}

export function createEmptyResponse() {
  return {
    status: 0,
    badge: "Waiting",
    statusText: "No response yet",
    duration: "0 ms",
    size: "0 B",
    headers: {},
    cookies: [],
    body: "Send a request to inspect the response.",
    rawBody: "Send a request to inspect the response.",
    isJson: false,
    meta: {
      url: "-",
      method: "-"
    },
    savedAt: ""
  };
}

export function getUniqueName(baseName, existingNames = []) {
  if (!existingNames.includes(baseName)) {
    return baseName;
  }

  let counter = 1;
  while (existingNames.includes(`${baseName} (${counter})`)) {
    counter++;
  }
  return `${baseName} (${counter})`;
}

export function createRequest(name = "New Request") {
  return {
    name,
    pinned: false,
    method: "GET",
    url: "",
    queryParams: [],
    headers: [],
    auth: createDefaultAuthState(),
    bodyType: "json",
    body: "",
    bodyRows: [],
    graphqlVariables: "{\n\n}",
    docs: "",
    activeEditorTab: "Params",
    activeResponseTab: "Body",
    responseBodyView: "JSON",
    inheritHeaders: true,
    lastResponse: null
  };
}

export function createCollection(name = "New Collection") {
  return {
    name,
    requests: [],
    openRequestNames: []
  };
}

export function createWorkspace(name, description = "") {
  return {
    name,
    description,
    collections: [],
    activeCollectionName: ""
  };
}

export function createDefaultStore() {
  return {
    version: 1,
    storagePath: null,
    activeWorkspaceName: "",
    activeCollectionName: "",
    activeRequestName: "",
    sidebarTab: "requests",
    sidebarCollapsed: false,
    sidebarWidth: 260,
    workspaces: []
  };
}

export function getActiveWorkspace(store) {
  return store.workspaces.find((workspace) => workspace.name === store.activeWorkspaceName) ?? store.workspaces[0] ?? null;
}

export function getActiveCollection(store) {
  const workspace = getActiveWorkspace(store);
  if (!workspace) return null;
  return workspace.collections.find((c) => c.name === store.activeCollectionName) ?? workspace.collections[0] ?? null;
}

export function getActiveRequest(store) {
  const collection = getActiveCollection(store);
  if (!collection || !collection.openRequestNames?.includes(store.activeRequestName)) {
    return null;
  }

  return collection.requests.find((request) => request.name === store.activeRequestName) ?? null;
}

export function orderRequests(requests = []) {
  return [...requests]
    .map((request, index) => ({ request, index }))
    .sort((left, right) => {
      if (Boolean(left.request.pinned) === Boolean(right.request.pinned)) {
        return left.index - right.index;
      }

      return left.request.pinned ? -1 : 1;
    })
    .map(({ request }) => request);
}

export function normalizeRequestRecord(request) {
  let normalizedBody = "";
  if (typeof request?.body === "string") {
    normalizedBody = request.body;
  } else if (request?.body && typeof request.body === "object") {
    try {
      normalizedBody = JSON.stringify(request.body, null, 2);
    } catch {
      normalizedBody = "";
    }
  }

  let normalizedGraphqlVariables = "{\n\n}";
  if (typeof request?.graphqlVariables === "string") {
    normalizedGraphqlVariables = request.graphqlVariables;
  } else if (request?.graphqlVariables && typeof request.graphqlVariables === "object") {
    try {
      normalizedGraphqlVariables = JSON.stringify(request.graphqlVariables, null, 2);
    } catch {
      normalizedGraphqlVariables = "{\n\n}";
    }
  }

  return {
    ...request,
    pinned: Boolean(request?.pinned),
    inheritHeaders: request?.inheritHeaders ?? true,
    queryParams: Array.isArray(request?.queryParams) ? request.queryParams : [],
    headers: Array.isArray(request?.headers) ? request.headers : [],
    body: normalizedBody,
    bodyRows: Array.isArray(request?.bodyRows) ? request.bodyRows : [],
    graphqlVariables: normalizedGraphqlVariables,
    auth: normalizeAuthState(request?.auth)
  };
}

export function cloneRequest(request) {
  return {
    ...normalizeRequestRecord(request),
    pinned: false,
    queryParams: (request.queryParams || []).map((row) => ({ ...row })),
    headers: (request.headers || []).map((row) => ({ ...row })),
    bodyRows: (request.bodyRows || []).map((row) => ({ ...row })),
    auth: normalizeAuthState(request.auth),
    lastResponse: request.lastResponse ? { ...request.lastResponse } : null
  };
}
