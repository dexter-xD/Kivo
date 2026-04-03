import { createDefaultStore, normalizeRequestRecord, orderRequests } from "./workspace-store.js";

export const SIDEBAR_COLLAPSED_WIDTH = 52;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_REOPEN_WIDTH = 260;

export function parseCookies(headers) {
  const cookieHeader = Object.entries(headers).find(([key]) => key.toLowerCase() === "set-cookie");

  if (!cookieHeader) {
    return [];
  }

  return String(cookieHeader[1])
    .split(",")
    .map((cookie) => cookie.trim())
    .filter(Boolean);
}

export function clampSidebarWidth(value) {
  return Math.min(420, Math.max(SIDEBAR_MIN_WIDTH, value));
}

export function normalizeStore(store) {
  const fallback = createDefaultStore();
  const nextStore = store && typeof store === "object" ? store : fallback;
  const workspaces = Array.isArray(nextStore.workspaces)
    ? nextStore.workspaces.map((workspace) => ({
      ...workspace,
      collections: Array.isArray(workspace.collections)
        ? workspace.collections.map((collection) => ({
          ...collection,
          requests: orderRequests((collection.requests ?? []).map((request) => normalizeRequestRecord(request))),
          openRequestNames: Array.isArray(collection.openRequestNames) ? collection.openRequestNames : (collection.requests ?? []).map((request) => request.name)
        }))
        : []
    }))
    : [];
  const activeWorkspace = workspaces.find((workspace) => workspace.name === nextStore.activeWorkspaceName) ?? workspaces[0] ?? null;
  const activeCollection = activeWorkspace?.collections?.find((c) => c.name === nextStore.activeCollectionName) ?? activeWorkspace?.collections?.[0] ?? null;
  const activeRequest = activeCollection?.requests?.find((request) => request.name === nextStore.activeRequestName && activeCollection.openRequestNames.includes(request.name)) ?? null;

  return {
    version: 1,
    sidebarTab: "requests",
    storagePath: nextStore.storagePath || null,
    sidebarCollapsed: Boolean(nextStore.sidebarCollapsed),
    activeWorkspaceName: activeWorkspace?.name ?? "",
    activeCollectionName: activeCollection?.name ?? "",
    activeRequestName: activeRequest?.name ?? "",
    sidebarWidth: clampSidebarWidth(Number(nextStore.sidebarWidth || fallback.sidebarWidth)),
    workspaces
  };
}
