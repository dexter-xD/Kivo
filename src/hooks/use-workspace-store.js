import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

import { cancelHttpRequest, loadAppState, saveAppState, sendGrpcRequest, sendHttpRequest } from "@/lib/http-client.js";
import { buildRequestPayload, buildUrlWithParams, serializeHeaders } from "@/lib/http-ui.js";
import {
  cloneRequest,
  createCollection,
  createDefaultStore,
  createEmptyResponse,
  createRequest,
  REQUEST_MODES,
  createWorkspace,
  formatSavedAt,
  getActiveCollection,
  getActiveRequest,
  getActiveWorkspace,
  getUniqueName,
  orderRequests
} from "@/lib/workspace-store.js";
import { clampSidebarWidth, normalizeStore, parseCookies } from "@/lib/workspace-utils.js";
import { formatResponseBody, isJsonText } from "@/lib/formatters.js";
import { normalizeUrl } from "@/lib/http-ui.js";
import { normalizeAuthState } from "@/lib/oauth.js";

const SIDEBAR_COLLAPSED_WIDTH = 52;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_REOPEN_WIDTH = 260;

function normalizeFolderPath(path) {
  return String(path ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function buildSseUrl(rawUrl, queryParams = []) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return "";

  let normalized = trimmed;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const parsed = new URL(normalized);
    queryParams.forEach((row) => {
      if (row?.enabled && String(row.key || "").trim()) {
        parsed.searchParams.append(String(row.key).trim(), String(row.value || ""));
      }
    });
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function buildSocketIoWebSocketUrl(rawUrl, queryParams = []) {
  const baseUrl = buildWebSocketUrl(rawUrl, queryParams);
  if (!baseUrl) return "";

  try {
    const parsed = new URL(baseUrl);
    if (!parsed.pathname || parsed.pathname === "/") {
      parsed.pathname = "/socket.io/";
    }
    if (!parsed.searchParams.has("EIO")) {
      parsed.searchParams.set("EIO", "4");
    }
    parsed.searchParams.set("transport", "websocket");
    return parsed.toString();
  } catch {
    return baseUrl;
  }
}

function getFolderAncestors(folderPath) {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return [];
  const segments = normalized.split("/");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

function renamePathPrefix(path, oldPrefix, newPrefix) {
  if (path === oldPrefix) return newPrefix;
  if (path.startsWith(`${oldPrefix}/`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`;
  }
  return path;
}

function resolveFolderHeaderRows(collection, folderPath) {
  const folderSettings = Array.isArray(collection?.folderSettings) ? collection.folderSettings : [];
  return getFolderAncestors(folderPath).flatMap((path) => {
    const setting = folderSettings.find((entry) => normalizeFolderPath(entry?.path) === path);
    return Array.isArray(setting?.defaultHeaders) ? setting.defaultHeaders : [];
  });
}

function resolveFolderAuth(collection, folderPath) {
  const folderSettings = Array.isArray(collection?.folderSettings) ? collection.folderSettings : [];
  const ancestors = getFolderAncestors(folderPath);

  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const setting = folderSettings.find((entry) => normalizeFolderPath(entry?.path) === ancestors[index]);
    if (!setting) continue;
    const auth = normalizeAuthState(setting.defaultAuth ?? { type: "inherit" });
    if (auth.type && auth.type !== "inherit") {
      return auth;
    }
  }

  return { type: "inherit" };
}

function getFolderParentPath(path) {
  const normalized = normalizeFolderPath(path);
  if (!normalized.includes("/")) return "";
  return normalized.split("/").slice(0, -1).join("/");
}

function getFolderLabel(path) {
  const normalized = normalizeFolderPath(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) || normalized;
}

function getRequestBaseNameByMode(mode) {
  switch (mode) {
    case REQUEST_MODES.SSE:
      return "SSE Request";
    case REQUEST_MODES.GRAPHQL:
      return "GraphQL Request";
    case REQUEST_MODES.GRPC:
      return "gRPC Request";
    case REQUEST_MODES.WEBSOCKET:
      return "WebSocket Request";
    case REQUEST_MODES.SOCKET_IO:
      return "Socket.IO Request";
    case REQUEST_MODES.HTTP:
    default:
      return "HTTP Request";
  }
}

function updateRequestWithLocalResponse(current, requestName, savedResponse, responseBodyView = "Raw") {
  return {
    ...current,
    workspaces: current.workspaces.map((workspace) => {
      if (workspace.name !== current.activeWorkspaceName) return workspace;
      return {
        ...workspace,
        collections: workspace.collections.map((collection) => {
          if (collection.name !== current.activeCollectionName) return collection;
          return {
            ...collection,
            requests: collection.requests.map((request) => (
              request.name === requestName
                ? { ...request, responseBodyView, lastResponse: savedResponse }
                : request
            ))
          };
        })
      };
    })
  };
}

function updateRequestWithLocalResponseByIdentity(current, workspaceName, collectionName, requestName, savedResponse, responseBodyView = "Raw") {
  return {
    ...current,
    workspaces: current.workspaces.map((workspace) => {
      if (workspace.name !== workspaceName) return workspace;
      return {
        ...workspace,
        collections: workspace.collections.map((collection) => {
          if (collection.name !== collectionName) return collection;
          return {
            ...collection,
            requests: collection.requests.map((request) => (
              request.name === requestName
                ? { ...request, responseBodyView, lastResponse: savedResponse }
                : request
            ))
          };
        })
      };
    })
  };
}

function buildRequestKey(workspaceName, collectionName, requestName) {
  return `${workspaceName}::${collectionName}::${requestName}`;
}

function toWebSocketUrl(url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";

  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http/i, "ws");
  }
  return `wss://${trimmed}`;
}

function buildWebSocketUrl(rawUrl, queryParams = []) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return "";

  const baseUrl = toWebSocketUrl(trimmed);
  try {
    const parsed = new URL(baseUrl);
    queryParams.forEach((row) => {
      if (row?.enabled && String(row.key || "").trim()) {
        parsed.searchParams.append(String(row.key).trim(), String(row.value || ""));
      }
    });
    return parsed.toString();
  } catch {
    return baseUrl;
  }
}

export function useWorkspaceStore() {
  const [store, setStore] = useState(createDefaultStore());
  const [isSending, setIsSending] = useState(false);
  const [sendStartedAt, setSendStartedAt] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSetupComplete, setIsSetupComplete] = useState(true);
  const [starCount, setStarCount] = useState(null);
  const saveTimerRef = useRef(null);
  const resizeRef = useRef({ active: false, startX: 0, startWidth: 304 });
  const activeHttpRequestIdRef = useRef("");
  const wsConnectionsRef = useRef(new Map());
  const sseConnectionsRef = useRef(new Map());
  const socketIoConnectionsRef = useRef(new Map());
  const [wsStates, setWsStates] = useState({});

  useEffect(() => {
    async function checkSetup() {
      try {
        const config = await invoke("get_app_config");
        setIsSetupComplete(!!config.storagePath);
      } catch (error) {
        console.error("Failed to check setup status:", error);
      }
    }
    checkSetup();
  }, []);

  const activeWorkspace = useMemo(() => getActiveWorkspace(store), [store]);
  const activeCollection = useMemo(() => getActiveCollection(store), [store]);
  const activeRequest = useMemo(() => getActiveRequest(store), [store]);

  const requestTabs = useMemo(() => {
    if (!activeCollection) {
      return [];
    }

    const openNames = new Set(activeCollection.openRequestNames || []);
    return activeCollection.requests.filter((request) => openNames.has(request.name));
  }, [activeCollection]);

  const response = activeRequest?.lastResponse ?? createEmptyResponse();

  useEffect(() => {
    async function fetchStars() {
      try {
        const res = await fetch("https://api.github.com/repos/DevlogZz/Kivo");
        const data = await res.json();
        if (data.stargazers_count !== undefined) {
          setStarCount(data.stargazers_count);
        }
      } catch (error) {
        console.error("Failed to fetch star count:", error);
      }
    }

    fetchStars();
  }, []);

  useEffect(() => {
    if (!isSetupComplete) return;
    let cancelled = false;

    async function hydrate() {
      try {
        const persisted = await loadAppState();

        if (!cancelled) {
          setStore(normalizeStore(persisted));
        }
      } catch {
        if (!cancelled) {
          setStore(createDefaultStore());
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    }

    hydrate();

    return () => {
      cancelled = true;
    };
  }, [isSetupComplete]);

  useEffect(() => {
    function handleMove(event) {
      if (!resizeRef.current.active) {
        return;
      }

      const rawWidth = resizeRef.current.startWidth + (event.clientX - resizeRef.current.startX);

      setStore((current) => {
        if (rawWidth <= SIDEBAR_MIN_WIDTH) {
          return {
            ...current,
            sidebarCollapsed: true,
            sidebarWidth: Math.max(current.sidebarWidth, SIDEBAR_REOPEN_WIDTH)
          };
        }

        return {
          ...current,
          sidebarCollapsed: false,
          sidebarWidth: clampSidebarWidth(rawWidth)
        };
      });
    }

    function handleUp() {
      resizeRef.current.active = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return undefined;
    }

    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveAppState(store).catch((err) => { console.error("saveAppState failed:", err); });
    }, 300);

    return () => {
      window.clearTimeout(saveTimerRef.current);
    };
  }, [isHydrated, store]);

  useEffect(() => () => {
    wsConnectionsRef.current.forEach((socket) => {
      try {
        socket.close();
      } catch {
      }
    });
    wsConnectionsRef.current.clear();

    sseConnectionsRef.current.forEach((source) => {
      try {
        source.close();
      } catch {
      }
    });
    sseConnectionsRef.current.clear();

    socketIoConnectionsRef.current.forEach((socket) => {
      try {
        socket.close();
      } catch {
      }
    });
    socketIoConnectionsRef.current.clear();
  }, []);

  function updateStore(updater) {
    setStore((current) => normalizeStore(typeof updater === "function" ? updater(current) : updater));
  }

  function handleSidebarTabChange(sidebarTab) {
    updateStore((current) => ({
      ...current,
      sidebarTab,
      sidebarCollapsed: false,
      sidebarWidth: clampSidebarWidth(Math.max(current.sidebarWidth, SIDEBAR_REOPEN_WIDTH))
    }));
  }

  function updateActiveRequest(updater) {
    updateStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => {
        if (workspace.name !== current.activeWorkspaceName) {
          return workspace;
        }

        return {
          ...workspace,
          collections: workspace.collections.map((collection) => {
            if (collection.name !== current.activeCollectionName) {
              return collection;
            }

            return {
              ...collection,
              requests: collection.requests.map((request) => {
                if (request.name !== current.activeRequestName) {
                  return request;
                }

                return typeof updater === "function" ? updater(request) : { ...request, ...updater };
              })
            };
          })
        };
      })
    }));
  }

  function handleRequestFieldChange(field, value) {
    updateActiveRequest((request) => ({ ...request, [field]: value }));
  }

  function updateWsState(requestKey, patch) {
    setWsStates((current) => ({
      ...current,
      [requestKey]: {
        connected: false,
        connecting: false,
        messageCount: 0,
        lastMessage: "",
        lastEventAt: "",
        error: "",
        ...(current[requestKey] || {}),
        ...patch
      }
    }));
  }

  function setRequestLocalMessage(workspaceName, collectionName, requestName, method, url, text, statusText = "Realtime") {
    const savedAt = formatSavedAt();
    updateStore((current) => updateRequestWithLocalResponseByIdentity(current, workspaceName, collectionName, requestName, {
      status: 0,
      badge: statusText,
      statusText,
      duration: "-",
      size: `${new TextEncoder().encode(String(text || "")).length} B`,
      headers: {},
      cookies: [],
      body: String(text || ""),
      rawBody: String(text || ""),
      isJson: isJsonText(String(text || "")),
      meta: {
        url: url || "-",
        method
      },
      savedAt
    }));
  }

  function connectActiveWebSocket() {
    if (!activeRequest || activeRequest.requestMode !== REQUEST_MODES.WEBSOCKET) return;

    const workspaceName = activeWorkspace?.name ?? "";
    const collectionName = activeCollection?.name ?? "";
    const requestName = activeRequest.name;
    const requestMethod = activeRequest.method;

    const requestKey = buildRequestKey(
      workspaceName,
      collectionName,
      requestName
    );

    const existing = wsConnectionsRef.current.get(requestKey);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return;
    }
    if (existing) {
      try {
        existing.close();
      } catch {
      }
      wsConnectionsRef.current.delete(requestKey);
    }

    let finalUrl = "";
    try {
      finalUrl = buildWebSocketUrl(activeRequest.url, activeRequest.queryParams);
    } catch {
      finalUrl = toWebSocketUrl(activeRequest.url);
    }

    if (!finalUrl) {
      updateWsState(requestKey, { connected: false, connecting: false, error: "Enter a valid WebSocket URL." });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Enter a valid WebSocket URL before connecting.", "Connection error");
      return;
    }

    updateWsState(requestKey, { connecting: true, connected: false, error: "" });

    try {
      const socket = new WebSocket(finalUrl);
      wsConnectionsRef.current.set(requestKey, socket);

      socket.onopen = () => {
        updateWsState(requestKey, {
          connecting: false,
          connected: true,
          error: "",
          lastEventAt: formatSavedAt()
        });
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, finalUrl, `Connected to ${finalUrl}`, "Connected");
      };

      socket.onmessage = (event) => {
        const message = String(event?.data ?? "");
        setWsStates((current) => ({
          ...current,
          [requestKey]: {
            connected: true,
            connecting: false,
            messageCount: (current[requestKey]?.messageCount ?? 0) + 1,
            lastMessage: message,
            lastEventAt: formatSavedAt(),
            error: ""
          }
        }));
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, finalUrl, message, "Message received");
      };

      socket.onerror = () => {
        const detail = `Failed to connect to ${finalUrl}. Verify the URL is reachable and the server is running.`;
        updateWsState(requestKey, {
          connecting: false,
          connected: false,
          error: detail,
          lastEventAt: formatSavedAt()
        });
        setRequestLocalMessage(
          workspaceName,
          collectionName,
          requestName,
          requestMethod,
          finalUrl,
          detail,
          "Connection error"
        );
      };

      socket.onclose = (event) => {
        const wasTracked = wsConnectionsRef.current.has(requestKey);
        wsConnectionsRef.current.delete(requestKey);
        updateWsState(requestKey, {
          connecting: false,
          connected: false,
          lastEventAt: formatSavedAt()
        });

        const code = Number(event?.code || 0);
        const reason = String(event?.reason || "").trim();
        const abnormal = code !== 0 && code !== 1000 && code !== 1001;
        if (wasTracked && abnormal) {
          const detail = reason
            ? `WebSocket closed (${code}): ${reason}`
            : `WebSocket closed (${code}). Verify the server at ${finalUrl} is running.`;
          setRequestLocalMessage(
            workspaceName,
            collectionName,
            requestName,
            requestMethod,
            finalUrl,
            detail,
            "Connection error"
          );
        }
      };
    } catch {
      updateWsState(requestKey, {
        connecting: false,
        connected: false,
        error: "Failed to create WebSocket connection"
      });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Failed to create WebSocket connection.", "Connection error");
    }
  }

  function disconnectActiveWebSocket() {
    if (!activeRequest || activeRequest.requestMode !== REQUEST_MODES.WEBSOCKET) return;
    const workspaceName = activeWorkspace?.name ?? "";
    const collectionName = activeCollection?.name ?? "";
    const requestName = activeRequest.name;
    const requestMethod = activeRequest.method;
    const requestKey = buildRequestKey(
      workspaceName,
      collectionName,
      requestName
    );
    const socket = wsConnectionsRef.current.get(requestKey);
    if (socket) {
      try {
        socket.close();
      } catch {
      }
      wsConnectionsRef.current.delete(requestKey);
    }
    updateWsState(requestKey, {
      connected: false,
      connecting: false,
      lastEventAt: formatSavedAt()
    });
    setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Disconnected from WebSocket.", "Disconnected");
  }

  function sendActiveWebSocketMessage() {
    if (!activeRequest) return;

    if (activeRequest.requestMode === REQUEST_MODES.SOCKET_IO) {
      sendActiveSocketIoMessage();
      return;
    }

    if (activeRequest.requestMode !== REQUEST_MODES.WEBSOCKET) return;
    const workspaceName = activeWorkspace?.name ?? "";
    const collectionName = activeCollection?.name ?? "";
    const requestName = activeRequest.name;
    const requestMethod = activeRequest.method;
    const requestKey = buildRequestKey(
      workspaceName,
      collectionName,
      requestName
    );
    const socket = wsConnectionsRef.current.get(requestKey);

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      updateWsState(requestKey, { error: "Connect first before sending a message." });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Connect first before sending a message.", "Send blocked");
      return;
    }

    let payload = String(activeRequest.body ?? "");
    if (activeRequest.bodyType === "json") {
      try {
        payload = JSON.stringify(JSON.parse(payload), null, 2);
      } catch {
        updateWsState(requestKey, { error: "Invalid JSON payload" });
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Invalid JSON payload.", "Send blocked");
        return;
      }
    }

    try {
      socket.send(payload);
      updateWsState(requestKey, {
        error: "",
        lastEventAt: formatSavedAt()
      });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, payload, "Message sent");
    } catch {
      updateWsState(requestKey, { error: "Failed to send WebSocket message" });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Failed to send WebSocket message.", "Send failed");
    }
  }

  function connectActiveSse() {
    if (!activeRequest || activeRequest.requestMode !== REQUEST_MODES.SSE) return;

    const workspaceName = activeWorkspace?.name ?? "";
    const collectionName = activeCollection?.name ?? "";
    const requestName = activeRequest.name;
    const requestMethod = activeRequest.method;
    const requestKey = buildRequestKey(workspaceName, collectionName, requestName);

    const existing = sseConnectionsRef.current.get(requestKey);
    if (existing) {
      try {
        existing.close();
      } catch {
      }
      sseConnectionsRef.current.delete(requestKey);
    }

    const finalUrl = buildSseUrl(activeRequest.url, activeRequest.queryParams);
    if (!finalUrl) {
      updateWsState(requestKey, { connected: false, connecting: false, error: "Enter a valid SSE URL." });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Enter a valid SSE URL before connecting.", "Connection error");
      return;
    }

    updateWsState(requestKey, { connecting: true, connected: false, error: "" });

    try {
      const source = new EventSource(finalUrl, {
        withCredentials: Boolean(activeRequest.sseWithCredentials)
      });
      sseConnectionsRef.current.set(requestKey, source);

      source.onopen = () => {
        updateWsState(requestKey, {
          connecting: false,
          connected: true,
          error: "",
          lastEventAt: formatSavedAt()
        });
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, finalUrl, `Connected to SSE stream at ${finalUrl}`, "Connected");
      };

      source.onmessage = (event) => {
        const message = String(event?.data ?? "");
        setWsStates((current) => ({
          ...current,
          [requestKey]: {
            connected: true,
            connecting: false,
            messageCount: (current[requestKey]?.messageCount ?? 0) + 1,
            lastMessage: message,
            lastEventAt: formatSavedAt(),
            error: ""
          }
        }));
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, finalUrl, message, "Event received");
      };

      source.onerror = () => {
        updateWsState(requestKey, {
          connecting: false,
          connected: false,
          error: `SSE stream error from ${finalUrl}`,
          lastEventAt: formatSavedAt()
        });
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, finalUrl, `SSE stream error from ${finalUrl}`, "Connection error");
      };
    } catch {
      updateWsState(requestKey, {
        connecting: false,
        connected: false,
        error: "Failed to create SSE connection"
      });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Failed to create SSE connection.", "Connection error");
    }
  }

  function disconnectActiveSse() {
    if (!activeRequest || activeRequest.requestMode !== REQUEST_MODES.SSE) return;
    const workspaceName = activeWorkspace?.name ?? "";
    const collectionName = activeCollection?.name ?? "";
    const requestName = activeRequest.name;
    const requestMethod = activeRequest.method;
    const requestKey = buildRequestKey(workspaceName, collectionName, requestName);

    const source = sseConnectionsRef.current.get(requestKey);
    if (source) {
      try {
        source.close();
      } catch {
      }
      sseConnectionsRef.current.delete(requestKey);
    }

    updateWsState(requestKey, {
      connected: false,
      connecting: false,
      lastEventAt: formatSavedAt()
    });
    setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Disconnected from SSE stream.", "Disconnected");
  }

  function connectActiveSocketIo() {
    if (!activeRequest || activeRequest.requestMode !== REQUEST_MODES.SOCKET_IO) return;

    const workspaceName = activeWorkspace?.name ?? "";
    const collectionName = activeCollection?.name ?? "";
    const requestName = activeRequest.name;
    const requestMethod = activeRequest.method;
    const requestKey = buildRequestKey(workspaceName, collectionName, requestName);

    const existing = socketIoConnectionsRef.current.get(requestKey);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return;
    }
    if (existing) {
      try {
        existing.close();
      } catch {
      }
      socketIoConnectionsRef.current.delete(requestKey);
    }

    const finalUrl = buildSocketIoWebSocketUrl(activeRequest.url, activeRequest.queryParams);
    const namespace = String(activeRequest.socketIoNamespace || "/").trim() || "/";
    const normalizedNamespace = namespace.startsWith("/") ? namespace : `/${namespace}`;
    if (!finalUrl) {
      updateWsState(requestKey, { connected: false, connecting: false, error: "Enter a valid Socket.IO URL." });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Enter a valid Socket.IO URL before connecting.", "Connection error");
      return;
    }

    updateWsState(requestKey, { connecting: true, connected: false, error: "" });

    try {
      const socket = new WebSocket(finalUrl);
      socketIoConnectionsRef.current.set(requestKey, socket);

      socket.onopen = () => {
        try {
          const connectPacket = normalizedNamespace === "/" ? "40" : `40${normalizedNamespace},`;
          socket.send(connectPacket);
        } catch {
        }
        updateWsState(requestKey, {
          connecting: false,
          connected: true,
          error: "",
          lastEventAt: formatSavedAt()
        });
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, finalUrl, `Connected to Socket.IO endpoint ${finalUrl}`, "Connected");
      };

      socket.onmessage = (event) => {
        const message = String(event?.data ?? "");
        if (message === "2") {
          try {
            socket.send("3");
          } catch {
          }
        }

        let display = message;
        if (message.startsWith("42")) {
          const payload = message.slice(2);
          try {
            const parsed = JSON.parse(payload);
            display = JSON.stringify(parsed, null, 2);
          } catch {
          }
        }

        setWsStates((current) => ({
          ...current,
          [requestKey]: {
            connected: true,
            connecting: false,
            messageCount: (current[requestKey]?.messageCount ?? 0) + 1,
            lastMessage: display,
            lastEventAt: formatSavedAt(),
            error: ""
          }
        }));
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, finalUrl, display, "Event received");
      };

      socket.onerror = () => {
        const detail = `Failed to connect to Socket.IO at ${finalUrl}. Verify server and transport settings.`;
        updateWsState(requestKey, {
          connecting: false,
          connected: false,
          error: detail,
          lastEventAt: formatSavedAt()
        });
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, finalUrl, detail, "Connection error");
      };

      socket.onclose = (event) => {
        const wasTracked = socketIoConnectionsRef.current.has(requestKey);
        socketIoConnectionsRef.current.delete(requestKey);
        updateWsState(requestKey, {
          connecting: false,
          connected: false,
          lastEventAt: formatSavedAt()
        });

        const code = Number(event?.code || 0);
        const reason = String(event?.reason || "").trim();
        const abnormal = code !== 0 && code !== 1000 && code !== 1001;
        if (wasTracked && abnormal) {
          const detail = reason
            ? `Socket.IO closed (${code}): ${reason}`
            : `Socket.IO closed (${code}). Verify server at ${finalUrl}.`;
          setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, finalUrl, detail, "Connection error");
        }
      };
    } catch {
      updateWsState(requestKey, {
        connecting: false,
        connected: false,
        error: "Failed to create Socket.IO connection"
      });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Failed to create Socket.IO connection.", "Connection error");
    }
  }

  function disconnectActiveSocketIo() {
    if (!activeRequest || activeRequest.requestMode !== REQUEST_MODES.SOCKET_IO) return;
    const workspaceName = activeWorkspace?.name ?? "";
    const collectionName = activeCollection?.name ?? "";
    const requestName = activeRequest.name;
    const requestMethod = activeRequest.method;
    const requestKey = buildRequestKey(workspaceName, collectionName, requestName);

    const socket = socketIoConnectionsRef.current.get(requestKey);
    if (socket) {
      try {
        socket.close();
      } catch {
      }
      socketIoConnectionsRef.current.delete(requestKey);
    }
    updateWsState(requestKey, {
      connected: false,
      connecting: false,
      lastEventAt: formatSavedAt()
    });
    setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Disconnected from Socket.IO.", "Disconnected");
  }

  function sendActiveSocketIoMessage() {
    if (!activeRequest || activeRequest.requestMode !== REQUEST_MODES.SOCKET_IO) return;
    const workspaceName = activeWorkspace?.name ?? "";
    const collectionName = activeCollection?.name ?? "";
    const requestName = activeRequest.name;
    const requestMethod = activeRequest.method;
    const requestKey = buildRequestKey(workspaceName, collectionName, requestName);
    const socket = socketIoConnectionsRef.current.get(requestKey);

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      updateWsState(requestKey, { error: "Connect first before sending a Socket.IO event." });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Connect first before sending a Socket.IO event.", "Send blocked");
      return;
    }

    const eventName = String(activeRequest.socketIoEventName || "message").trim() || "message";
    const namespace = String(activeRequest.socketIoNamespace || "/").trim() || "/";
    const normalizedNamespace = namespace.startsWith("/") ? namespace : `/${namespace}`;
    let payload = String(activeRequest.body ?? "");

    if (activeRequest.bodyType === "json") {
      try {
        payload = JSON.stringify(JSON.parse(payload));
      } catch {
        updateWsState(requestKey, { error: "Invalid JSON payload" });
        setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Invalid JSON payload.", "Send blocked");
        return;
      }
    }

    const normalizedPayload = activeRequest.bodyType === "json"
      ? JSON.parse(payload)
      : payload;
    const packetPrefix = normalizedNamespace === "/" ? "42" : `42${normalizedNamespace},`;
    const packet = `${packetPrefix}${JSON.stringify([eventName, normalizedPayload])}`;

    try {
      socket.send(packet);
      updateWsState(requestKey, {
        error: "",
        lastEventAt: formatSavedAt()
      });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, JSON.stringify([eventName, normalizedPayload], null, 2), "Event sent");
    } catch {
      updateWsState(requestKey, { error: "Failed to send Socket.IO event" });
      setRequestLocalMessage(workspaceName, collectionName, requestName, requestMethod, activeRequest.url, "Failed to send Socket.IO event.", "Send failed");
    }
  }

  function createWorkspaceRecord(values) {
    updateStore((current) => {
      const existingNames = current.workspaces.map(w => w.name);
      const uniqueName = getUniqueName(values.name || "New Workspace", existingNames);
      const workspace = createWorkspace(uniqueName, values.description);

      return {
        ...current,
        activeWorkspaceName: workspace.name,
        activeCollectionName: "",
        activeRequestName: "",
        sidebarTab: "requests",
        workspaces: [...current.workspaces, workspace]
      };
    });
  }

  function importCollectionRecord(workspaceName, importedCollection) {
    updateStore((current) => {
      const workspace = current.workspaces.find((w) => w.name === workspaceName);
      if (!workspace || !importedCollection) return current;

      const existingNames = workspace.collections.map((c) => c.name);
      const nextName = getUniqueName(
        String(importedCollection.name || "Imported Collection").trim() || "Imported Collection",
        existingNames
      );

      const normalizedRequests = Array.isArray(importedCollection.requests)
        ? importedCollection.requests.map((request) => ({
          ...request,
          folderPath: normalizeFolderPath(request.folderPath)
        }))
        : [];

      const folderSet = new Set(
        Array.isArray(importedCollection.folders)
          ? importedCollection.folders.map((path) => normalizeFolderPath(path)).filter(Boolean)
          : []
      );
      for (const request of normalizedRequests) {
        if (request.folderPath) {
          getFolderAncestors(request.folderPath).forEach((path) => folderSet.add(path));
        }
      }

      const orderedRequests = orderRequests(normalizedRequests);
      const nextCollection = {
        ...createCollection(nextName),
        ...importedCollection,
        name: nextName,
        requests: orderedRequests,
        folders: Array.from(folderSet),
        folderSettings: Array.isArray(importedCollection.folderSettings) ? importedCollection.folderSettings : [],
        openRequestNames: orderedRequests[0] ? [orderedRequests[0].name] : [],
      };

      return {
        ...current,
        activeWorkspaceName: workspaceName,
        activeCollectionName: nextCollection.name,
        activeRequestName: nextCollection.requests[0]?.name || "",
        workspaces: current.workspaces.map((ws) => {
          if (ws.name !== workspaceName) return ws;
          return {
            ...ws,
            collections: [...ws.collections, nextCollection]
          };
        })
      };
    });
  }

  function importRequestRecords(workspaceName, collectionName, importedRequests, targetFolderPath = "") {
    const normalizedTargetFolderPath = normalizeFolderPath(targetFolderPath);
    updateStore((current) => {
      const workspace = current.workspaces.find((w) => w.name === workspaceName);
      const collection = workspace?.collections.find((c) => c.name === collectionName);
      if (!collection || !Array.isArray(importedRequests) || importedRequests.length === 0) {
        return current;
      }

      const existingNames = collection.requests.map((request) => request.name);
      const requestsToInsert = importedRequests.map((request) => {
        const name = getUniqueName(String(request?.name || "Imported Request").trim() || "Imported Request", existingNames);
        existingNames.push(name);
        const importedFolderPath = normalizeFolderPath(request?.folderPath);
        const folderPath = normalizedTargetFolderPath || importedFolderPath;
        return {
          ...createRequest(name),
          ...request,
          name,
          folderPath,
        };
      });

      const folderSet = new Set(Array.isArray(collection.folders) ? collection.folders : []);
      for (const req of requestsToInsert) {
        if (req.folderPath) {
          getFolderAncestors(req.folderPath).forEach((path) => folderSet.add(path));
        }
      }

      return {
        ...current,
        activeWorkspaceName: workspaceName,
        activeCollectionName: collectionName,
        activeRequestName: requestsToInsert[0]?.name || current.activeRequestName,
        workspaces: current.workspaces.map((ws) => {
          if (ws.name !== workspaceName) return ws;
          return {
            ...ws,
            collections: ws.collections.map((col) => {
              if (col.name !== collectionName) return col;
              return {
                ...col,
                requests: orderRequests([...(col.requests || []), ...requestsToInsert]),
                folders: Array.from(folderSet),
                openRequestNames: requestsToInsert[0]
                  ? [...(col.openRequestNames || []), requestsToInsert[0].name]
                  : (col.openRequestNames || [])
              };
            })
          };
        })
      };
    });
  }

  function pasteFolderRecord(workspaceName, collectionName, folderSnapshot, targetParentPath = "") {
    const snapshot = folderSnapshot && typeof folderSnapshot === "object" ? folderSnapshot : null;
    if (!snapshot?.rootName) {
      return;
    }

    updateStore((current) => {
      const targetWorkspaceName = workspaceName || current.activeWorkspaceName;
      const workspace = current.workspaces.find((w) => w.name === targetWorkspaceName);
      const targetCollectionName = collectionName || current.activeCollectionName || workspace?.collections?.[0]?.name;
      if (!workspace || !targetCollectionName) {
        return current;
      }

      let nextActiveRequestName = current.activeRequestName;
      const normalizedTargetParent = normalizeFolderPath(targetParentPath);

      const nextWorkspaces = current.workspaces.map((w) => {
        if (w.name !== targetWorkspaceName) return w;
        return {
          ...w,
          collections: w.collections.map((c) => {
            if (c.name !== targetCollectionName) return c;

            const existingFolders = (Array.isArray(c.folders) ? c.folders : []).map((path) => normalizeFolderPath(path));
            const siblingNames = existingFolders
              .filter((path) => getFolderParentPath(path) === normalizedTargetParent)
              .map((path) => getFolderLabel(path));
            const uniqueRootName = getUniqueName(String(snapshot.rootName).trim() || "New Folder", siblingNames);
            const pastedRootPath = normalizeFolderPath(normalizedTargetParent ? `${normalizedTargetParent}/${uniqueRootName}` : uniqueRootName);

            const relativeFolders = Array.isArray(snapshot.folders) ? snapshot.folders : [""];
            const nextFolderSet = new Set(existingFolders);
            relativeFolders.forEach((relativePath) => {
              const normalizedRelative = normalizeFolderPath(relativePath);
              const fullPath = normalizedRelative ? `${pastedRootPath}/${normalizedRelative}` : pastedRootPath;
              nextFolderSet.add(normalizeFolderPath(fullPath));
            });

            const existingRequestNames = c.requests.map((request) => request.name);
            const nextRequests = [...c.requests];
            const pastedRequests = Array.isArray(snapshot.requests) ? snapshot.requests : [];
            pastedRequests.forEach((entry) => {
              const sourceRequest = entry?.request;
              if (!sourceRequest) return;
              const normalizedRelative = normalizeFolderPath(entry.relativePath);
              const fullPath = normalizedRelative ? `${pastedRootPath}/${normalizedRelative}` : pastedRootPath;
              const requestName = getUniqueName(sourceRequest.name || "New Request", existingRequestNames);
              existingRequestNames.push(requestName);
              const cloned = cloneRequest({ ...sourceRequest, name: requestName, folderPath: normalizeFolderPath(fullPath) });
              nextRequests.push(cloned);
              if (!nextActiveRequestName) {
                nextActiveRequestName = cloned.name;
              }
            });

            const existingSettings = Array.isArray(c.folderSettings) ? c.folderSettings : [];
            const settingsByPath = new Map();
            existingSettings.forEach((setting) => {
              settingsByPath.set(normalizeFolderPath(setting.path), {
                ...setting,
                path: normalizeFolderPath(setting.path)
              });
            });

            const pastedSettings = Array.isArray(snapshot.settings) ? snapshot.settings : [];
            pastedSettings.forEach((setting) => {
              const normalizedRelative = normalizeFolderPath(setting?.relativePath);
              const fullPath = normalizedRelative ? `${pastedRootPath}/${normalizedRelative}` : pastedRootPath;
              const normalizedPath = normalizeFolderPath(fullPath);
              settingsByPath.set(normalizedPath, {
                path: normalizedPath,
                defaultHeaders: Array.isArray(setting?.defaultHeaders) ? setting.defaultHeaders.map((row) => ({ ...row })) : [],
                defaultAuth: normalizeAuthState(setting?.defaultAuth ?? { type: "inherit" })
              });
            });

            return {
              ...c,
              folders: Array.from(nextFolderSet),
              folderSettings: Array.from(settingsByPath.values()),
              requests: orderRequests(nextRequests)
            };
          })
        };
      });

      return {
        ...current,
        activeWorkspaceName: targetWorkspaceName,
        activeCollectionName: targetCollectionName,
        activeRequestName: nextActiveRequestName,
        workspaces: nextWorkspaces
      };
    });
  }

  function renameWorkspaceRecord(oldName, values) {
    updateStore((current) => {
      const nextName = values.name.trim();
      if (!nextName) return current;


      if (nextName !== oldName) {
        const existingNames = current.workspaces.map(w => w.name);
        if (existingNames.includes(nextName)) {

          return current;
        }
      }

      return {
        ...current,
        activeWorkspaceName: current.activeWorkspaceName === oldName ? nextName : current.activeWorkspaceName,
        workspaces: current.workspaces.map((workspace) =>
          workspace.name === oldName ? { ...workspace, name: nextName, description: values.description } : workspace
        )
      };
    });
  }

  function deleteWorkspaceRecord(name) {
    updateStore((current) => {
      const nextWorkspaces = current.workspaces.filter((workspace) => workspace.name !== name);
      const nextWorkspace = nextWorkspaces.find((workspace) => workspace.name === current.activeWorkspaceName && workspace.name !== name) ?? nextWorkspaces[0] ?? null;
      const nextCollection = nextWorkspace?.collections?.[0] ?? null;
      const nextRequest = nextCollection?.requests?.[0] ?? null;

      return {
        ...current,
        activeWorkspaceName: nextWorkspace?.name ?? "",
        activeCollectionName: nextCollection?.name ?? "",
        activeRequestName: nextRequest?.name ?? "",
        workspaces: nextWorkspaces
      };
    });
  }

  function createCollectionRecord(workspaceName, name) {
    updateStore((current) => {
      const workspace = current.workspaces.find(w => w.name === workspaceName);
      if (!workspace) return current;

      const existingNames = workspace.collections.map(c => c.name);
      const uniqueName = getUniqueName(name || "New Collection", existingNames);
      const nextCollection = createCollection(uniqueName);

      return {
        ...current,
        activeWorkspaceName: workspaceName,
        activeCollectionName: uniqueName,
        activeRequestName: "",
        workspaces: current.workspaces.map((w) =>
          w.name === workspaceName
            ? { ...w, collections: [...w.collections, nextCollection] }
            : w
        )
      };
    });
  }

  function renameCollectionRecord(workspaceName, oldName, newName) {
    updateStore((current) => {
      const nextName = newName.trim();
      if (!nextName) return current;

      if (nextName !== oldName) {
        const workspace = current.workspaces.find(w => w.name === workspaceName);
        if (workspace?.collections.some(c => c.name === nextName)) {
          return current;
        }
      }

      return {
        ...current,
        activeCollectionName: current.activeCollectionName === oldName ? nextName : current.activeCollectionName,
        workspaces: current.workspaces.map((workspace) =>
          workspace.name === workspaceName
            ? {
              ...workspace,
              collections: workspace.collections.map((c) =>
                c.name === oldName ? { ...c, name: nextName } : c
              )
            }
            : workspace
        )
      };
    });
  }

  function deleteCollectionRecord(workspaceName, name) {
    updateStore((current) => {
      let nextActiveCollectionName = current.activeCollectionName;
      let nextActiveRequestName = current.activeRequestName;

      const nextWorkspaces = current.workspaces.map((workspace) => {
        if (workspace.name !== workspaceName) {
          return workspace;
        }

        const nextCollections = workspace.collections.filter((c) => c.name !== name);
        if (current.activeCollectionName === name) {
          nextActiveCollectionName = nextCollections[0]?.name ?? "";
          nextActiveRequestName = nextCollections[0]?.requests?.[0]?.name ?? "";
        }

        return { ...workspace, collections: nextCollections };
      });

      return {
        ...current,
        activeCollectionName: nextActiveCollectionName,
        activeRequestName: nextActiveRequestName,
        workspaces: nextWorkspaces
      };
    });
  }

  function duplicateCollectionRecord(workspaceName, collectionName, newName) {
    updateStore((current) => {
      let duplicatedName = "";
      const nextWorkspaces = current.workspaces.map((workspace) => {
        if (workspace.name !== workspaceName) return workspace;
        const source = workspace.collections.find((c) => c.name === collectionName);
        if (!source) return workspace;

        const existingNames = workspace.collections.map((c) => c.name);
        const uniqueName = newName ? newName.trim() : getUniqueName(`${source.name} Copy`, existingNames);
        if (newName && existingNames.includes(uniqueName)) return workspace;

        const duplicated = {
          ...source,
          name: uniqueName,
          requests: source.requests.map(r => cloneRequest(r))
        };
        duplicatedName = duplicated.name;

        return {
          ...workspace,
          collections: [...workspace.collections, duplicated]
        };
      });

      return {
        ...current,
        activeCollectionName: duplicatedName || current.activeCollectionName,
        workspaces: nextWorkspaces
      };
    });
  }

  function createFolderRecord(workspaceName, collectionName, folderPath) {
    const nextFolderPath = normalizeFolderPath(folderPath);
    if (!nextFolderPath) {
      return;
    }

    updateStore((current) => {
      const targetWorkspaceName = workspaceName || current.activeWorkspaceName;
      const workspace = current.workspaces.find((w) => w.name === targetWorkspaceName);
      const targetCollectionName = collectionName || current.activeCollectionName || workspace?.collections?.[0]?.name;
      if (!workspace || !targetCollectionName) {
        return current;
      }

      const collection = workspace.collections.find((c) => c.name === targetCollectionName);
      const existingFolders = (Array.isArray(collection?.folders) ? collection.folders : []).map((path) => normalizeFolderPath(path));
      if (existingFolders.includes(nextFolderPath)) {
        return current;
      }

      return {
        ...current,
        activeWorkspaceName: targetWorkspaceName,
        activeCollectionName: targetCollectionName,
        workspaces: current.workspaces.map((w) => {
          if (w.name !== targetWorkspaceName) return w;
          return {
            ...w,
            collections: w.collections.map((c) => {
              if (c.name !== targetCollectionName) return c;
              return {
                ...c,
                folders: [...existingFolders, nextFolderPath]
              };
            })
          };
        })
      };
    });
  }

  function renameFolderRecord(workspaceName, collectionName, oldFolderPath, newFolderName) {
    const oldPath = normalizeFolderPath(oldFolderPath);
    const newName = String(newFolderName ?? "").trim();
    if (!oldPath || !newName) {
      return;
    }

    const parts = oldPath.split("/");
    parts[parts.length - 1] = newName;
    const newPath = normalizeFolderPath(parts.join("/"));
    if (!newPath || newPath === oldPath) {
      return;
    }

    updateStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => {
        if (workspace.name !== workspaceName) return workspace;
        return {
          ...workspace,
          collections: workspace.collections.map((collection) => {
            if (collection.name !== collectionName) return collection;

            const folders = Array.isArray(collection.folders) ? collection.folders.map((path) => normalizeFolderPath(path)) : [];
            if (folders.includes(newPath)) {
              return collection;
            }

            const nextFolders = Array.from(new Set(
              folders.map((path) => renamePathPrefix(path, oldPath, newPath))
            ));

            const nextFolderSettings = (collection.folderSettings || []).map((setting) => ({
              ...setting,
              path: renamePathPrefix(normalizeFolderPath(setting.path), oldPath, newPath)
            }));

            const nextRequests = collection.requests.map((request) => ({
              ...request,
              folderPath: renamePathPrefix(normalizeFolderPath(request.folderPath), oldPath, newPath)
            }));

            return {
              ...collection,
              folders: nextFolders,
              folderSettings: nextFolderSettings,
              requests: nextRequests
            };
          })
        };
      })
    }));
  }

  function deleteFolderRecord(workspaceName, collectionName, folderPath) {
    const targetPath = normalizeFolderPath(folderPath);
    if (!targetPath) {
      return;
    }

    updateStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => {
        if (workspace.name !== workspaceName) return workspace;
        return {
          ...workspace,
          collections: workspace.collections.map((collection) => {
            if (collection.name !== collectionName) return collection;

            const shouldDrop = (path) => path === targetPath || path.startsWith(`${targetPath}/`);

            return {
              ...collection,
              folders: (collection.folders || []).filter((path) => !shouldDrop(normalizeFolderPath(path))),
              folderSettings: (collection.folderSettings || []).filter((setting) => !shouldDrop(normalizeFolderPath(setting.path))),
              requests: collection.requests.map((request) => {
                const requestFolderPath = normalizeFolderPath(request.folderPath);
                if (shouldDrop(requestFolderPath)) {
                  return { ...request, folderPath: "" };
                }
                return request;
              })
            };
          })
        };
      })
    }));
  }

  function updateFolderSettingsRecord(workspaceName, collectionName, folderPath, nextSettings) {
    const targetPath = normalizeFolderPath(folderPath);
    if (!targetPath) {
      return;
    }

    updateStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => {
        if (workspace.name !== workspaceName) return workspace;
        return {
          ...workspace,
          collections: workspace.collections.map((collection) => {
            if (collection.name !== collectionName) return collection;

            const settings = Array.isArray(collection.folderSettings) ? collection.folderSettings : [];
            const normalizedSetting = {
              path: targetPath,
              defaultHeaders: Array.isArray(nextSettings?.defaultHeaders) ? nextSettings.defaultHeaders : [],
              defaultAuth: normalizeAuthState(nextSettings?.defaultAuth ?? { type: "inherit" })
            };

            const exists = settings.some((setting) => normalizeFolderPath(setting.path) === targetPath);
            const nextFolderSettings = exists
              ? settings.map((setting) => (
                normalizeFolderPath(setting.path) === targetPath ? normalizedSetting : setting
              ))
              : [...settings, normalizedSetting];

            const folders = Array.isArray(collection.folders) ? collection.folders : [];
            const nextFolders = folders.includes(targetPath) ? folders : [...folders, targetPath];

            return {
              ...collection,
              folders: nextFolders,
              folderSettings: nextFolderSettings
            };
          })
        };
      })
    }));
  }

  function createRequestRecord(workspaceName, collectionName, name, folderPath = "", requestMode = REQUEST_MODES.HTTP) {
    updateStore((current) => {
      const targetWorkspaceName = workspaceName || current.activeWorkspaceName;
      const workspace = current.workspaces.find(w => w.name === targetWorkspaceName);
      

      const targetCollectionName = collectionName || current.activeCollectionName || workspace?.collections?.[0]?.name;

      if (!targetCollectionName) {
        console.warn("Cannot create request: no collection found in workspace", targetWorkspaceName);
        return current;
      }

      const collection = workspace.collections.find(c => c.name === targetCollectionName);
      const existingNames = collection?.requests.map(r => r.name) || [];
      const baseName = getRequestBaseNameByMode(requestMode);
      const uniqueName = name ? name.trim() : getUniqueName(baseName, existingNames);
      
      if (name && existingNames.includes(uniqueName)) {
        return current;
      }
      
      const nextFolderPath = normalizeFolderPath(folderPath);
      const nextRequest = {
        ...createRequest(uniqueName, requestMode),
        folderPath: nextFolderPath
      };

      return {
        ...current,
        activeWorkspaceName: targetWorkspaceName,
        activeCollectionName: targetCollectionName,
        activeRequestName: nextRequest.name,
        workspaces: current.workspaces.map((workspace) => {
          if (workspace.name !== targetWorkspaceName) return workspace;
          return {
            ...workspace,
            collections: workspace.collections.map((collection) => {
              if (collection.name !== targetCollectionName) return collection;
              const folders = Array.isArray(collection.folders) ? collection.folders : [];
              const nextFolders = nextFolderPath && !folders.includes(nextFolderPath)
                ? [...folders, nextFolderPath]
                : folders;
              return {
                ...collection,
                folders: nextFolders,
                requests: orderRequests([...collection.requests, nextRequest]),
                openRequestNames: [...(collection.openRequestNames || []), nextRequest.name]
              };
            })
          };
        })
      };
    });
  }

  function duplicateRequestRecord(workspaceName, collectionName, requestName, newName) {
    updateStore((current) => {
      let duplicatedName = "";

      const nextWorkspaces = current.workspaces.map((workspace) => {
        if (workspace.name !== workspaceName) return workspace;
        return {
          ...workspace,
          collections: workspace.collections.map((collection) => {
            if (collection.name !== collectionName) return collection;
            const source = collection.requests.find((r) => r.name === requestName);
            if (!source) return collection;

            const existingNames = collection.requests.map(r => r.name);
            const uniqueName = newName ? newName.trim() : getUniqueName(`${source.name} Copy`, existingNames);
            if (newName && existingNames.includes(uniqueName)) return collection;

            const duplicated = cloneRequest({ ...source, name: uniqueName });
            duplicatedName = duplicated.name;

            return {
              ...collection,
              requests: orderRequests([...collection.requests, duplicated]),
              openRequestNames: [...(collection.openRequestNames || []), duplicated.name]
            };
          })
        };
      });

      return {
        ...current,
        activeRequestName: duplicatedName || current.activeRequestName,
        workspaces: nextWorkspaces
      };
    });
  }

  function pasteRequestRecord(workspaceName, collectionName, request, folderPath = "") {
    updateStore((current) => {
      const targetWorkspaceName = workspaceName || current.activeWorkspaceName;
      const workspace = current.workspaces.find(w => w.name === targetWorkspaceName);
      const targetCollectionName = collectionName || current.activeCollectionName || workspace?.collections?.[0]?.name;

      if (!targetCollectionName) return current;

      const collection = workspace.collections.find(c => c.name === targetCollectionName);
      const existingNames = collection?.requests.map(r => r.name) || [];
      const uniqueName = getUniqueName(request.name, existingNames);
      const nextFolderPath = normalizeFolderPath(folderPath);

      const pastedRequest = cloneRequest({ ...request, name: uniqueName, folderPath: nextFolderPath });

      return {
        ...current,
        activeWorkspaceName: targetWorkspaceName,
        activeCollectionName: targetCollectionName,
        activeRequestName: pastedRequest.name,
        workspaces: current.workspaces.map((w) => {
          if (w.name !== targetWorkspaceName) return w;
          return {
            ...w,
            collections: w.collections.map((c) => {
              if (c.name !== targetCollectionName) return c;
              const folders = Array.isArray(c.folders) ? c.folders : [];
              const nextFolders = nextFolderPath && !folders.includes(nextFolderPath)
                ? [...folders, nextFolderPath]
                : folders;
              return {
                ...c,
                folders: nextFolders,
                requests: orderRequests([...c.requests, pastedRequest]),
                openRequestNames: [...(c.openRequestNames || []), pastedRequest.name]
              };
            })
          };
        })
      };
    });
  }

  function renameRequestRecord(workspaceName, collectionName, oldName, nextName) {
    updateStore((current) => {
      const targetName = nextName.trim();
      if (!targetName) return current;

      if (targetName !== oldName) {
        const workspace = current.workspaces.find(w => w.name === workspaceName);
        const collection = workspace?.collections.find(c => c.name === collectionName);
        if (collection?.requests.some(r => r.name === targetName)) {
          return current;
        }
      }

      return {
        ...current,
        activeRequestName: current.activeRequestName === oldName ? targetName : current.activeRequestName,
        workspaces: current.workspaces.map((workspace) => {
          if (workspace.name !== workspaceName) return workspace;
          return {
            ...workspace,
            collections: workspace.collections.map((collection) => {
              if (collection.name !== collectionName) return collection;
              return {
                ...collection,
                requests: collection.requests.map((r) =>
                  r.name === oldName ? { ...r, name: targetName } : r
                ),
                openRequestNames: (collection.openRequestNames || []).map((n) => n === oldName ? targetName : n)
              };
            })
          };
        })
      };
    });
  }

  function deleteRequestRecord(workspaceName, collectionName, requestName) {
    updateStore((current) => {
      let nextActiveRequestName = current.activeRequestName;

      const nextWorkspaces = current.workspaces.map((workspace) => {
        if (workspace.name !== workspaceName) return workspace;
        return {
          ...workspace,
          collections: workspace.collections.map((collection) => {
            if (collection.name !== collectionName) return collection;
            const nextRequests = collection.requests.filter((r) => r.name !== requestName);
            const nextOpenNames = (collection.openRequestNames || []).filter((n) => n !== requestName);

            if (current.activeRequestName === requestName) {
              nextActiveRequestName = nextOpenNames[0] ?? "";
            }

            return {
              ...collection,
              requests: nextRequests,
              openRequestNames: nextOpenNames
            };
          })
        };
      });

      return {
        ...current,
        activeRequestName: nextActiveRequestName,
        workspaces: nextWorkspaces
      };
    });
  }

  function selectWorkspace(name) {
    updateStore((current) => {
      const workspace = current.workspaces.find((w) => w.name === name) ?? current.workspaces[0] ?? null;
      const firstCol = workspace?.collections?.[0] ?? null;
      const firstReq = firstCol?.requests?.[0] ?? null;

      return {
        ...current,
        activeWorkspaceName: workspace?.name ?? "",
        activeCollectionName: firstCol?.name ?? "",
        activeRequestName: firstReq?.name ?? "",
        sidebarTab: "requests",
        workspaces: current.workspaces.map((w) => {
          if (w.name !== workspace?.name || !firstCol || !firstReq) return w;
          return {
            ...w,
            collections: w.collections.map((c) => {
              if (c.name !== firstCol.name) return c;
              const openNames = Array.isArray(c.openRequestNames) ? c.openRequestNames : [];
              if (openNames.includes(firstReq.name)) return c;
              return { ...c, openRequestNames: [...openNames, firstReq.name] };
            })
          };
        })
      };
    });
  }

  function selectCollection(workspaceName, collectionName) {
    updateStore((current) => ({
      ...current,
      activeWorkspaceName: workspaceName,
      activeCollectionName: collectionName,
      activeRequestName: ""
    }));
  }

  function selectRequest(workspaceName, collectionName, requestName) {
    updateStore((current) => ({
      ...current,
      activeWorkspaceName: workspaceName,
      activeCollectionName: collectionName,
      activeRequestName: requestName,
      sidebarTab: "requests",
      workspaces: current.workspaces.map((workspace) => {
        if (workspace.name !== workspaceName) return workspace;
        return {
          ...workspace,
          collections: workspace.collections.map((collection) => {
            if (collection.name !== collectionName) return collection;
            const openNames = Array.isArray(collection.openRequestNames) ? collection.openRequestNames : [];
            if (openNames.includes(requestName)) return collection;
            return {
              ...collection,
              openRequestNames: [...openNames, requestName]
            };
          })
        };
      })
    }));
  }

  function togglePinRequestRecord(workspaceName, collectionName, requestName) {
    updateStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => {
        if (workspace.name !== workspaceName) return workspace;
        return {
          ...workspace,
          collections: workspace.collections.map((collection) => {
            if (collection.name !== collectionName) return collection;
            return {
              ...collection,
              requests: orderRequests(
                collection.requests.map((r) =>
                  r.name === requestName ? { ...r, pinned: !r.pinned } : r
                )
              )
            };
          })
        };
      })
    }));
  }

  function closeRequestTab(requestName) {
    if (!activeCollection) return;

    updateStore((current) => {
      let nextActiveRequestName = current.activeRequestName;

      const nextWorkspaces = current.workspaces.map((workspace) => {
        if (workspace.name !== current.activeWorkspaceName) return workspace;
        return {
          ...workspace,
          collections: workspace.collections.map((collection) => {
            if (collection.name !== current.activeCollectionName) return collection;
            const nextOpenNames = (collection.openRequestNames || []).filter((n) => n !== requestName);
            if (current.activeRequestName === requestName) {
              nextActiveRequestName = nextOpenNames[0] ?? "";
            }
            return { ...collection, openRequestNames: nextOpenNames };
          })
        };
      });

      return {
        ...current,
        activeRequestName: nextActiveRequestName,
        workspaces: nextWorkspaces
      };
    });
  }

  async function handleSend() {
    if (!activeRequest) {
      console.warn("No active request to send");
      return;
    }

    if (activeRequest.requestMode === REQUEST_MODES.WEBSOCKET) {
      const requestKey = buildRequestKey(
        activeWorkspace?.name ?? "",
        activeCollection?.name ?? "",
        activeRequest.name
      );
      const wsState = wsStates[requestKey] ?? { connected: false, connecting: false };
      if (wsState.connected || wsState.connecting) {
        disconnectActiveWebSocket();
      } else {
        connectActiveWebSocket();
      }
      return;
    }

    if (activeRequest.requestMode === REQUEST_MODES.SOCKET_IO) {
      const requestKey = buildRequestKey(
        activeWorkspace?.name ?? "",
        activeCollection?.name ?? "",
        activeRequest.name
      );
      const wsState = wsStates[requestKey] ?? { connected: false, connecting: false };
      if (wsState.connected || wsState.connecting) {
        disconnectActiveSocketIo();
      } else {
        connectActiveSocketIo();
      }
      return;
    }

    if (activeRequest.requestMode === REQUEST_MODES.SSE) {
      const requestKey = buildRequestKey(
        activeWorkspace?.name ?? "",
        activeCollection?.name ?? "",
        activeRequest.name
      );
      const wsState = wsStates[requestKey] ?? { connected: false, connecting: false };
      if (wsState.connected || wsState.connecting) {
        disconnectActiveSse();
      } else {
        connectActiveSse();
      }
      return;
    }

    if (activeRequest.requestMode === REQUEST_MODES.GRPC) {
      const resolvedUrl = normalizeUrl(activeRequest.url || "");
      if (!resolvedUrl) {
        const savedAt = formatSavedAt();
        const message = "Enter a valid gRPC server URL before sending.";
        updateStore((current) => updateRequestWithLocalResponse(current, activeRequest.name, {
          status: 0,
          badge: "Request warning",
          statusText: "Request warning",
          duration: "-",
          size: "0 B",
          headers: {},
          cookies: [],
          body: message,
          rawBody: message,
          isJson: false,
          meta: {
            url: activeRequest.url || "-",
            method: activeRequest.method
          },
          savedAt
        }));
        return;
      }

      if (!String(activeRequest.grpcProtoFilePath || "").trim()) {
        const savedAt = formatSavedAt();
        const message = "Select a .proto file before sending a gRPC request.";
        updateStore((current) => updateRequestWithLocalResponse(current, activeRequest.name, {
          status: 0,
          badge: "Request warning",
          statusText: "Request warning",
          duration: "-",
          size: "0 B",
          headers: {},
          cookies: [],
          body: message,
          rawBody: message,
          isJson: false,
          meta: {
            url: resolvedUrl,
            method: activeRequest.method
          },
          savedAt
        }));
        return;
      }

      if (!String(activeRequest.grpcMethodPath || "").trim()) {
        const savedAt = formatSavedAt();
        const message = "Select a gRPC method before sending.";
        updateStore((current) => updateRequestWithLocalResponse(current, activeRequest.name, {
          status: 0,
          badge: "Request warning",
          statusText: "Request warning",
          duration: "-",
          size: "0 B",
          headers: {},
          cookies: [],
          body: message,
          rawBody: message,
          isJson: false,
          meta: {
            url: resolvedUrl,
            method: activeRequest.method
          },
          savedAt
        }));
        return;
      }

      const requestId = `grpc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      activeHttpRequestIdRef.current = requestId;
      setIsSending(true);
      setSendStartedAt(Date.now());

      try {
        const result = await sendGrpcRequest({
          requestId,
          url: resolvedUrl,
          grpcProtoFilePath: activeRequest.grpcProtoFilePath,
          grpcMethodPath: activeRequest.grpcMethodPath,
          grpcStreamingMode: activeRequest.grpcStreamingMode || "bidi",
          headers: serializeHeaders(activeRequest.headers ?? [], { type: "none" }, "none", ""),
          body: String(activeRequest.body || ""),
          workspaceName: activeWorkspace?.name ?? "",
          collectionName: activeCollection?.name ?? ""
        });

        if (activeHttpRequestIdRef.current !== requestId) {
          return;
        }

        const rawBody = String(result?.body || "");
        const formattedBody = formatResponseBody(rawBody);
        const bodySize = new TextEncoder().encode(rawBody).length;
        const responseIsJson = isJsonText(rawBody);
        const savedAt = formatSavedAt();
        const statusCode = Number(result?.status || 0);
        const statusText = String(result?.statusText || "OK");
        const savedResponse = {
          status: statusCode,
          badge: `${statusCode} ${statusText}`,
          statusText: `${statusCode} ${statusText}`,
          duration: `${Number(result?.durationMs || 0)} ms`,
          size: `${bodySize} B`,
          headers: result?.headers || {},
          cookies: [],
          body: formattedBody,
          rawBody,
          isJson: responseIsJson,
          meta: {
            url: resolvedUrl,
            method: activeRequest.grpcMethodPath
          },
          savedAt
        };

        updateStore((current) => ({
          ...current,
          workspaces: current.workspaces.map((workspace) => {
            if (workspace.name !== current.activeWorkspaceName) return workspace;
            return {
              ...workspace,
              collections: workspace.collections.map((collection) => {
                if (collection.name !== current.activeCollectionName) return collection;
                return {
                  ...collection,
                  requests: collection.requests.map((request) =>
                    request.name === activeRequest.name
                      ? {
                        ...request,
                        responseBodyView: responseIsJson ? "JSON" : "Raw",
                        lastResponse: savedResponse
                      }
                      : request
                  )
                };
              })
            };
          })
        }));
      } catch (error) {
        if (activeHttpRequestIdRef.current !== requestId) {
          return;
        }

        const message = error?.toString?.() || "gRPC request failed";
        const savedAt = formatSavedAt();
        updateStore((current) => updateRequestWithLocalResponse(current, activeRequest.name, {
          status: 500,
          badge: "Failed",
          statusText: "Request failed",
          duration: "-",
          size: "0 B",
          headers: {},
          cookies: [],
          body: message,
          rawBody: message,
          isJson: false,
          meta: {
            url: resolvedUrl,
            method: activeRequest.grpcMethodPath
          },
          savedAt
        }));
      } finally {
        if (activeHttpRequestIdRef.current === requestId) {
          activeHttpRequestIdRef.current = "";
          setIsSending(false);
          setSendStartedAt(0);
        }
      }

      return;
    }

    let finalUrl = "";
    try {
      finalUrl = buildUrlWithParams(activeRequest.url, activeRequest.queryParams);
    } catch (error) {
      console.error("Failed to build URL:", error);
    }

    if (!finalUrl) {
      updateStore((current) => ({
        ...current,
        workspaces: current.workspaces.map((workspace) => {
          if (workspace.name !== current.activeWorkspaceName) return workspace;
          return {
            ...workspace,
            collections: workspace.collections.map((collection) => {
              if (collection.name !== current.activeCollectionName) return collection;
              return {
                ...collection,
                requests: collection.requests.map((request) =>
                  request.name === activeRequest.name
                    ? {
                        ...request,
                        responseBodyView: "Raw",
                        lastResponse: {
                          status: 0,
                          badge: "Request warning",
                          statusText: "Request warning",
                          duration: "-",
                          size: "0 B",
                          headers: {},
                          cookies: [],
                          body: "Enter a valid URL before sending the request.",
                          rawBody: "Enter a valid URL before sending the request.",
                          isJson: false,
                          meta: { url: activeRequest.url || "-", method: activeRequest.method },
                          savedAt: formatSavedAt()
                        }
                      }
                    : request
                )
              };
            })
          };
        })
      }));
      return;
    }

    const requestId = `http-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activeHttpRequestIdRef.current = requestId;
    setIsSending(true);
    setSendStartedAt(Date.now());

    try {
      const folderHeaderRows = resolveFolderHeaderRows(activeCollection, activeRequest.folderPath);
      const resolvedFolderAuth = resolveFolderAuth(activeCollection, activeRequest.folderPath);
      const effectiveRequest = {
        ...activeRequest,
        headers: [...folderHeaderRows, ...(activeRequest.headers || [])],
        auth: activeRequest?.auth?.type === "inherit" ? resolvedFolderAuth : activeRequest.auth
      };

      const requestPayload = buildRequestPayload(
        effectiveRequest,
        activeWorkspace?.name ?? "",
        activeCollection?.name ?? ""
      );
      const result = await sendHttpRequest({ ...requestPayload, requestId });

      if (activeHttpRequestIdRef.current !== requestId) {
        return;
      }

      const rawBody = result.body || "";
      const formattedBody = formatResponseBody(rawBody);
      const bodySize = new TextEncoder().encode(rawBody).length;
      const responseIsJson = isJsonText(rawBody);
      const savedAt = formatSavedAt();
      const savedResponse = {
        status: result.status,
        badge: `${result.status} ${result.statusText}`,
        statusText: `${result.status} ${result.statusText}`,
        duration: `${result.durationMs} ms`,
        size: `${bodySize} B`,
        headers: result.headers,
        cookies: parseCookies(result.headers),
        body: formattedBody,
        rawBody,
        isJson: responseIsJson,
        meta: {
          url: finalUrl,
          method: activeRequest.method
        },
        savedAt
      };

      updateStore((current) => ({
        ...current,
        workspaces: current.workspaces.map((workspace) => {
          if (workspace.name !== current.activeWorkspaceName) return workspace;
          return {
            ...workspace,
            collections: workspace.collections.map((collection) => {
              if (collection.name !== current.activeCollectionName) return collection;
              return {
                ...collection,
                requests: collection.requests.map((request) =>
                  request.name === activeRequest.name
                    ? {
                      ...request,
                      url: normalizeUrl(request.url),
                      responseBodyView: responseIsJson ? "JSON" : "Raw",
                      lastResponse: savedResponse
                    }
                    : request
                )
              };
            })
          };
        })
      }));
    } catch (error) {
      if (activeHttpRequestIdRef.current !== requestId) {
        return;
      }

      const message = error?.toString?.() || "Request failed";

      const savedAt = formatSavedAt();
      const savedResponse = {
        status: 500,
        badge: "Failed",
        statusText: "Request failed",
        duration: "-",
        size: "0 B",
        headers: {},
        cookies: [],
        body: message,
        rawBody: message,
        isJson: false,
        meta: {
          url: finalUrl,
          method: activeRequest.method
        },
        savedAt
      };

      updateStore((current) => ({
        ...current,
        workspaces: current.workspaces.map((workspace) => {
          if (workspace.name !== current.activeWorkspaceName) return workspace;
          return {
            ...workspace,
            collections: workspace.collections.map((collection) => {
              if (collection.name !== current.activeCollectionName) return collection;
              return {
                ...collection,
                requests: collection.requests.map((request) =>
                  request.name === activeRequest.name
                    ? { ...request, responseBodyView: "Raw", lastResponse: savedResponse }
                    : request
                )
              };
            })
          };
        })
      }));
    } finally {
      if (activeHttpRequestIdRef.current === requestId) {
        activeHttpRequestIdRef.current = "";
        setIsSending(false);
        setSendStartedAt(0);
      }
    }
  }

  async function cancelSend() {
    const requestId = activeHttpRequestIdRef.current;
    if (!requestId) {
      setIsSending(false);
      setSendStartedAt(0);
      return;
    }

    activeHttpRequestIdRef.current = "";
    setIsSending(false);
    setSendStartedAt(0);

    try {
      await cancelHttpRequest(requestId);
    } catch {
    }
  }

  return {
    store,
    isSending,
    sendStartedAt,
    isHydrated,
    isSetupComplete,
    starCount,
    saveTimerRef,
    resizeRef,
    activeWorkspace,
    activeCollection,
    activeRequest,
    requestTabs,
    response,
    activeWebSocketState: activeRequest
      ? (wsStates[buildRequestKey(activeWorkspace?.name ?? "", activeCollection?.name ?? "", activeRequest.name)] || {
        connected: false,
        connecting: false,
        messageCount: 0,
        lastMessage: "",
        lastEventAt: "",
        error: ""
      })
      : {
        connected: false,
        connecting: false,
        messageCount: 0,
        lastMessage: "",
        lastEventAt: "",
        error: ""
      },
    SIDEBAR_COLLAPSED_WIDTH,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_REOPEN_WIDTH,
    updateStore,
    handleSidebarTabChange,
    updateActiveRequest,
    handleRequestFieldChange,
    createWorkspaceRecord,
    renameWorkspaceRecord,
    deleteWorkspaceRecord,
    createCollectionRecord,
    renameCollectionRecord,
    deleteCollectionRecord,
    duplicateCollectionRecord,
    importCollectionRecord,
    importRequestRecords,
    createFolderRecord,
    renameFolderRecord,
    deleteFolderRecord,
    updateFolderSettingsRecord,
    createRequestRecord,
    duplicateRequestRecord,
    pasteRequestRecord,
    pasteFolderRecord,
    renameRequestRecord,
    deleteRequestRecord,
    selectWorkspace,
    selectCollection,
    selectRequest,
    togglePinRequestRecord,
    closeRequestTab,
    handleSend,
    connectActiveWebSocket,
    disconnectActiveWebSocket,
    sendActiveWebSocketMessage,
    cancelSend,
    checkSetup: async () => {
      try {
        const config = await invoke("get_app_config");
        setIsSetupComplete(!!config.storagePath);
      } catch (error) {
        console.error("Failed to check setup status:", error);
      }
    },
  };
}
