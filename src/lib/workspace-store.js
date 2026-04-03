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
    auth: { type: "none", token: "" },
    bodyType: "json",
    body: "",
    bodyRows: [],
    graphqlVariables: "{\n\n}",
    docs: "",
    activeEditorTab: "Params",
    activeResponseTab: "Body",
    responseBodyView: "JSON",
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
  return {
    ...request,
    pinned: Boolean(request?.pinned),
    queryParams: Array.isArray(request?.queryParams) ? request.queryParams : [],
    headers: Array.isArray(request?.headers) ? request.headers : [],
    bodyRows: Array.isArray(request?.bodyRows) ? request.bodyRows : [],
    graphqlVariables: typeof request?.graphqlVariables === "string" ? request.graphqlVariables : "{\n\n}",
    auth: request?.auth && typeof request.auth === "object"
      ? { type: request.auth.type ?? "none", token: request.auth.token ?? "" }
      : { type: "none", token: "" }
  };
}

export function cloneRequest(request) {
  return {
    ...normalizeRequestRecord(request),
    pinned: false,
    queryParams: (request.queryParams || []).map((row) => ({ ...row })),
    headers: (request.headers || []).map((row) => ({ ...row })),
    bodyRows: (request.bodyRows || []).map((row) => ({ ...row })),
    lastResponse: request.lastResponse ? { ...request.lastResponse } : null
  };
}
