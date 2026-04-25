import { createDefaultAuthState, normalizeAuthState } from "@/lib/oauth.js";

export const REQUEST_MODES = {
  HTTP: "http",
  SSE: "sse",
  GRAPHQL: "graphql",
  GRPC: "grpc",
  WEBSOCKET: "websocket",
  SOCKET_IO: "socketio"
};

export const REQUEST_MODE_OPTIONS = [
  { value: REQUEST_MODES.HTTP, label: "HTTP Request" },
  { value: REQUEST_MODES.SSE, label: "Event Stream Request (SSE)" },
  { value: REQUEST_MODES.GRAPHQL, label: "GraphQL Request" },
  { value: REQUEST_MODES.GRPC, label: "gRPC Request" },
  { value: REQUEST_MODES.WEBSOCKET, label: "WebSocket Request" },
  { value: REQUEST_MODES.SOCKET_IO, label: "Socket.IO Request" }
];

function getRequestModeTemplate(mode) {
  switch (mode) {
    case REQUEST_MODES.GRAPHQL:
      return {
        method: "POST",
        bodyType: "graphql",
        body: "",
        graphqlVariables: "{\n\n}",
        activeEditorTab: "Body"
      };
    case REQUEST_MODES.SSE:
      return {
        method: "GET",
        bodyType: "none",
        headers: [{ key: "Accept", value: "text/event-stream", enabled: true }]
      };
    case REQUEST_MODES.GRPC:
      return {
        method: "POST",
        bodyType: "json",
        activeEditorTab: "Body",
        headers: [{ key: "Content-Type", value: "application/grpc", enabled: true }]
      };
    case REQUEST_MODES.WEBSOCKET:
      return {
        method: "GET",
        bodyType: "json",
        activeEditorTab: "Body"
      };
    case REQUEST_MODES.SOCKET_IO:
      return {
        method: "GET",
        bodyType: "none"
      };
    case REQUEST_MODES.HTTP:
    default:
      return {
        method: "GET",
        bodyType: "json"
      };
  }
}

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

export function createRequest(name = "New Request", mode = REQUEST_MODES.HTTP) {
  const requestMode = Object.values(REQUEST_MODES).includes(mode) ? mode : REQUEST_MODES.HTTP;
  const template = getRequestModeTemplate(requestMode);

  return {
    name,
    requestMode,
    pinned: false,
    method: template.method,
    url: "",
    queryParams: [],
    headers: template.headers ?? [],
    auth: createDefaultAuthState(),
    bodyType: template.bodyType,
    body: template.body ?? "",
    bodyRows: [],
    bodyFilePath: "",
    graphqlVariables: template.graphqlVariables ?? "{\n\n}",
    grpcProtoFilePath: "",
    grpcMethodPath: "",
    grpcStreamingMode: "bidi",
    grpcDirectProtoFiles: [],
    grpcProtoDirectories: [],
    docs: "",
    activeEditorTab: template.activeEditorTab ?? "Params",
    activeResponseTab: "Body",
    responseBodyView: "JSON",
    inheritHeaders: true,
    tags: [],
    urlEncoding: true,
    followRedirects: true,
    maxRedirects: 5,
    timeoutMs: 0,
    folderPath: "",
    lastResponse: null
  };
}

export function createCollection(name = "New Collection") {
  return {
    name,
    folders: [],
    folderSettings: [],
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

  const allowedModes = Object.values(REQUEST_MODES);
  const requestMode = allowedModes.includes(request?.requestMode)
    ? request.requestMode
    : (request?.bodyType === "graphql" ? REQUEST_MODES.GRAPHQL : REQUEST_MODES.HTTP);

  return {
    ...request,
    requestMode,
    pinned: Boolean(request?.pinned),
    inheritHeaders: request?.inheritHeaders ?? true,
    queryParams: Array.isArray(request?.queryParams) ? request.queryParams : [],
    headers: Array.isArray(request?.headers) ? request.headers : [],
    body: normalizedBody,
    bodyRows: Array.isArray(request?.bodyRows) ? request.bodyRows : [],
    bodyFilePath: typeof request?.bodyFilePath === "string" ? request.bodyFilePath : "",
    graphqlVariables: normalizedGraphqlVariables,
    grpcProtoFilePath: typeof request?.grpcProtoFilePath === "string" ? request.grpcProtoFilePath : "",
    grpcMethodPath: typeof request?.grpcMethodPath === "string" ? request.grpcMethodPath : "",
    grpcStreamingMode: ["unary", "server_stream", "client_stream", "bidi"].includes(request?.grpcStreamingMode)
      ? request.grpcStreamingMode
      : "bidi",
    grpcDirectProtoFiles: Array.isArray(request?.grpcDirectProtoFiles)
      ? request.grpcDirectProtoFiles.map((path) => String(path || "").trim()).filter(Boolean)
      : [],
    grpcProtoDirectories: Array.isArray(request?.grpcProtoDirectories)
      ? request.grpcProtoDirectories
        .map((group) => ({
          path: String(group?.path || "").trim(),
          files: Array.isArray(group?.files)
            ? group.files.map((path) => String(path || "").trim()).filter(Boolean)
            : []
        }))
        .filter((group) => group.path)
      : [],
    tags: Array.isArray(request?.tags) ? request.tags.map((tag) => String(tag)) : [],
    urlEncoding: request?.urlEncoding ?? true,
    followRedirects: request?.followRedirects ?? true,
    maxRedirects: Number.isFinite(request?.maxRedirects) ? Number(request.maxRedirects) : 5,
    timeoutMs: Number.isFinite(request?.timeoutMs) ? Number(request.timeoutMs) : 0,
    folderPath: typeof request?.folderPath === "string" ? request.folderPath : "",
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
    grpcDirectProtoFiles: (request.grpcDirectProtoFiles || []).map((path) => String(path)),
    grpcProtoDirectories: (request.grpcProtoDirectories || []).map((group) => ({
      path: String(group?.path || ""),
      files: Array.isArray(group?.files) ? group.files.map((path) => String(path)) : []
    })),
    tags: (request.tags || []).map((tag) => String(tag)),
    auth: normalizeAuthState(request.auth),
    lastResponse: request.lastResponse ? { ...request.lastResponse } : null
  };
}
