import { Pin, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils.js";
import { getMethodTone } from "@/lib/http-ui.js";
import { REQUEST_MODES } from "@/lib/workspace-store.js";

export function RequestTabs({
  requestTabs,
  activeWorkspaceName,
  activeCollectionName,
  activeRequestName,
  selectRequest,
  closeRequestTab,
  createRequestRecord,
}) {
  return (
    <div className="flex items-stretch overflow-x-auto border-b border-border/30 bg-card/28 px-1 thin-scrollbar lg:h-[44px]">
      {requestTabs.map((request) => (
        (() => {
          const isWebSocket = request.requestMode === REQUEST_MODES.WEBSOCKET;
          const isGrpc = request.requestMode === REQUEST_MODES.GRPC;
          const displayMethod = isWebSocket ? "WS" : (isGrpc ? "gRPC" : request.method);
          const methodTone = isWebSocket
            ? "text-amber-300 bg-amber-500/15"
            : (isGrpc ? "text-cyan-300 bg-cyan-500/15" : getMethodTone(request.method));
          return (
            <button
              key={request.name}
              type="button"
              onClick={() => selectRequest(activeWorkspaceName, activeCollectionName, request.name)}

              className={cn(
                "group relative flex min-w-[120px] items-center gap-2 border-r border-border/25 px-3 text-[12px] transition-colors lg:text-[13.5px]",
                request.name === activeRequestName
                  ? "bg-primary/10 text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]"
                  : "bg-card/20 text-muted-foreground hover:bg-card/45 hover:text-foreground"
              )}
            >
              <span className={cn("px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] lg:text-[11px]", methodTone)}>{displayMethod}</span>
              {request.pinned ? <Pin className="h-3 w-3 shrink-0 text-primary" /> : null}
              <span className={cn("truncate", request.name === activeRequestName && "font-semibold")}>{request.name}</span>
              <span
                className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"

                onClick={(event) => {
                  event.stopPropagation();
                  closeRequestTab(request.name);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            </button>
          );
        })()
      ))}

      <button
        type="button"
        onClick={() => createRequestRecord(activeWorkspaceName, activeCollectionName)}
        className={cn(
          "flex w-9 items-center justify-center text-muted-foreground hover:bg-card/45 hover:text-foreground transition-opacity",
          !activeWorkspaceName && "opacity-0 pointer-events-none"
        )}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}