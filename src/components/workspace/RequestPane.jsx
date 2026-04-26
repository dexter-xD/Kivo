import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Braces, ChevronDown, Eye, EyeOff, FileCode2, FilePlus2, FileText, Folder, FolderPlus, Plus, RefreshCw, SendHorizontal, Trash2, Wand2, PenLine, Table2, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

import { CodeEditor } from "@/components/workspace/CodeEditor.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Input } from "@/components/ui/input.jsx";
import { OAuth2Panel } from "@/components/workspace/OAuth2Panel.jsx";
import { formatGraphqlText, formatJsonText } from "@/lib/formatters.js";
import { getMethodTone, requestBodyModes } from "@/lib/http-ui.js";
import { listGrpcProtoFilesInDirectory, parseGrpcProtoFile } from "@/lib/http-client.js";
import { REQUEST_MODES } from "@/lib/workspace-store.js";
import { cn } from "@/lib/utils.js";
import { EnvHighlightInput } from "@/components/ui/EnvHighlightInput.jsx";

const tabs = ["Params", "Body", "Auth", "Headers", "Docs", "Settings"];
const requestMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const webSocketBodyModes = [
  { value: "json", label: "JSON" },
  { value: "text", label: "Raw" }
];

function SseHeadersPanel({ headers, onHeadersChange }) {
  const systemHeaders = [
    { key: "Accept", value: "text/event-stream" },
    { key: "Cache-Control", value: "no-cache" }
  ];

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="border-b border-border/20 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Stream Headers
      </div>
      <div className="thin-scrollbar min-h-0 overflow-auto bg-transparent">
        {systemHeaders.map((row) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-border/10 px-3 py-2 text-[12px]">
            <div className="text-foreground">{row.key}</div>
            <div className="text-muted-foreground">{row.value}</div>
          </div>
        ))}
        <div className="border-t border-border/20">
          <TableEditor
            rows={headers}
            onChange={onHeadersChange}
            keyLabel="header"
            valueLabel="value"
            title="Custom Headers"
            addLabel="Add"
          />
        </div>
      </div>
    </div>
  );
}

function SocketIoHeadersPanel({ headers, onHeadersChange }) {
  const systemHeaders = [
    { key: "Connection", value: "Upgrade" },
    { key: "Upgrade", value: "websocket" },
    { key: "Sec-WebSocket-Version", value: "13" }
  ];

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="border-b border-border/20 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Socket.IO Handshake Headers
      </div>
      <div className="thin-scrollbar min-h-0 overflow-auto bg-transparent">
        {systemHeaders.map((row) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-border/10 px-3 py-2 text-[12px]">
            <div className="text-foreground">{row.key}</div>
            <div className="text-muted-foreground">{row.value}</div>
          </div>
        ))}
        <div className="border-t border-border/20">
          <TableEditor
            rows={headers}
            onChange={onHeadersChange}
            keyLabel="header"
            valueLabel="value"
            title="Custom Headers"
            addLabel="Add"
          />
        </div>
      </div>
    </div>
  );
}

function SseOptionsPanel({ state, onChange }) {
  return (
    <div className="h-full min-h-0 overflow-hidden text-[12px] text-muted-foreground">
      <div className="h-full thin-scrollbar overflow-auto px-3 py-3">
        <div className="grid max-w-[640px] gap-4">
          <div className="grid gap-2 border border-border/30 bg-transparent p-3">
            <div className="text-[12px] font-medium text-foreground">Event Stream Options</div>
            <p className="text-[11px] text-muted-foreground">These options are saved with your SSE request settings.</p>
          </div>

          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Retry (ms)</label>
            <Input
              type="number"
              min={0}
              value={Number.isFinite(state.sseRetryMs) ? state.sseRetryMs : 3000}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                onChange("sseRetryMs", Number.isFinite(value) && value >= 0 ? value : 0);
              }}
              className="h-10 max-w-[220px] border-border/40 bg-transparent"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Last Event ID</label>
            <Input
              value={state.sseLastEventId ?? ""}
              onChange={(event) => onChange("sseLastEventId", event.target.value)}
              placeholder="Optional resume token"
              className="h-10 max-w-[420px] border-border/40 bg-transparent"
            />
          </div>

          <label className="flex items-center gap-2 text-[12px] text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={Boolean(state.sseWithCredentials)}
              onChange={(event) => onChange("sseWithCredentials", event.target.checked)}
            />
            Send credentials with EventSource (if server supports CORS credentials)
          </label>
        </div>
      </div>
    </div>
  );
}

function SocketIoEventsPanel({ state, onChange }) {
  return (
    <div className="h-full min-h-0 overflow-hidden text-[12px] text-muted-foreground">
      <div className="h-full thin-scrollbar overflow-auto px-3 py-3">
        <div className="grid max-w-[640px] gap-4">
          <div className="grid gap-2 border border-border/30 bg-transparent p-3">
            <div className="text-[12px] font-medium text-foreground">Socket.IO Event Settings</div>
            <p className="text-[11px] text-muted-foreground">Configure event name and namespace used for outgoing packets.</p>
          </div>

          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Event Name</label>
            <Input
              value={state.socketIoEventName ?? "message"}
              onChange={(event) => onChange("socketIoEventName", event.target.value)}
              placeholder="message"
              className="h-10 max-w-[320px] border-border/40 bg-transparent"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Namespace</label>
            <Input
              value={state.socketIoNamespace ?? "/"}
              onChange={(event) => onChange("socketIoNamespace", event.target.value)}
              placeholder="/"
              className="h-10 max-w-[320px] border-border/40 bg-transparent"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Ack Timeout (ms)</label>
            <Input
              type="number"
              min={0}
              value={Number.isFinite(state.socketIoAckTimeoutMs) ? state.socketIoAckTimeoutMs : 0}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                onChange("socketIoAckTimeoutMs", Number.isFinite(value) && value >= 0 ? value : 0);
              }}
              className="h-10 max-w-[220px] border-border/40 bg-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const grpcStreamingModes = [
  { value: "unary", label: "Unary" },
  { value: "server_stream", label: "Server Streaming" },
  { value: "client_stream", label: "Client Streaming" },
  { value: "bidi", label: "Bi-directional Streaming" }
];
const authModes = [
  { value: "none", label: "No Auth" },
  { value: "basic", label: "Basic Auth" },
  { value: "bearer", label: "Bearer Token" },
  { value: "apikey", label: "API Key" },
  { value: "oauth2", label: "OAuth 2.0" },
  { value: "inherit", label: "Inherit from Collection" },
];

function createRow() {
  return { id: `row-${Math.random().toString(36).slice(2, 8)}`, key: "", value: "", enabled: true };
}

function getPathFileName(path) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  const segments = raw.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || raw;
}

function getPathLeafFolder(path) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  const segments = raw.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || raw;
}

function normalizePath(path) {
  return String(path || "").trim().replace(/\\/g, "/").toLowerCase();
}

function RequestSettingsPanel({ state, onChange }) {
  const tagsText = Array.isArray(state.tags) ? state.tags.join(", ") : "";

  function handleTagsChange(value) {
    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    onChange("tags", tags);
  }

  return (
    <div className="h-full min-h-0 overflow-hidden text-[12px] text-muted-foreground">
      <div className="h-full thin-scrollbar overflow-auto px-3 py-3">
        <div className="grid max-w-[720px] gap-4">
          <p className="text-[13px] text-muted-foreground">Configure request settings for this item.</p>

          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Tags</label>
            <Input
              value={tagsText}
              onChange={(event) => handleTagsChange(event.target.value)}
              placeholder="e.g., create, update"
              className="h-10 border-border/40 bg-transparent"
            />
          </div>

          <div className="grid gap-3 border border-border/30 bg-transparent p-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[12px] font-medium text-foreground">URL Encoding</div>
                <p className="text-[12px] text-muted-foreground">Automatically encode query parameters in the URL.</p>
              </div>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={state.urlEncoding ?? true}
                onChange={(event) => onChange("urlEncoding", event.target.checked)}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[12px] font-medium text-foreground">Automatically Follow Redirects</div>
                <p className="text-[12px] text-muted-foreground">Follow HTTP redirects automatically.</p>
              </div>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-primary"
                checked={state.followRedirects ?? true}
                onChange={(event) => onChange("followRedirects", event.target.checked)}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-[10px] uppercase tracking-[0.18em]">Max Redirects</label>
              <Input
                type="number"
                min={0}
                value={Number.isFinite(state.maxRedirects) ? state.maxRedirects : 5}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  onChange("maxRedirects", Number.isFinite(value) && value >= 0 ? value : 0);
                }}
                className="h-10 border-border/40 bg-transparent max-w-[180px]"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-[10px] uppercase tracking-[0.18em]">Timeout (ms)</label>
              <Input
                type="number"
                min={0}
                value={Number.isFinite(state.timeoutMs) ? state.timeoutMs : 0}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  onChange("timeoutMs", Number.isFinite(value) && value >= 0 ? value : 0);
                }}
                className="h-10 border-border/40 bg-transparent max-w-[180px]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildResponseErrorTrace(response, fallbackTitle = "Request failed") {
  const status = Number(response?.status || 0);
  const badge = String(response?.badge || response?.statusText || "").trim();
  const savedAt = String(response?.savedAt || "").trim();
  const method = String(response?.meta?.method || "").trim();
  const url = String(response?.meta?.url || "").trim();
  const headers = response?.headers && typeof response.headers === "object" ? response.headers : {};
  const body = String(response?.rawBody || response?.body || "").trim();

  const lines = [
    `Error: ${fallbackTitle || "Request failed"}`,
    status ? `Status: ${status}${badge ? ` (${badge})` : ""}` : (badge ? `Status: ${badge}` : "Status: Unknown"),
    method || url ? `Request: ${[method || "?", url || "-"].join(" ")}` : "Request: -",
    savedAt ? `Time: ${savedAt}` : "Time: -",
    "",
    "Headers:",
    Object.keys(headers).length ? JSON.stringify(headers, null, 2) : "(none)",
    "",
    "Body:",
    body || "(empty)"
  ];

  return lines.join("\n");
}

function GrpcHeadersPanel({ headers, onHeadersChange }) {
  const systemHeaders = [
    { key: "content-type", value: "application/grpc" },
    { key: "te", value: "trailers" }
  ];

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="border-b border-border/20 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        gRPC Transport Headers
      </div>
      <div className="thin-scrollbar min-h-0 overflow-auto">
        {systemHeaders.map((row) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-border/10 px-3 py-2 text-[12px]">
            <div className="text-foreground">{row.key}</div>
            <div className="text-muted-foreground">{row.value}</div>
          </div>
        ))}
        <div>
          <TableEditor
            rows={headers}
            onChange={onHeadersChange}
            keyLabel="header"
            valueLabel="value"
            title="Custom Metadata"
            addLabel="Add"
          />
        </div>
      </div>
    </div>
  );
}

function GrpcProtoPickerModal({
  open,
  selectedPath,
  directFiles,
  directoryGroups,
  onClose,
  onSave,
  onAddFile,
  onAddDirectory,
  onRemoveDirectFile,
  onRemoveDirectory,
  onRemoveDirectoryFile,
  loading,
}) {
  const [draftSelectedPath, setDraftSelectedPath] = useState(selectedPath || "");

  const hasEntries = directFiles.length > 0 || directoryGroups.length > 0;

  useEffect(() => {
    if (!open) return;
    setDraftSelectedPath(selectedPath || "");
  }, [open, selectedPath]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <Card className="grid h-[min(680px,94vh)] w-[min(980px,96vw)] grid-rows-[auto_auto_minmax(0,1fr)_auto] border border-border/60 bg-card/95 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-[34px] font-semibold text-foreground">Select Proto File</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">Add files directly or scan a directory, then choose one file to use.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-foreground">Files</div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onAddDirectory} className="h-8 px-3 text-[12px]">
              <FolderPlus className="mr-1 h-3.5 w-3.5" />
              Add Directory
            </Button>
            <Button type="button" variant="outline" onClick={onAddFile} className="h-8 px-3 text-[12px]">
              <FilePlus2 className="mr-1 h-3.5 w-3.5" />
              Add Proto File
            </Button>
          </div>
        </div>

        <div className="thin-scrollbar min-h-0 overflow-auto border border-border/30 bg-background/15">
          {!hasEntries ? (
            <div className="px-4 py-8 text-[12px] text-muted-foreground">No proto files added yet.</div>
          ) : (
            <div className="divide-y divide-border/20 px-2 py-1">
              {directFiles.map((path) => (
                <div key={`file-${path}`} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2">
                  <input type="radio" name="grpc-proto-path" checked={draftSelectedPath === path} onChange={() => setDraftSelectedPath(path)} className="h-3.5 w-3.5 accent-primary" />
                  <div className="flex min-w-0 items-center gap-2 text-[12px] text-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                    <span className="truncate">{getPathFileName(path)}</span>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => onRemoveDirectFile(path)} className="h-7 w-7">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {directoryGroups.map((group) => (
                <div key={`dir-${group.path}`} className="px-2 py-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <div className="flex items-center gap-2 text-[12px] font-medium text-foreground">
                      <Folder className="h-3.5 w-3.5 text-amber-300" />
                      <span className="truncate">{getPathLeafFolder(group.path) || group.path}</span>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => onRemoveDirectory(group.path)} className="h-7 w-7">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="mt-1 space-y-1 pl-5">
                    {(group.files || []).map((path) => (
                      <div key={`dir-file-${group.path}-${path}`} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2">
                        <input type="radio" name="grpc-proto-path" checked={draftSelectedPath === path} onChange={() => setDraftSelectedPath(path)} className="h-3.5 w-3.5 accent-primary" />
                        <div className="flex min-w-0 items-center gap-2 text-[12px] text-foreground">
                          <span className="text-muted-foreground">|_</span>
                          <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                          <span className="truncate">{getPathFileName(path)}</span>
                        </div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => onRemoveDirectoryFile(group.path, path)} className="h-7 w-7">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            onClick={() => onSave(draftSelectedPath)}
            disabled={!draftSelectedPath || loading || !hasEntries}
            className="h-9 px-6"
          >
            Save
          </Button>
        </div>
      </Card>
    </div>,
    document.body
  );
}

function SendErrorModal({ open, title, stackTrace, onClose }) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[280] flex items-center justify-center bg-background/75 p-6 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <Card className="grid h-[min(620px,90vh)] w-[min(980px,96vw)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 border border-border/60 bg-card/95 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="text-[36px] font-semibold text-foreground">Uh Oh!</div>
          <button type="button" onClick={onClose} className="text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border border-red-500/40 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-300">
          {title || "Request failed"}
        </div>

        <div className="min-h-0 overflow-hidden">
          <details open className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <summary className="cursor-pointer text-[12px] text-foreground">Stack trace</summary>
            <div className="mt-2 min-h-0 overflow-auto border border-border/35 bg-background/30 p-2.5 text-[12px] text-foreground">
              <pre className="whitespace-pre-wrap break-words font-mono">{stackTrace || title || "No stack trace available."}</pre>
            </div>
          </details>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={onClose} className="h-9 px-8">Ok</Button>
        </div>
      </Card>
    </div>,
    document.body
  );
}

function WebSocketHeadersPanel({ headers, onHeadersChange }) {
  const systemHeaders = [
    { key: "Connection", value: "Upgrade" },
    { key: "Upgrade", value: "websocket" },
    { key: "Sec-WebSocket-Key", value: "<calculated at runtime>" },
    { key: "Sec-WebSocket-Version", value: "13" },
    { key: "Sec-WebSocket-Extensions", value: "permessage-deflate; client_max_window_bits" }
  ];

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="border-b border-border/20 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Handshake Headers
      </div>
      <div className="thin-scrollbar min-h-0 overflow-auto bg-transparent">
        {systemHeaders.map((row) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-border/10 px-3 py-2 text-[12px]">
            <div className="text-foreground">{row.key}</div>
            <div className="text-muted-foreground">{row.value}</div>
          </div>
        ))}
        <div className="border-t border-border/20">
          <TableEditor
            rows={headers}
            onChange={onHeadersChange}
            keyLabel="header"
            valueLabel="value"
            title="Custom Headers"
            addLabel="Add"
          />
        </div>
      </div>
    </div>
  );
}

function TableEditor({
  rows,
  onChange,
  title,
  addLabel,
  keyLabel = "name",
  valueLabel = "value",
  disabled = false
}) {
  function updateRow(index, field, value) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    onChange([...rows, createRow()]);
  }

  function removeRow(index) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function clearRows() {
    onChange([]);
  }

  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");

  useEffect(() => {
    if (isBulkMode) {
      setBulkText(
        rows
          .filter((r) => r.key.trim() || r.value.trim())
          .map((r) => `${r.enabled ? "" : "// "}${r.key}: ${r.value}`)
          .join("\n")
      );
    }
  }, [isBulkMode]);

  function handleBulkChange(e) {
    const text = e.target.value;
    setBulkText(text);

    const parsedRows = text
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return null;

        const isEnabled = !trimmed.startsWith("//");
        const activeLine = isEnabled ? trimmed : trimmed.replace(/^\/\/\s*/, "");

        const colonIdx = activeLine.indexOf(":");
        const eqIdx = activeLine.indexOf("=");

        let sepIdx = -1;
        if (colonIdx !== -1 && eqIdx !== -1) sepIdx = Math.min(colonIdx, eqIdx);
        else if (colonIdx !== -1) sepIdx = colonIdx;
        else if (eqIdx !== -1) sepIdx = eqIdx;

        let key = activeLine;
        let value = "";
        if (sepIdx !== -1) {
          key = activeLine.slice(0, sepIdx).trim();
          value = activeLine.slice(sepIdx + 1).trim();
        }

        return { id: `row-${Math.random().toString(36).slice(2, 8)}`, key, value, enabled: isEnabled };
      })
      .filter(Boolean);

    onChange(parsedRows);
  }

  const activeCount = rows.filter((row) => row.enabled && row.key.trim()).length;

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-transparent">
      <div className="flex items-center justify-between border-b border-border/20 px-3 py-2 text-[11px] text-muted-foreground lg:text-[12px]">
        <div className="flex items-center gap-3">
          <span className="font-medium text-foreground">{title}</span>
          <span>{activeCount} active</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsBulkMode(!isBulkMode)}
            disabled={disabled}
            className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            {isBulkMode ? (
              <>
                <Table2 className="h-3 w-3" />
                Key-Value Edit
              </>
            ) : (
              <>
                <PenLine className="h-3 w-3" />
                Bulk Edit
              </>
            )}
          </button>
          <div className="w-px h-3.5 bg-border/40 mx-1" />
          <button
            type="button"
            onClick={addRow}
            disabled={disabled || isBulkMode}
            className={cn("flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40", isBulkMode && "hidden")}
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </button>
          <button
            type="button"
            onClick={clearRows}
            disabled={disabled}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 ml-1"
          >
            Delete all
          </button>
        </div>
      </div>
      
      {isBulkMode ? (
        <div className="min-h-0 overflow-hidden relative">
          <textarea
            value={bulkText}
            onChange={handleBulkChange}
            disabled={disabled}
            placeholder="key: value&#10;key2=value2"
            spellCheck={false}
            className="thin-scrollbar h-full w-full resize-none overflow-auto border-0 bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      ) : (
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="grid grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)_36px] border-b border-border/20 px-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground lg:text-[11px]">
            <div className="px-2 py-2"></div>
            <div className="px-2 py-2">{keyLabel}</div>
            <div className="px-2 py-2">{valueLabel}</div>
            <div className="px-2 py-2"></div>
          </div>
          <div className="thin-scrollbar min-h-0 overflow-auto">
            {rows.length > 0 ? (
              rows.map((row, index) => (
                <div key={row.id || `row-${index}`} className="grid grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)_36px] border-b border-border/10 px-1">
                  <label className="flex items-center justify-center">
                    <input disabled={disabled} type="checkbox" checked={row.enabled ?? true} onChange={(event) => updateRow(index, "enabled", event.target.checked)} />
                  </label>
                  <Input disabled={disabled} className="h-10 border-0 bg-transparent text-[12px] focus-visible:ring-0 lg:text-[14px]" value={row.key} onChange={(event) => updateRow(index, "key", event.target.value)} placeholder={keyLabel} />
                  <Input disabled={disabled} className="h-10 border-0 bg-transparent text-[12px] focus-visible:ring-0 lg:text-[14px]" value={row.value} onChange={(event) => updateRow(index, "value", event.target.value)} placeholder={valueLabel} />
                  <button type="button" disabled={disabled} className="flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => removeRow(index)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground/60">
                <p className="text-[11px] uppercase tracking-wider">No {title.toLowerCase()} defined</p>
                <button
                  type="button"
                  onClick={addRow}
                  className="mt-2 text-[10px] underline hover:text-foreground"
                >
                  Click here to add one
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GraphQLEditor({ query, variables, onQueryChange, onVariablesChange, disabled }) {
  function handleFormatQuery() {
    onQueryChange(formatGraphqlText(query));
  }

  function handleFormatVariables() {
    try {
      onVariablesChange(formatJsonText(variables || "{}"));
    } catch {
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] overflow-hidden bg-transparent">
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex items-center justify-between border-b border-border/20 px-3 py-2 text-[11px] text-muted-foreground lg:text-[12px]">
          <span className="font-medium text-foreground">Query</span>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={handleFormatQuery} disabled={disabled}>
            <Wand2 className="h-3 w-3" />
            Format Query
          </Button>
        </div>
        <CodeEditor
          value={query}
          onChange={onQueryChange}
          placeholder={"query GetUsers {\n  users {\n    id\n    name\n  }\n}"}
          language="graphql"
          disabled={disabled}
        />
      </div>

      <div className="h-px bg-border/25" />

      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex items-center justify-between border-b border-border/20 px-3 py-2 text-[11px] text-muted-foreground lg:text-[12px]">
          <span className="font-medium text-foreground">Variables</span>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={handleFormatVariables} disabled={disabled}>
            <Wand2 className="h-3 w-3" />
            Format Variables
          </Button>
        </div>
        <CodeEditor
          value={variables}
          onChange={onVariablesChange}
          placeholder={"{\n  \"id\": 1\n}"}
          language="json"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function SelectMenu({ value, options, onChange, className, renderValue, renderOption, buttonClassName, disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    function handlePointer(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={rootRef} className={cn("relative", open && !disabled && "z-[320]", className)}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        disabled={disabled}
        className={cn(
          "flex h-8 w-full items-center justify-between border border-border/35 bg-transparent px-3 text-left text-[12px] text-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70",
          buttonClassName
        )}
      >
        <span className="truncate">{renderValue ? renderValue(selected) : selected.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !disabled && open && "rotate-180")} />
      </button>

      {open && !disabled ? (
        <div className="absolute left-0 top-[calc(100%+4px)] z-[330] min-w-full overflow-hidden border border-border/45 bg-background shadow-xl">
          {options.map((option) => {
            const active = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-[12px] transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {renderOption ? renderOption(option, active) : <span>{option.label}</span>}
              </button>
            );
          })}
        </div>
      ) : null}

    </div>
  );
}

function MethodPicker({ value, onChange }) {
  const methodOptions = requestMethods.map((method) => ({ value: method, label: method }));

  return (
    <SelectMenu
      value={value}
      options={methodOptions}
      onChange={onChange}
      buttonClassName="lg:h-10 lg:text-[14px]"
      renderValue={(option) => <span className={cn("font-semibold uppercase tracking-[0.14em]", getMethodTone(option.value).split(" ")[0])}>{option.label}</span>}
      renderOption={(option, active) => (
        <div className="flex w-full items-center justify-between gap-3">
          <span className={cn("font-semibold uppercase tracking-[0.14em]", getMethodTone(option.value).split(" ")[0])}>{option.label}</span>
          {active ? <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Selected</span> : null}
        </div>
      )}
    />
  );
}

const apiKeyInOptions = [
  { value: "header", label: "Header" },
  { value: "query", label: "Query Param" },
];

function AuthPanel({ state, onAuthChange, envVars, response, workspaceName, collectionName }) {
  const auth = state.auth ?? { type: "none" };
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="h-full min-h-0 overflow-hidden text-[12px] text-muted-foreground">
      <div className="h-full thin-scrollbar overflow-auto px-3 py-3">
      <div className={cn("grid gap-4", auth.type !== "oauth2" && "pb-3")}>
      <div className="grid max-w-[420px] gap-2 px-3 pt-3">
        <label className="text-[10px] uppercase tracking-[0.18em]">Type</label>
        <SelectMenu
          value={auth.type}
          options={authModes}
          onChange={(type) => onAuthChange({ ...auth, type })}
        />
      </div>

      {auth.type === "basic" && (
        <div className="grid max-w-[420px] gap-4 px-3" style={{ animation: "fadeIn 0.2s ease-out" }}>
          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Username</label>
            <EnvHighlightInput
              value={auth.username ?? ""}
              onValueChange={(val) => onAuthChange({ ...auth, username: val })}
              placeholder="Enter username"
              envVars={envVars}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Password</label>
            <div className="relative">
              <EnvHighlightInput
                value={auth.password ?? ""}
                onValueChange={(val) => onAuthChange({ ...auth, password: val })}
                placeholder="Enter password"
                type={showPassword ? "text" : "password"}
                envVars={envVars}
                inputClassName="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            Generates <code className="rounded-sm border border-border/30 px-1 py-0.5 text-[10px] text-foreground">Authorization: Basic base64(user:pass)</code> header. Supports <code className="rounded-sm border border-border/30 px-1 py-0.5 text-[10px] text-foreground">{"{{variables}}"}</code>.
          </p>
        </div>
      )}

      {auth.type === "bearer" && (
        <div className="grid max-w-[420px] gap-2 px-3" style={{ animation: "fadeIn 0.2s ease-out" }}>
          <label className="text-[10px] uppercase tracking-[0.18em]">Token</label>
          <EnvHighlightInput
            value={auth.token ?? ""}
            onValueChange={(val) => onAuthChange({ ...auth, token: val })}
            placeholder="Paste bearer token"
            envVars={envVars}
          />
          <p className="text-[11px] text-muted-foreground/70">
            Generates <code className="rounded-sm border border-border/30 px-1 py-0.5 text-[10px] text-foreground">Authorization: Bearer &lt;token&gt;</code> header. Supports <code className="rounded-sm border border-border/30 px-1 py-0.5 text-[10px] text-foreground">{"{{variables}}"}</code>.
          </p>
        </div>
      )}

      {auth.type === "apikey" && (
        <div className="grid max-w-[420px] gap-4 px-3" style={{ animation: "fadeIn 0.2s ease-out" }}>
          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Key</label>
            <EnvHighlightInput
              value={auth.apiKeyName ?? ""}
              onValueChange={(val) => onAuthChange({ ...auth, apiKeyName: val })}
              placeholder="e.g. X-API-Key"
              envVars={envVars}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Value</label>
            <EnvHighlightInput
              value={auth.apiKeyValue ?? ""}
              onValueChange={(val) => onAuthChange({ ...auth, apiKeyValue: val })}
              placeholder="Enter API key value"
              envVars={envVars}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-[10px] uppercase tracking-[0.18em]">Add to</label>
            <SelectMenu
              value={auth.apiKeyIn ?? "header"}
              options={apiKeyInOptions}
              onChange={(apiKeyIn) => onAuthChange({ ...auth, apiKeyIn })}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            {auth.apiKeyIn === "query"
              ? "Key-value pair will be appended to the URL query string."
              : "Key-value pair will be sent as an HTTP header."}
            {" "}Supports <code className="rounded-sm border border-border/30 px-1 py-0.5 text-[10px] text-foreground">{"{{variables}}"}</code>.
          </p>
        </div>
      )}

      {auth.type === "oauth2" && (
        <OAuth2Panel
          auth={auth}
          onChange={onAuthChange}
          envVars={envVars}
          response={response}
          workspaceName={workspaceName}
          collectionName={collectionName}
        />
      )}

      {(auth.type === "none" || auth.type === "inherit") && (
        <div className="mx-3 border border-border/30 bg-transparent p-3">
          {auth.type === "inherit"
            ? "This request will use the authentication configured on the parent collection."
            : "No authentication will be applied to this request."}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

export function RequestPane({
  state,
  isSending,
  onSend,
  wsState,
  onWebSocketConnect,
  onWebSocketDisconnect,
  onWebSocketSend,
  onChange,
  onTabChange,
  onParamsChange,
  onHeadersChange,
  onAuthChange,
  envVars,
  response,
  workspaceName,
  collectionName,
}) {
  const isWebSocketRequest = state.requestMode === REQUEST_MODES.WEBSOCKET;
  const isSseRequest = state.requestMode === REQUEST_MODES.SSE;
  const isSocketIoRequest = state.requestMode === REQUEST_MODES.SOCKET_IO;
  const isRealtimeRequest = isWebSocketRequest || isSseRequest || isSocketIoRequest;
  const isGrpcRequest = state.requestMode === REQUEST_MODES.GRPC;
  const hasGrpcProtoSelected = Boolean(String(state.grpcProtoFilePath || "").trim());
  const [grpcMethods, setGrpcMethods] = useState([]);
  const [isGrpcMethodsLoading, setIsGrpcMethodsLoading] = useState(false);
  const [grpcMethodError, setGrpcMethodError] = useState("");
  const [isGrpcProtoPickerOpen, setIsGrpcProtoPickerOpen] = useState(false);
  const [showReflectionTooltip, setShowReflectionTooltip] = useState(false);
  const [grpcBodyNotice, setGrpcBodyNotice] = useState("");
  const [showSendErrorModal, setShowSendErrorModal] = useState(false);
  const [sendErrorTitle, setSendErrorTitle] = useState("");
  const [sendErrorTrace, setSendErrorTrace] = useState("");
  const seenErrorKeyRef = useRef("");
  const grpcMethodRecoveryRef = useRef({ requestKey: "", shouldRecover: false, attempted: false });
  const activeWsState = wsState ?? {
    connected: false,
    connecting: false,
    messageCount: 0,
    lastMessage: "",
    lastEventAt: "",
    error: ""
  };
  const selectedGrpcMethod = useMemo(
    () => grpcMethods.find((option) => option.value === state.grpcMethodPath) || null,
    [grpcMethods, state.grpcMethodPath]
  );
  const selectedGrpcStreamingOption = useMemo(
    () => grpcStreamingModes.find((option) => option.value === (selectedGrpcMethod?.streamingMode || state.grpcStreamingMode || "bidi")) || grpcStreamingModes[0],
    [selectedGrpcMethod, state.grpcStreamingMode]
  );
  const hasGrpcMethodSelected = isGrpcRequest && Boolean(String(state.grpcMethodPath || "").trim());
  const grpcBodyHeading = selectedGrpcStreamingOption?.label || "Body";
  const hasValidGrpcUrl = isGrpcRequest && Boolean(String(state.url || "").trim());
  const grpcDirectProtoFiles = useMemo(
    () => (Array.isArray(state.grpcDirectProtoFiles) ? state.grpcDirectProtoFiles : []),
    [state.grpcDirectProtoFiles]
  );
  const grpcProtoDirectories = useMemo(
    () => (Array.isArray(state.grpcProtoDirectories) ? state.grpcProtoDirectories : []),
    [state.grpcProtoDirectories]
  );

  const visibleTabs = isWebSocketRequest
    ? ["Params", "Body", "Auth", "Headers", "Docs"]
    : isSseRequest
      ? ["Params", "Body", "Auth", "Headers", "Docs"]
      : isSocketIoRequest
        ? ["Params", "Body", "Events", "Auth", "Headers", "Docs"]
    : isGrpcRequest
      ? [...(hasGrpcMethodSelected ? ["Body"] : []), "Headers", "Docs"]
      : tabs;
  const activeTab = state.activeEditorTab ?? "Params";
  const bodyDisabled = !isRealtimeRequest && !isGrpcRequest && (state.method === "GET" || state.method === "DELETE" || state.bodyType === "none");
  const isJsonBody = state.bodyType === "json";
  const isGraphqlBody = state.bodyType === "graphql";
  const isTableBody = state.bodyType === "form-data" || state.bodyType === "form-urlencoded";
  const isFileBody = state.bodyType === "file";

  const [debouncedState, setDebouncedState] = useState(state);
  const bodyCacheRef = useRef({});
  const grpcMethodOptions = useMemo(
    () => grpcMethods.map((method) => ({ value: method.value, label: method.label })),
    [grpcMethods]
  );
  const grpcAllKnownProtoPaths = useMemo(() => {
    const fromDirectories = grpcProtoDirectories.flatMap((group) => group.files || []);
    return Array.from(new Set([...grpcDirectProtoFiles, ...fromDirectories]));
  }, [grpcDirectProtoFiles, grpcProtoDirectories]);
  const grpcSelectedProtoFileName = getPathFileName(state.grpcProtoFilePath);

  useEffect(() => {
    const requestKey = `${workspaceName || ""}::${collectionName || ""}::${state.name || ""}`;
    if (grpcMethodRecoveryRef.current.requestKey === requestKey) return;
    grpcMethodRecoveryRef.current = {
      requestKey,
      shouldRecover: isGrpcRequest
        && Boolean(String(state.grpcProtoFilePath || "").trim())
        && !Boolean(String(state.grpcMethodPath || "").trim()),
      attempted: false
    };
  }, [collectionName, isGrpcRequest, state.grpcMethodPath, state.grpcProtoFilePath, state.name, workspaceName]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedState(state), 500);
    return () => clearTimeout(timer);
  }, [state.url, state.body, state.auth, state.headers]);

  useEffect(() => {
    if (!isWebSocketRequest) return;
    if (!visibleTabs.includes(activeTab)) {
      onTabChange("Params");
    }
    if (state.bodyType !== "json" && state.bodyType !== "text") {
      onChange("bodyType", "json");
    }
  }, [activeTab, isWebSocketRequest, onChange, onTabChange, state.bodyType, visibleTabs]);

  useEffect(() => {
    if (!isSocketIoRequest) return;
    if (!visibleTabs.includes(activeTab)) {
      onTabChange("Body");
    }
    if (state.bodyType !== "json" && state.bodyType !== "text") {
      onChange("bodyType", "json");
    }
  }, [activeTab, isSocketIoRequest, onChange, onTabChange, state.bodyType, visibleTabs]);

  useEffect(() => {
    if (!isSseRequest) return;
    if (!visibleTabs.includes(activeTab)) {
      onTabChange("Params");
    }
    if (state.bodyType !== "none") {
      onChange("bodyType", "none");
    }
  }, [activeTab, isSseRequest, onChange, onTabChange, state.bodyType, visibleTabs]);

  useEffect(() => {
    if (!isGrpcRequest) return;
    if (!visibleTabs.includes(activeTab)) {
      onTabChange("Headers");
    }
    if (state.bodyType !== "json") {
      onChange("bodyType", "json");
    }
  }, [activeTab, isGrpcRequest, onChange, onTabChange, state.bodyType, visibleTabs]);

  useEffect(() => {
    if (!isGrpcRequest || !hasGrpcProtoSelected) {
      setGrpcMethods([]);
      setGrpcMethodError("");
      setIsGrpcMethodsLoading(false);
      return;
    }

    let cancelled = false;
    setIsGrpcMethodsLoading(true);
    setGrpcMethodError("");

    parseGrpcProtoFile(state.grpcProtoFilePath)
      .then((parsed) => {
        if (cancelled) return;
        const methods = Array.isArray(parsed) ? parsed : [];
        setGrpcMethods(methods);
      })
      .catch((error) => {
        if (cancelled) return;
        setGrpcMethods([]);
        setGrpcMethodError(String(error || "Failed to parse proto file."));
      })
      .finally(() => {
        if (!cancelled) {
          setIsGrpcMethodsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasGrpcProtoSelected, isGrpcRequest, state.grpcProtoFilePath]);

  useEffect(() => {
    if (!isGrpcRequest) return;
    if (!Array.isArray(grpcAllKnownProtoPaths) || grpcAllKnownProtoPaths.length === 0) return;
    const current = String(state.grpcProtoFilePath || "").trim();
    if (current) return;
    onChange("grpcProtoFilePath", grpcAllKnownProtoPaths[0]);
  }, [grpcAllKnownProtoPaths, isGrpcRequest, onChange, state.grpcProtoFilePath]);

  useEffect(() => {
    if (!isGrpcRequest) return;
    const current = String(state.grpcProtoFilePath || "").trim();
    if (!current) return;
    const hasCurrent = grpcAllKnownProtoPaths.some((path) => normalizePath(path) === normalizePath(current));
    if (hasCurrent) return;
    onChange("grpcDirectProtoFiles", [...grpcDirectProtoFiles, current]);
  }, [grpcAllKnownProtoPaths, grpcDirectProtoFiles, isGrpcRequest, onChange, state.grpcProtoFilePath]);

  useEffect(() => {
    const status = Number(response?.status || 0);
    const savedAt = String(response?.savedAt || "");
    const bodyText = String(response?.rawBody || response?.body || "").trim();
    const badgeText = String(response?.badge || "").toLowerCase();
    const statusLabel = String(response?.statusText || "").toLowerCase();
    const looksLikeError = badgeText.includes("error")
      || badgeText.includes("failed")
      || statusLabel.includes("error")
      || statusLabel.includes("failed");
    const isError = status >= 400 || (status === 0 && looksLikeError);
    if (!isError || !savedAt) return;
    const key = `${savedAt}-${status}-${bodyText.slice(0, 80)}`;
    if (seenErrorKeyRef.current === key) return;
    seenErrorKeyRef.current = key;
    const firstLine = bodyText.split(/\r?\n/)[0] || response?.statusText || "Request failed";
    setSendErrorTitle(firstLine);
    setSendErrorTrace(buildResponseErrorTrace(response, firstLine));
    setShowSendErrorModal(true);
  }, [response?.status, response?.savedAt, response?.rawBody, response?.body, response?.statusText, response?.badge, response?.headers, response?.meta]);

  useEffect(() => {
    if (!isGrpcRequest) return;
    if (!selectedGrpcMethod) return;
    if (selectedGrpcMethod.streamingMode && state.grpcStreamingMode !== selectedGrpcMethod.streamingMode) {
      onChange("grpcStreamingMode", selectedGrpcMethod.streamingMode);
    }
  }, [isGrpcRequest, onChange, selectedGrpcMethod, state.grpcStreamingMode]);

  useEffect(() => {
    const recoveryState = grpcMethodRecoveryRef.current;
    if (!isGrpcRequest || !recoveryState.shouldRecover || recoveryState.attempted) return;
    if (!hasGrpcProtoSelected || isGrpcMethodsLoading) return;

    recoveryState.attempted = true;
    if (!Array.isArray(grpcMethods) || grpcMethods.length === 0) return;
    if (String(state.grpcMethodPath || "").trim()) return;

    const preferred = grpcMethods.find((method) => method?.streamingMode === state.grpcStreamingMode) || grpcMethods[0];
    if (!preferred?.value) return;
    onChange("grpcMethodPath", preferred.value);
  }, [grpcMethods, hasGrpcProtoSelected, isGrpcMethodsLoading, isGrpcRequest, onChange, state.grpcMethodPath, state.grpcStreamingMode]);

  const missingVars = useMemo(() => {
    if (!envVars) return [];
    const merged = envVars.merged ?? {};
    const auth = debouncedState.auth ?? {};
    const oauthRows = auth.oauth2?.extraTokenParams ?? [];
    const allText = [
      debouncedState.url ?? "",
      ...(debouncedState.headers ?? []).map((h) => `${h.key}=${h.value}`),
      debouncedState.body ?? "",
      auth.token ?? "",
      auth.username ?? "",
      auth.password ?? "",
      auth.apiKeyName ?? "",
      auth.apiKeyValue ?? "",
      auth.oauth2?.authUrl ?? "",
      auth.oauth2?.tokenUrl ?? "",
      auth.oauth2?.callbackUrl ?? "",
      auth.oauth2?.clientId ?? "",
      auth.oauth2?.clientSecret ?? "",
      auth.oauth2?.scope ?? "",
      auth.oauth2?.audience ?? "",
      auth.oauth2?.resource ?? "",
      auth.oauth2?.authorizationCode ?? "",
      auth.oauth2?.refreshToken ?? "",
      auth.oauth2?.accessToken ?? "",
      auth.oauth2?.tokenType ?? "",
      auth.oauth2?.username ?? "",
      auth.oauth2?.password ?? "",
      auth.oauth2?.state ?? "",
      auth.oauth2?.codeVerifier ?? "",
      auth.oauth2?.clientAuthMethod ?? "",
      ...oauthRows.map((row) => `${row?.key ?? ""}=${row?.value ?? ""}`),
    ].join(" ");

    const placeholders = [...allText.matchAll(/\{\{+\s*([^{}]+?)\s*\}\}+/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);

    return [...new Set(placeholders)].filter((key) => !(key in merged));
  }, [debouncedState, envVars]);

  function handleFormatBody() {
    if (!isJsonBody) return;
    onChange("body", formatJsonText(state.body));
  }

  function handleBodyTypeChange(bodyType) {
    const currentType = state.bodyType;
    const textBodyTypes = ["json", "graphql", "xml", "yaml", "text"];

    if (textBodyTypes.includes(currentType)) {
      bodyCacheRef.current[currentType] = String(state.body ?? "");
    }

    onChange("bodyType", bodyType);

    if (textBodyTypes.includes(bodyType)) {
      const nextBody = typeof bodyCacheRef.current[bodyType] === "string" ? bodyCacheRef.current[bodyType] : "";
      onChange("body", nextBody);
    }

    if (bodyType !== "graphql") {
      onChange("graphqlVariables", "");
    }
    if (bodyType !== "file") {
      onChange("bodyFilePath", "");
    }
  }

  async function handleBodyFileBrowse() {
    try {
      const selected = await open({ directory: false, multiple: false });
      if (typeof selected === "string") {
        onChange("bodyFilePath", selected);
      }
    } catch {
    }
  }

  async function handleGrpcProtoBrowse() {
    try {
      setIsGrpcProtoPickerOpen(true);
    } catch {
    }
  }

  async function handleGrpcAddProtoFile() {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "Protocol Buffers", extensions: ["proto"] }]
      });
      if (typeof selected !== "string") return;
      if (grpcDirectProtoFiles.some((path) => normalizePath(path) === normalizePath(selected))) return;
      onChange("grpcDirectProtoFiles", [...grpcDirectProtoFiles, selected]);
    } catch {
    }
  }

  async function handleGrpcAddDirectory() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      const files = await listGrpcProtoFilesInDirectory(selected);
      const nextFiles = Array.isArray(files) ? files : [];
      const filtered = nextFiles.filter((path) => String(path || "").trim());
      const without = grpcProtoDirectories.filter((group) => normalizePath(group.path) !== normalizePath(selected));
      onChange("grpcProtoDirectories", [...without, { path: selected, files: filtered }]);
    } catch {
    }
  }

  function handleGrpcProtoPickerSave(path) {
    if (!path) return;
    onChange("grpcProtoFilePath", path);
    onChange("grpcMethodPath", "");
    setIsGrpcProtoPickerOpen(false);
  }

  function handleGrpcDirectFileRemove(path) {
    onChange("grpcDirectProtoFiles", grpcDirectProtoFiles.filter((entry) => normalizePath(entry) !== normalizePath(path)));
    if (state.grpcProtoFilePath === path) {
      onChange("grpcProtoFilePath", "");
      onChange("grpcMethodPath", "");
    }
  }

  function handleGrpcDirectoryRemove(dirPath) {
    const removedGroup = grpcProtoDirectories.find((group) => normalizePath(group.path) === normalizePath(dirPath));
    onChange("grpcProtoDirectories", grpcProtoDirectories.filter((group) => normalizePath(group.path) !== normalizePath(dirPath)));
    if (!removedGroup) return;
    if ((removedGroup.files || []).some((path) => normalizePath(path) === normalizePath(state.grpcProtoFilePath))) {
      onChange("grpcProtoFilePath", "");
      onChange("grpcMethodPath", "");
    }
  }

  function handleGrpcDirectoryFileRemove(dirPath, filePath) {
    const nextDirectories = grpcProtoDirectories.map((group) => {
      if (normalizePath(group.path) !== normalizePath(dirPath)) return group;
      return { ...group, files: (group.files || []).filter((path) => normalizePath(path) !== normalizePath(filePath)) };
    }).filter((group) => (group.files || []).length > 0);
    onChange("grpcProtoDirectories", nextDirectories);
    if (normalizePath(state.grpcProtoFilePath) === normalizePath(filePath)) {
      onChange("grpcProtoFilePath", "");
      onChange("grpcMethodPath", "");
    }
  }

  function handleGrpcBodyChange(value) {
    onChange("body", value);
    if (selectedGrpcMethod?.streamingMode === "unary") {
      const trimmed = String(value || "").trim();
      if (!trimmed) {
        setGrpcBodyNotice("");
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          setGrpcBodyNotice("Unary expects a single JSON object payload.");
        } else {
          setGrpcBodyNotice("");
        }
      } catch {
        setGrpcBodyNotice("");
      }
      return;
    }

    setGrpcBodyNotice("");
  }

  function handleGrpcReflectionRefresh() {
    if (!hasValidGrpcUrl) return;
  }

  return (
    <Card className="flex h-full min-h-0 flex-col gap-0 overflow-hidden border-0 border-r border-border/30 bg-background p-0 shadow-none">
      <div className={cn(
        "grid gap-px border-b border-border/25 bg-transparent",
        isGrpcRequest
          ? "grid-cols-[88px_minmax(0,1fr)_92px] xl:grid-cols-[100px_minmax(0,1fr)_260px_40px_40px_108px]"
          : "grid-cols-[108px_minmax(0,1fr)_92px] lg:grid-cols-[124px_minmax(0,1fr)_108px]"
      )}>
        {isWebSocketRequest ? (
          <div className="flex h-8 items-center px-3 lg:h-10">
            <span className="font-semibold uppercase tracking-[0.14em] text-amber-300">WS</span>
          </div>
        ) : isSocketIoRequest ? (
          <div className="flex h-8 items-center px-3 lg:h-10">
            <span className="font-semibold uppercase tracking-[0.14em] text-orange-300">Socket.IO</span>
          </div>
        ) : isGrpcRequest ? (
          <div className="flex h-8 items-center px-3 lg:h-10">
            <span className="font-semibold uppercase tracking-[0.14em] text-cyan-300">gRPC</span>
          </div>
        ) : (
          <MethodPicker value={state.method} onChange={(method) => onChange("method", method)} />
        )}

        <EnvHighlightInput
          inputClassName="h-8 rounded-none border-0 bg-transparent text-[12.5px] lg:h-10 lg:text-[14px]"
          value={state.url}
          onValueChange={(val) => onChange("url", val)}
          placeholder={isWebSocketRequest ? "wss://example.com/chat" : isSocketIoRequest ? "ws://example.com/socket.io/?EIO=4&transport=websocket" : isGrpcRequest ? "grpcb.in:9000" : isSseRequest ? "https://example.com/events" : "https://api.example.com/v1/users"}
          envVars={envVars}
        />

        {isGrpcRequest ? (
          <Button
            className="h-8 gap-1.5 rounded-none px-2.5 text-[12px] xl:hidden"
            onClick={onSend}
            type="button"
            disabled={isSending}
          >
            Start
          </Button>
        ) : null}

        {isGrpcRequest ? (
          hasGrpcProtoSelected ? (
            <SelectMenu
              value={state.grpcMethodPath || ""}
              options={grpcMethodOptions.length > 0 ? grpcMethodOptions : [{ value: "", label: isGrpcMethodsLoading ? "Loading methods..." : "No methods found" }]}
              onChange={(methodPath) => onChange("grpcMethodPath", methodPath)}
              className="hidden xl:block"
              buttonClassName="h-8 rounded-none border-0 bg-transparent text-[12px] lg:h-10 lg:text-[13px]"
            />
          ) : (
            <div className="hidden h-8 items-center border-0 bg-transparent px-3 text-[12px] text-muted-foreground xl:flex xl:h-10 xl:text-[13px]">
              Select method
            </div>
          )
        ) : null}

        {isGrpcRequest ? (
          <div className="relative hidden h-8 xl:block xl:h-10" onMouseEnter={() => setShowReflectionTooltip(true)} onMouseLeave={() => setShowReflectionTooltip(false)}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 rounded-none text-muted-foreground lg:h-10"
              disabled={!hasValidGrpcUrl}
              onClick={handleGrpcReflectionRefresh}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            {showReflectionTooltip && hasValidGrpcUrl ? (
              <div className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-30 -translate-x-1/2 whitespace-nowrap border border-border/40 bg-popover px-2 py-1 text-[11px] text-foreground shadow-lg">
                Click to use server reflection
              </div>
            ) : null}
          </div>
        ) : null}

        {isGrpcRequest ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden h-8 rounded-none text-muted-foreground xl:inline-flex xl:h-10"
            onClick={handleGrpcProtoBrowse}
          >
            <FileCode2 className="h-4 w-4" />
          </Button>
        ) : null}

        <Button
          className={cn(
            "h-8 gap-1.5 rounded-none px-2.5 text-[12px] lg:h-10 lg:text-[14px]",
            isGrpcRequest && "hidden xl:inline-flex"
          )}
          onClick={onSend}
          type="button"
          disabled={isRealtimeRequest ? false : isSending}
        >
          {isRealtimeRequest ? (activeWsState.connecting ? "Connecting..." : (activeWsState.connected ? "Disconnect" : "Connect")) : isGrpcRequest ? null : <SendHorizontal className="h-3 w-3 lg:h-4 lg:w-4" />}
          {isRealtimeRequest ? null : (isGrpcRequest ? "Start" : (isSending ? "Sending" : "Send"))}
        </Button>
      </div>

      {isGrpcRequest ? (
        <div className="grid grid-cols-[minmax(0,1fr)_34px_34px] gap-px border-b border-border/25 bg-transparent xl:hidden">
          {hasGrpcProtoSelected ? (
            <SelectMenu
              value={state.grpcMethodPath || ""}
              options={grpcMethodOptions.length > 0 ? grpcMethodOptions : [{ value: "", label: isGrpcMethodsLoading ? "Loading methods..." : "No methods found" }]}
              onChange={(methodPath) => onChange("grpcMethodPath", methodPath)}
              buttonClassName="h-8 rounded-none border-0 bg-transparent text-[12px]"
            />
          ) : (
            <div className="flex h-8 items-center border-0 bg-transparent px-3 text-[12px] text-muted-foreground">
              Select method
            </div>
          )}

          <div className="relative h-8" onMouseEnter={() => setShowReflectionTooltip(true)} onMouseLeave={() => setShowReflectionTooltip(false)}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 rounded-none text-muted-foreground"
              disabled={!hasValidGrpcUrl}
              onClick={handleGrpcReflectionRefresh}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            {showReflectionTooltip && hasValidGrpcUrl ? (
              <div className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-30 -translate-x-1/2 whitespace-nowrap border border-border/40 bg-popover px-2 py-1 text-[11px] text-foreground shadow-lg">
                Click to use server reflection
              </div>
            ) : null}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 rounded-none text-muted-foreground"
            onClick={handleGrpcProtoBrowse}
          >
            <FileCode2 className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {isGrpcRequest ? (
        <div className="flex items-center justify-between border-b border-border/20 bg-transparent px-3 py-2 text-[11px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2 truncate">
            <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
            <span className="truncate">{grpcSelectedProtoFileName || "No .proto file selected"}</span>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-[11px]" onClick={handleGrpcProtoBrowse}>
            <FileCode2 className="h-3.5 w-3.5" /> Proto
          </Button>
        </div>
      ) : null}

      {isGrpcRequest && grpcMethodError ? (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.08] px-3 py-1.5 text-[11px] text-amber-500 dark:text-amber-400">
          <span>Failed to parse proto file.</span>
        </div>
      ) : null}

      {isRealtimeRequest && activeWsState.error ? (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.08] px-3 py-1.5 text-[11px] text-amber-500 dark:text-amber-400">
          <span>{activeWsState.error}</span>
        </div>
      ) : null}

      {missingVars.length > 0 && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.08] px-3 py-1.5 text-[11px] text-amber-500 dark:text-amber-400">
          <span className="shrink-0">âš </span>
          <span>
            Undefined variable{missingVars.length > 1 ? "s" : ""}:{" "}
            <code className="font-mono">{missingVars.map((k) => `{{${k}}}`).join(", ")}</code>
          </span>
        </div>
      )}

      <div className="border-b border-border/25 px-2 py-2 text-[11px] text-muted-foreground lg:text-[12px]">
        <div className="flex items-center gap-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={cn("px-2 py-1 text-muted-foreground transition-colors lg:px-3 lg:py-1.5", activeTab === tab && "text-foreground")}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-transparent">
        {activeTab === "Params" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] text-[12px]">
            <div className="border-b border-border/20 px-3 py-3">
              <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">URL Preview</div>
              <div className="bg-transparent px-3 py-2 text-foreground">{state.url}</div>
            </div>
            <TableEditor rows={state.queryParams} onChange={onParamsChange} title="Query Parameters" addLabel="Add" />
          </div>
        ) : null}

        {activeTab === "Headers" ? (
          isWebSocketRequest ? (
            <WebSocketHeadersPanel headers={state.headers} onHeadersChange={onHeadersChange} />
          ) : isSseRequest ? (
            <SseHeadersPanel headers={state.headers} onHeadersChange={onHeadersChange} />
          ) : isSocketIoRequest ? (
            <SocketIoHeadersPanel headers={state.headers} onHeadersChange={onHeadersChange} />
          ) : isGrpcRequest ? (
            <GrpcHeadersPanel headers={state.headers} onHeadersChange={onHeadersChange} />
          ) : (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <label className="flex items-center gap-2 border-b border-border/20 bg-transparent px-4 py-2.5 text-[11px] text-muted-foreground lg:text-[12px] cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-primary w-3 h-3.5 outline-none"
                  checked={state.inheritHeaders ?? true}
                  onChange={(e) => onChange("inheritHeaders", e.target.checked)}
                />
                Inherit default headers from parent collection
              </label>
              <TableEditor rows={state.headers} onChange={onHeadersChange} keyLabel="header" valueLabel="value" title="Headers" addLabel="Add" />
            </div>
          )
        ) : null}

        {activeTab === "Body" ? (
          isSseRequest ? (
            <SseOptionsPanel state={state} onChange={onChange} />
          ) :
          isGrpcRequest && hasGrpcMethodSelected ? (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="flex items-center justify-between gap-3 border-b border-border/20 px-3 py-2 text-[11px] text-muted-foreground">
                <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-cyan-300">{grpcBodyHeading}</div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Body</div>
              </div>
              <CodeEditor
                value={state.body}
                onChange={handleGrpcBodyChange}
                placeholder={selectedGrpcMethod?.streamingMode === "unary" ? "{\n  \"isbn\": 1\n}" : "[{\n  \"isbn\": 1\n}]"}
                language="json"
                disabled={false}
              />
              {grpcBodyNotice ? (
                <div className="border-t border-amber-500/20 bg-amber-500/[0.08] px-3 py-1.5 text-[11px] text-amber-500 dark:text-amber-400">
                  {grpcBodyNotice}
                </div>
              ) : null}
            </div>
          ) : (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div className="flex items-center justify-between gap-3 border-b border-border/20 px-3 py-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <SelectMenu
                  value={state.bodyType}
                  options={(isWebSocketRequest || isSocketIoRequest) ? webSocketBodyModes : requestBodyModes}
                  onChange={handleBodyTypeChange}
                  className="min-w-[180px]"
                />
                <div className="flex items-center gap-1 border border-border/25 bg-transparent px-2.5 py-1.5 uppercase tracking-[0.14em]">
                  <Braces className="h-3 w-3" />
                  <span>{isWebSocketRequest ? "WebSocket Message" : isSocketIoRequest ? "Socket.IO Payload" : (isGraphqlBody ? "GraphQL Request" : isTableBody ? "Form Request" : isFileBody ? "Binary/File Upload" : isJsonBody ? "JSON Highlight" : "Plain Editor")}</span>
                </div>
              </div>
              {isWebSocketRequest || isSocketIoRequest ? (
                <Button variant="outline" size="sm" className="h-8 px-2.5 text-[11px]" type="button" onClick={onWebSocketSend} disabled={!activeWsState.connected}>
                  Send
                </Button>
              ) : isJsonBody ? (
                <Button variant="outline" size="sm" className="h-8 px-2.5 text-[11px]" type="button" onClick={handleFormatBody} disabled={bodyDisabled}>
                  <Wand2 className="h-3 w-3" />
                  Format JSON
                </Button>
              ) : null}
            </div>

            {isTableBody ? (
              <TableEditor
                rows={state.bodyRows}
                onChange={(bodyRows) => onChange("bodyRows", bodyRows)}
                keyLabel="name"
                valueLabel="value"
                title={state.bodyType === "form-data" ? "Multipart Form" : "Form URL Encoded"}
                addLabel="Add"
                disabled={bodyDisabled}
              />
            ) : null}

            {isGraphqlBody ? (
              <GraphQLEditor
                query={state.body}
                variables={state.graphqlVariables}
                onQueryChange={(value) => onChange("body", value)}
                onVariablesChange={(value) => onChange("graphqlVariables", value)}
                disabled={bodyDisabled}
              />
            ) : null}

            {isFileBody ? (
              <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-transparent">
                <div className="flex items-center justify-between border-b border-border/20 px-3 py-2 text-[11px] text-muted-foreground lg:text-[12px]">
                  <span className="font-medium text-foreground">Request File</span>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={handleBodyFileBrowse}>
                      Browse
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={() => onChange("bodyFilePath", "")}>
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="thin-scrollbar min-h-0 overflow-auto px-4 py-3 text-[12px] text-muted-foreground">
                  {state.bodyFilePath ? (
                    <div className="break-all text-foreground">{state.bodyFilePath}</div>
                  ) : (
                    <div>Select a file to send as request body.</div>
                  )}
                </div>
              </div>
            ) : null}

            {!isTableBody && !isGraphqlBody && !isFileBody ? (
              <CodeEditor
                value={state.body}
                onChange={(value) => onChange("body", value)}
                placeholder={isJsonBody ? '{\n  "name": "Kivo"\n}' : "Enter request body..."}
                language={isJsonBody ? "json" : "text"}
                disabled={bodyDisabled}
              />
            ) : null}
          </div>
          )
        ) : null}

        {activeTab === "Events" && isSocketIoRequest ? (
          <SocketIoEventsPanel state={state} onChange={onChange} />
        ) : null}

        {activeTab === "Auth" ? (
          <div className="h-full bg-transparent">
            <AuthPanel
              state={state}
              onAuthChange={onAuthChange}
              envVars={envVars}
              response={response}
              workspaceName={workspaceName}
              collectionName={collectionName}
            />
          </div>
        ) : null}

        {activeTab === "Docs" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Notes</div>
            <textarea
              className="thin-scrollbar min-h-0 flex-1 resize-none border-0 bg-transparent p-3 text-[12px] leading-5 text-foreground outline-none"
              value={state.docs}
              onChange={(event) => onChange("docs", event.target.value)}
              placeholder="Request notes, examples, reminders..."
            />
          </div>
        ) : null}

        {activeTab === "Settings" ? (
          <RequestSettingsPanel state={state} onChange={onChange} />
        ) : null}
      </div>

      <GrpcProtoPickerModal
        open={isGrpcProtoPickerOpen}
        selectedPath={state.grpcProtoFilePath}
        directFiles={grpcDirectProtoFiles}
        directoryGroups={grpcProtoDirectories}
        onClose={() => setIsGrpcProtoPickerOpen(false)}
        onSave={handleGrpcProtoPickerSave}
        onAddFile={handleGrpcAddProtoFile}
        onAddDirectory={handleGrpcAddDirectory}
        onRemoveDirectFile={handleGrpcDirectFileRemove}
        onRemoveDirectory={handleGrpcDirectoryRemove}
        onRemoveDirectoryFile={handleGrpcDirectoryFileRemove}
        loading={isGrpcMethodsLoading}
      />

      <SendErrorModal
        open={showSendErrorModal}
        title={sendErrorTitle}
        stackTrace={sendErrorTrace}
        onClose={() => setShowSendErrorModal(false)}
      />
    </Card>
  );
}

