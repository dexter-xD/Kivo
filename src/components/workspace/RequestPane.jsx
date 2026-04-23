import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, ChevronDown, Eye, EyeOff, Plus, SendHorizontal, Trash2, Wand2, PenLine, Table2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

import { CodeEditor } from "@/components/workspace/CodeEditor.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Input } from "@/components/ui/input.jsx";
import { OAuth2Panel } from "@/components/workspace/OAuth2Panel.jsx";
import { formatGraphqlText, formatJsonText } from "@/lib/formatters.js";
import { getMethodTone, requestBodyModes } from "@/lib/http-ui.js";
import { cn } from "@/lib/utils.js";
import { EnvHighlightInput } from "@/components/ui/EnvHighlightInput.jsx";

const tabs = ["Params", "Body", "Auth", "Headers", "Docs"];
const requestMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
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
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background/10">
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
                <div key={row.id || `row-${index}`} className={cn("grid grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)_36px] border-b border-border/10 px-1", index % 2 === 0 && "bg-background/5")}>
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
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] overflow-hidden bg-background/10">
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

function SelectMenu({ value, options, onChange, className, renderValue, renderOption, buttonClassName }) {
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
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-8 w-full items-center justify-between border border-border/35 bg-background/30 px-3 text-left text-[12px] text-foreground outline-none transition-colors hover:bg-background/45 focus-visible:ring-1 focus-visible:ring-ring",
          buttonClassName
        )}
      >
        <span className="truncate">{renderValue ? renderValue(selected) : selected.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-full overflow-hidden border border-border/45 bg-popover">
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
                  active ? "bg-secondary/55 text-foreground" : "text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
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
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground z-10"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            Generates <code className="text-[10px] bg-primary/10 text-primary px-1 py-0.5 rounded-sm">Authorization: Basic base64(user:pass)</code> header. Supports <code className="text-[10px] bg-primary/10 text-primary px-1 py-0.5 rounded-sm">{"{{variables}}"}</code>.
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
            Generates <code className="text-[10px] bg-primary/10 text-primary px-1 py-0.5 rounded-sm">Authorization: Bearer &lt;token&gt;</code> header. Supports <code className="text-[10px] bg-primary/10 text-primary px-1 py-0.5 rounded-sm">{"{{variables}}"}</code>.
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
            {" "}Supports <code className="text-[10px] bg-primary/10 text-primary px-1 py-0.5 rounded-sm">{"{{variables}}"}</code>.
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
        <div className="mx-3 bg-background/20 p-3">
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
  const activeTab = state.activeEditorTab ?? "Params";
  const bodyDisabled = state.method === "GET" || state.method === "DELETE" || state.bodyType === "none";
  const isJsonBody = state.bodyType === "json";
  const isGraphqlBody = state.bodyType === "graphql";
  const isTableBody = state.bodyType === "form-data" || state.bodyType === "form-urlencoded";
  const isFileBody = state.bodyType === "file";

  const [debouncedState, setDebouncedState] = useState(state);
  const bodyCacheRef = useRef({});

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedState(state), 500);
    return () => clearTimeout(timer);
  }, [state.url, state.body, state.auth, state.headers]);

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

  return (
    <Card className="flex h-full min-h-0 flex-col gap-0 overflow-hidden border-0 border-r border-border/30 bg-card/84 p-0 shadow-none">
      <div className="grid grid-cols-[108px_minmax(0,1fr)_92px] gap-px border-b border-border/25 bg-border/20 lg:grid-cols-[124px_minmax(0,1fr)_108px]">
        <MethodPicker value={state.method} onChange={(method) => onChange("method", method)} />

        <EnvHighlightInput
          inputClassName="h-8 rounded-none border-0 bg-input/60 text-[12.5px] lg:h-10 lg:text-[14px]"
          value={state.url}
          onValueChange={(val) => onChange("url", val)}
          placeholder="https://api.example.com/v1/users"
          envVars={envVars}
        />

        <Button className="h-8 gap-1.5 rounded-none px-2.5 text-[12px] lg:h-10 lg:text-[14px]" onClick={onSend} type="button" disabled={isSending}>
          <SendHorizontal className="h-3 w-3 lg:h-4 lg:w-4" />
          {isSending ? "Sending" : "Send"}
        </Button>
      </div>

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
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={cn("px-2 py-1 text-muted-foreground transition-colors lg:px-3 lg:py-1.5", activeTab === tab && "bg-secondary/35 text-foreground")}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "Params" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] text-[12px]">
            <div className="border-b border-border/20 px-3 py-3">
              <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">URL Preview</div>
              <div className="bg-background/20 px-3 py-2 text-foreground">{state.url}</div>
            </div>
            <TableEditor rows={state.queryParams} onChange={onParamsChange} title="Query Parameters" addLabel="Add" />
          </div>
        ) : null}

        {activeTab === "Headers" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <label className="flex items-center gap-2 border-b border-border/20 px-4 py-2.5 text-[11px] text-muted-foreground lg:text-[12px] bg-background/10 cursor-pointer hover:bg-background/20 transition-colors">
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
        ) : null}

        {activeTab === "Body" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
            <div className="flex items-center justify-between gap-3 border-b border-border/20 px-3 py-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <SelectMenu
                  value={state.bodyType}
                  options={requestBodyModes}
                  onChange={handleBodyTypeChange}
                  className="min-w-[180px]"
                />
                <div className="flex items-center gap-1 border border-border/25 bg-background/20 px-2.5 py-1.5 uppercase tracking-[0.14em]">
                  <Braces className="h-3 w-3" />
                  <span>{isGraphqlBody ? "GraphQL Request" : isTableBody ? "Form Request" : isFileBody ? "Binary/File Upload" : isJsonBody ? "JSON Highlight" : "Plain Editor"}</span>
                </div>
              </div>
              {isJsonBody ? (
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
              <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background/10">
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
        ) : null}

        {activeTab === "Auth" ? (
          <AuthPanel
            state={state}
            onAuthChange={onAuthChange}
            envVars={envVars}
            response={response}
            workspaceName={workspaceName}
            collectionName={collectionName}
          />
        ) : null}

        {activeTab === "Docs" ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Notes</div>
            <textarea
              className="thin-scrollbar min-h-0 flex-1 resize-none border-0 bg-background/20 p-3 text-[12px] leading-5 text-foreground outline-none"
              value={state.docs}
              onChange={(event) => onChange("docs", event.target.value)}
              placeholder="Request notes, examples, reminders..."
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

