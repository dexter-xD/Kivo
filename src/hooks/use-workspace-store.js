import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";

import { loadAppState, saveAppState, sendHttpRequest } from "@/lib/http-client.js";
import { buildRequestPayload, buildUrlWithParams, serializeHeaders } from "@/lib/http-ui.js";
import {
  cloneRequest,
  createCollection,
  createDefaultStore,
  createEmptyResponse,
  createRequest,
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

const SIDEBAR_COLLAPSED_WIDTH = 52;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_REOPEN_WIDTH = 260;

export function useWorkspaceStore() {
  const [store, setStore] = useState(createDefaultStore());
  const [isSending, setIsSending] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSetupComplete, setIsSetupComplete] = useState(true);
  const [starCount, setStarCount] = useState(null);
  const saveTimerRef = useRef(null);
  const resizeRef = useRef({ active: false, startX: 0, startWidth: 304 });

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

  function createRequestRecord(workspaceName, collectionName, name) {
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
      const uniqueName = name ? name.trim() : getUniqueName("New Request", existingNames);
      
      if (name && existingNames.includes(uniqueName)) {
        return current;
      }
      
      const nextRequest = createRequest(uniqueName);

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
              return {
                ...collection,
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

  function pasteRequestRecord(workspaceName, collectionName, request) {
    updateStore((current) => {
      const targetWorkspaceName = workspaceName || current.activeWorkspaceName;
      const workspace = current.workspaces.find(w => w.name === targetWorkspaceName);
      const targetCollectionName = collectionName || current.activeCollectionName || workspace?.collections?.[0]?.name;

      if (!targetCollectionName) return current;

      const collection = workspace.collections.find(c => c.name === targetCollectionName);
      const existingNames = collection?.requests.map(r => r.name) || [];
      const uniqueName = getUniqueName(request.name, existingNames);

      const pastedRequest = cloneRequest({ ...request, name: uniqueName });

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
              return {
                ...c,
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
      const requestPayload = buildRequestPayload(
        activeRequest,
        activeWorkspace?.name ?? "",
        activeCollection?.name ?? ""
      );
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
      setIsSending(false);
    }
  }

  return {
    store,
    isSending,
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
    createRequestRecord,
    duplicateRequestRecord,
    pasteRequestRecord,
    renameRequestRecord,
    deleteRequestRecord,
    selectWorkspace,
    selectCollection,
    selectRequest,
    togglePinRequestRecord,
    closeRequestTab,
    handleSend,
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
