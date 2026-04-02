import { useEffect, useMemo, useRef, useState } from "react";
import { Github, Pin, Plus, Sparkles, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { RequestPane } from "@/components/workspace/RequestPane.jsx";
import { ResponsePane } from "@/components/workspace/ResponsePane.jsx";
import { Sidebar } from "@/components/workspace/Sidebar.jsx";
import { ThemeToggle } from "@/components/workspace/ThemeToggle.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { formatResponseBody, isJsonText } from "@/lib/formatters.js";
import { loadAppState, saveAppState, sendHttpRequest } from "@/lib/http-client.js";
import { buildRequestPayload, buildUrlWithParams, getMethodTone, normalizeUrl, serializeHeaders } from "@/lib/http-ui.js";
import { useTheme } from "@/hooks/use-theme.js";
import { cn } from "@/lib/utils.js";
import {
  cloneRequest,
  createDefaultStore,
  createEmptyResponse,
  createId,
  createRequest,
  createWorkspace,
  formatSavedAt,
  getActiveRequest,
  getActiveWorkspace,
  normalizeRequestRecord,
  orderRequests
} from "@/lib/workspace-store.js";

const SIDEBAR_COLLAPSED_WIDTH = 52;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_REOPEN_WIDTH = 260;

function parseCookies(headers) {
  const cookieHeader = Object.entries(headers).find(([key]) => key.toLowerCase() === "set-cookie");

  if (!cookieHeader) {
    return [];
  }

  return String(cookieHeader[1])
    .split(",")
    .map((cookie) => cookie.trim())
    .filter(Boolean);
}

function clampSidebarWidth(value) {
  return Math.min(420, Math.max(SIDEBAR_MIN_WIDTH, value));
}

function createHistoryFingerprint({ method, url, headers, body }) {
  const orderedHeaders = Object.entries(headers || {}).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({ method, url, headers: orderedHeaders, body: body ?? "" });
}

function normalizeStore(store) {
  const fallback = createDefaultStore();
  const nextStore = store && typeof store === "object" ? store : fallback;
  const workspaces = Array.isArray(nextStore.workspaces)
    ? nextStore.workspaces.map((workspace) => ({
      ...workspace,
      requests: orderRequests((workspace.requests ?? []).map((request) => normalizeRequestRecord(request))),
      history: Array.isArray(workspace.history) ? workspace.history : [],
      openRequestIds: Array.isArray(workspace.openRequestIds) ? workspace.openRequestIds : (workspace.requests ?? []).map((request) => request.id)
    }))
    : [];
  const activeWorkspace = workspaces.find((workspace) => workspace.id === nextStore.activeWorkspaceId) ?? workspaces[0] ?? null;
  const activeRequest = activeWorkspace?.requests?.find((request) => request.id === nextStore.activeRequestId && activeWorkspace.openRequestIds.includes(request.id)) ?? null;

  return {
    version: 1,
    sidebarTab: nextStore.sidebarTab === "history" ? "history" : "requests",
    sidebarCollapsed: Boolean(nextStore.sidebarCollapsed),
    activeWorkspaceId: activeWorkspace?.id ?? "",
    activeRequestId: activeRequest?.id ?? "",
    sidebarWidth: clampSidebarWidth(Number(nextStore.sidebarWidth || fallback.sidebarWidth)),
    workspaces
  };
}

function EmptyCanvas({ hasWorkspace, onCreateRequest, onCreateWorkspace }) {
  return (
    <div className="grid min-h-0 place-items-center bg-card/20 p-6">
      <div className="max-w-[420px] text-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {hasWorkspace ? "No requests yet" : "No workspace yet"}
        </div>
        <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-foreground lg:text-[24px]">
          {hasWorkspace ? "Create your first request in this workspace" : "Create a workspace to get started"}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground lg:text-[14px]">
          {hasWorkspace
            ? "Kivo is ready, but this workspace is empty right now. Add a request from the sidebar or here."
            : "Start with your own workspace and build it the way you want."}
        </p>
        <div className="mt-5">
          {hasWorkspace ? (
            <Button type="button" className="h-9 px-4 text-[12px] lg:h-10 lg:px-5 lg:text-[13px]" onClick={onCreateRequest}>
              New request
            </Button>
          ) : (
            <Button type="button" className="h-9 px-4 text-[12px] lg:h-10 lg:px-5 lg:text-[13px]" onClick={onCreateWorkspace}>
              Create workspace
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [store, setStore] = useState(createDefaultStore());
  const [isSending, setIsSending] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [starCount, setStarCount] = useState(null);
  const saveTimerRef = useRef(null);
  const resizeRef = useRef({ active: false, startX: 0, startWidth: 304 });

  const activeWorkspace = useMemo(() => getActiveWorkspace(store), [store]);
  const activeRequest = useMemo(() => getActiveRequest(store), [store]);
  const version = "0.1.1";
  const requestTabs = useMemo(() => {
    if (!activeWorkspace) {
      return [];
    }

    const openIds = new Set(activeWorkspace.openRequestIds || []);
    return activeWorkspace.requests.filter((request) => openIds.has(request.id));
  }, [activeWorkspace]);
  const response = activeRequest?.lastResponse ?? createEmptyResponse();

  useEffect(() => {
    async function fetchStars() {
      try {
        const res = await fetch("https://api.github.com/repos/dexter-xD/Kivo");
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
  }, []);

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
      saveAppState(store).catch(() => { });
    }, 300);

    return () => {
      window.clearTimeout(saveTimerRef.current);
    };
  }, [isHydrated, store]);

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
        if (workspace.id !== current.activeWorkspaceId) {
          return workspace;
        }

        return {
          ...workspace,
          requests: workspace.requests.map((request) => {
            if (request.id !== current.activeRequestId) {
              return request;
            }

            return typeof updater === "function" ? updater(request) : { ...request, ...updater };
          })
        };
      })
    }));
  }

  function handleRequestFieldChange(field, value) {
    updateActiveRequest((request) => ({ ...request, [field]: value }));
  }

  function createWorkspaceRecord(values) {
    const workspace = createWorkspace(values.name, values.description);

    updateStore((current) => ({
      ...current,
      activeWorkspaceId: workspace.id,
      activeRequestId: "",
      sidebarTab: "requests",
      workspaces: [...current.workspaces, workspace]
    }));
  }

  function renameWorkspaceRecord(workspaceId, values) {
    updateStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, name: values.name, description: values.description } : workspace
      )
    }));
  }

  function deleteWorkspaceRecord(workspaceId) {
    updateStore((current) => {
      const nextWorkspaces = current.workspaces.filter((workspace) => workspace.id !== workspaceId);
      const nextWorkspace = nextWorkspaces.find((workspace) => workspace.id === current.activeWorkspaceId && workspace.id !== workspaceId) ?? nextWorkspaces[0] ?? null;
      const nextRequest = nextWorkspace?.requests?.[0] ?? null;

      return {
        ...current,
        activeWorkspaceId: nextWorkspace?.id ?? "",
        activeRequestId: nextRequest?.id ?? "",
        workspaces: nextWorkspaces
      };
    });
  }

  function createRequestRecord(workspaceId) {
    if (!workspaceId) {
      return;
    }

    const nextRequest = createRequest();

    updateStore((current) => ({
      ...current,
      activeWorkspaceId: workspaceId,
      activeRequestId: nextRequest.id,
      sidebarTab: "requests",
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? {
            ...workspace,
            requests: orderRequests([...workspace.requests, nextRequest]),
            openRequestIds: [...(Array.isArray(workspace.openRequestIds) ? workspace.openRequestIds : []), nextRequest.id]
          }
          : workspace
      )
    }));
  }

  function duplicateRequestRecord(workspaceId, requestId) {
    updateStore((current) => {
      let duplicatedRequestId = current.activeRequestId;

      const nextWorkspaces = current.workspaces.map((workspace) => {
        if (workspace.id !== workspaceId) {
          return workspace;
        }

        const sourceRequest = workspace.requests.find((request) => request.id === requestId);

        if (!sourceRequest) {
          return workspace;
        }

        const duplicated = cloneRequest(sourceRequest);
        duplicatedRequestId = duplicated.id;

        return {
          ...workspace,
          requests: orderRequests([...workspace.requests, duplicated]),
          openRequestIds: [...(Array.isArray(workspace.openRequestIds) ? workspace.openRequestIds : []), duplicated.id]
        };
      });

      return {
        ...current,
        activeWorkspaceId: workspaceId,
        activeRequestId: duplicatedRequestId,
        workspaces: nextWorkspaces
      };
    });
  }

  function renameRequestRecord(workspaceId, requestId, name) {
    updateStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? {
            ...workspace,
            requests: workspace.requests.map((request) =>
              request.id === requestId ? { ...request, name } : request
            ),
            history: workspace.history.map((entry) =>
              entry.requestId === requestId ? { ...entry, requestName: name } : entry
            )
          }
          : workspace
      )
    }));
  }

  function deleteRequestRecord(workspaceId, requestId) {
    updateStore((current) => {
      let nextActiveRequestId = current.activeRequestId;

      const nextWorkspaces = current.workspaces.map((workspace) => {
        if (workspace.id !== workspaceId) {
          return workspace;
        }

        const nextRequests = workspace.requests.filter((request) => request.id !== requestId);
        const nextOpenIds = (workspace.openRequestIds || []).filter((id) => id !== requestId);

        if (current.activeRequestId === requestId) {
          nextActiveRequestId = nextOpenIds[0] ?? "";
        }

        return {
          ...workspace,
          requests: nextRequests,
          openRequestIds: nextOpenIds,
          history: workspace.history.filter((entry) => entry.requestId !== requestId)
        };
      });

      return {
        ...current,
        activeWorkspaceId: workspaceId,
        activeRequestId: nextActiveRequestId,
        workspaces: nextWorkspaces
      };
    });
  }

  function selectWorkspace(workspaceId) {
    updateStore((current) => {
      const workspace = current.workspaces.find((item) => item.id === workspaceId) ?? current.workspaces[0] ?? null;
      const firstRequest = workspace?.requests?.[0] ?? null;
      const openIds = workspace?.openRequestIds || [];
      const nextOpenIds = firstRequest && !openIds.includes(firstRequest.id) ? [...openIds, firstRequest.id] : openIds;

      return {
        ...current,
        activeWorkspaceId: workspace?.id ?? "",
        activeRequestId: firstRequest?.id ?? "",
        sidebarTab: "requests",
        workspaces: current.workspaces.map((ws) =>
          ws.id === workspace?.id ? { ...ws, openRequestIds: nextOpenIds } : ws
        )
      };
    });
  }

  function selectRequest(workspaceId, requestId) {
    updateStore((current) => ({
      ...current,
      activeWorkspaceId: workspaceId,
      activeRequestId: requestId,
      sidebarTab: "requests",
      workspaces: current.workspaces.map((workspace) => {
        if (workspace.id !== workspaceId) {
          return workspace;
        }

        const openIds = Array.isArray(workspace.openRequestIds) ? workspace.openRequestIds : [];

        if (openIds.includes(requestId)) {
          return workspace;
        }

        return {
          ...workspace,
          openRequestIds: [...openIds, requestId]
        };
      })
    }));
  }

  function togglePinRequestRecord(workspaceId, requestId) {
    updateStore((current) => ({
      ...current,
      activeWorkspaceId: workspaceId,
      activeRequestId: requestId,
      sidebarTab: "requests",
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? {
            ...workspace,
            requests: orderRequests(
              workspace.requests.map((request) =>
                request.id === requestId ? { ...request, pinned: !request.pinned } : request
              )
            )
          }
          : workspace
      )
    }));
  }

  function clearAllHistoryRecords() {
    updateStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => ({
        ...workspace,
        history: []
      }))
    }));
  }

  function deleteHistoryRecord(workspaceId, historyId) {
    updateStore((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, history: workspace.history.filter((entry) => entry.id !== historyId) }
          : workspace
      )
    }));
  }

  function closeRequestTab(requestId) {
    if (!activeWorkspace) {
      return;
    }

    updateStore((current) => {
      let nextActiveRequestId = current.activeRequestId;

      const nextWorkspaces = current.workspaces.map((workspace) => {
        if (workspace.id !== activeWorkspace.id) {
          return workspace;
        }

        const nextOpenIds = (workspace.openRequestIds || []).filter((id) => id !== requestId);

        if (current.activeRequestId === requestId) {
          nextActiveRequestId = nextOpenIds[0] ?? "";
        }

        return {
          ...workspace,
          openRequestIds: nextOpenIds
        };
      });

      return {
        ...current,
        activeRequestId: nextActiveRequestId,
        workspaces: nextWorkspaces
      };
    });
  }

  async function handleSend() {
    if (!activeRequest) {
      console.warn("No active request to send");
      return;
    }

    let finalUrl = "";
    try {
      finalUrl = buildUrlWithParams(activeRequest.url, activeRequest.queryParams);
    } catch (error) {
      console.error("Failed to build URL:", error);
    }

    if (!finalUrl) {
      console.warn("No URL provided or URL is invalid");
      return;
    }

    setIsSending(true);

    try {
      const requestPayload = buildRequestPayload(activeRequest);
      const historyFingerprint = createHistoryFingerprint({
        method: activeRequest.method,
        url: finalUrl,
        headers: requestPayload.headers,
        body: requestPayload.body
      });
      const result = await sendHttpRequest(requestPayload);

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
          if (workspace.id !== current.activeWorkspaceId) {
            return workspace;
          }

          const historyEntry = {
            id: createId("history"),
            requestId: activeRequest.id,
            requestName: activeRequest.name,
            method: activeRequest.method,
            status: result.status,
            statusText: result.statusText,
            duration: `${result.durationMs} ms`,
            size: `${bodySize} B`,
            url: finalUrl,
            fingerprint: historyFingerprint,
            savedAt,
            savedAtTs: Date.now()
          };

          return {
            ...workspace,
            history: [historyEntry, ...workspace.history.filter((entry) => entry.fingerprint !== historyFingerprint)].slice(0, 50),
            requests: workspace.requests.map((request) =>
              request.id === activeRequest.id
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
      }));
    } catch (error) {
      const message = error?.toString?.() || "Request failed";
      const savedAt = formatSavedAt();
      const requestHeaders = serializeHeaders(activeRequest.headers, activeRequest.auth, activeRequest.bodyType);
      const historyFingerprint = createHistoryFingerprint({
        method: activeRequest.method,
        url: finalUrl,
        headers: requestHeaders,
        body: activeRequest.bodyType === "none" ? null : activeRequest.body.trim() ? activeRequest.body : null
      });
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
          if (workspace.id !== current.activeWorkspaceId) {
            return workspace;
          }

          const historyEntry = {
            id: createId("history"),
            requestId: activeRequest.id,
            requestName: activeRequest.name,
            method: activeRequest.method,
            status: 500,
            statusText: "Request failed",
            duration: "-",
            size: "0 B",
            url: finalUrl,
            fingerprint: historyFingerprint,
            savedAt,
            savedAtTs: Date.now()
          };

          return {
            ...workspace,
            history: [historyEntry, ...workspace.history.filter((entry) => entry.fingerprint !== historyFingerprint)].slice(0, 50),
            requests: workspace.requests.map((request) =>
              request.id === activeRequest.id
                ? { ...request, responseBodyView: "Raw", lastResponse: savedResponse }
                : request
            )
          };
        })
      }));
    } finally {
      setIsSending(false);
    }
  }

  const workspaceTitle = activeWorkspace?.name ?? "No workspace selected";
  const workspaceDescription = activeWorkspace?.description?.trim();
  const showEmptyCanvas = !activeWorkspace || !activeRequest;
  const sidebarWidth = store.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : store.sidebarWidth;

  return (
    <div className="h-full overflow-hidden">
      <div className="flex h-full min-h-0 overflow-hidden border border-border/30 bg-card/35">
        <div style={{ width: `${sidebarWidth}px` }} className="min-h-0 shrink-0 overflow-hidden">
          <Sidebar
            iconSrc="/icon.ico"
            sidebarTab={store.sidebarTab}
            collapsed={store.sidebarCollapsed}
            workspaces={store.workspaces}
            activeWorkspaceId={store.activeWorkspaceId}
            activeRequestId={store.activeRequestId}
            onSidebarTabChange={handleSidebarTabChange}
            onSelectWorkspace={selectWorkspace}
            onSelectRequest={selectRequest}
            onCreateWorkspace={createWorkspaceRecord}
            onCreateRequest={createRequestRecord}
            onRenameWorkspace={renameWorkspaceRecord}
            onDeleteWorkspace={deleteWorkspaceRecord}
            onRenameRequest={renameRequestRecord}
            onDeleteRequest={deleteRequestRecord}
            onDuplicateRequest={duplicateRequestRecord}
            onTogglePinRequest={togglePinRequestRecord}
            onClearAllHistory={clearAllHistoryRecords}
            onDeleteHistoryEntry={deleteHistoryRecord}
          />
        </div>

        <div
          className="w-px shrink-0 cursor-col-resize bg-border/60"
          onMouseDown={(event) => {
            resizeRef.current = { active: true, startX: event.clientX, startWidth: sidebarWidth };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />

        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden bg-card/20">
          <Card className="flex items-center justify-between gap-4 border-0 border-b border-border/30 bg-card/55 px-3 py-2.5 shadow-none">
            <div className="flex items-center gap-3 min-w-0">
              <div className="hidden h-8 w-8 items-center justify-center bg-primary/12 text-primary sm:flex">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground lg:text-[12px]">{workspaceTitle}</p>
                <h1 className="truncate mt-0.5 text-[13px] font-semibold tracking-tight text-foreground lg:text-[15px]">{workspaceDescription}</h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="mr-1 text-[10px] font-medium text-muted-foreground lg:text-[11px]">v{version}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-sm border-border/40 bg-card/40 px-2.5 text-[11px] text-foreground"
                onClick={() => openUrl("https://github.com/dexter-xD/Kivo")}
              >
                <Github className="h-3.5 w-3.5" />
                {starCount !== null ? <span className="leading-none">{starCount.toLocaleString()}</span> : null}
              </Button>
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </div>
          </Card>

          <div className="flex items-stretch overflow-x-auto border-b border-border/30 bg-card/28 px-1 thin-scrollbar lg:h-[44px]">
            {requestTabs.map((request) => (
              <button
                key={request.id}
                type="button"
                onClick={() => selectRequest(activeWorkspace.id, request.id)}
                className={cn(
                  "group relative flex min-w-[120px] items-center gap-2 border-r border-border/25 px-3 text-[12px] transition-colors lg:text-[13.5px]",
                  request.id === store.activeRequestId
                    ? "bg-primary/10 text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]"
                    : "bg-card/20 text-muted-foreground hover:bg-card/45 hover:text-foreground"
                )}
              >
                <span className={cn("px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] lg:text-[11px]", getMethodTone(request.method))}>{request.method}</span>
                {request.pinned ? <Pin className="h-3 w-3 shrink-0 text-primary" /> : null}
                <span className={cn("truncate", request.id === store.activeRequestId && "font-semibold")}>{request.name}</span>
                <span
                  className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeRequestTab(request.id);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => createRequestRecord(store.activeWorkspaceId)}
              className={cn(
                "flex w-9 items-center justify-center text-muted-foreground hover:bg-card/45 hover:text-foreground transition-opacity",
                !store.activeWorkspaceId && "opacity-0 pointer-events-none"
              )}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {showEmptyCanvas ? (
            <EmptyCanvas
              hasWorkspace={Boolean(activeWorkspace)}
              onCreateRequest={() => createRequestRecord(store.activeWorkspaceId)}
              onCreateWorkspace={() => createWorkspaceRecord({ name: "New Workspace", description: "" })}
            />
          ) : (
            <div className="grid min-h-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_1fr]">
              <RequestPane
                state={activeRequest}
                isSending={isSending}
                onSend={handleSend}
                onChange={handleRequestFieldChange}
                onTabChange={(tab) => updateActiveRequest((request) => ({ ...request, activeEditorTab: tab }))}
                onParamsChange={(queryParams) => updateActiveRequest((request) => ({ ...request, queryParams }))}
                onHeadersChange={(headers) => updateActiveRequest((request) => ({ ...request, headers }))}
                onAuthChange={(auth) => updateActiveRequest((request) => ({ ...request, auth }))}
              />
              <ResponsePane
                response={response}
                activeTab={activeRequest?.activeResponseTab ?? "Body"}
                onTabChange={(tab) => updateActiveRequest((request) => ({ ...request, activeResponseTab: tab }))}
                bodyView={activeRequest?.responseBodyView ?? "Raw"}
                onBodyViewChange={(view) => updateActiveRequest((request) => ({ ...request, responseBodyView: view }))}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
