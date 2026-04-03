import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, Code2, Copy, FolderKanban, Layers, MoreVertical, Pencil, Pin, Plus, Search, SquareKanban, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { CodeEditor } from "@/components/workspace/CodeEditor.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Input } from "@/components/ui/input.jsx";
import { buildCurlCommand, codegenLanguageOptions, generateCodeSnippet, getMethodTone } from "@/lib/http-ui.js";
import { cn } from "@/lib/utils.js";
import { getUniqueName } from "@/lib/workspace-store.js";
import { WorkspaceModal } from "./WorkspaceModal.jsx";

function getRequestRecord(workspaces, workspaceName, collectionName, requestName) {
  return workspaces
    .find((w) => w.name === workspaceName)
    ?.collections?.find((c) => c.name === collectionName)
    ?.requests?.find((r) => r.name === requestName) ?? null;
}

function WorkspaceForm({ initialValues, submitLabel, onSubmit, onCancel }) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");

  function handleSubmit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-2 border border-border/35 bg-card/45 p-3">
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" />
      <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" className="h-8 px-3 text-[11px]">
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 px-3 text-[11px]" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RenameField({ value, onSubmit, onCancel, placeholder = "Name" }) {
  const [name, setName] = useState(value);

  return (
    <form
      className="flex items-center gap-2 px-2 py-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) {
          onSubmit(name.trim());
        }
      }}
    >
      <Input className="h-7 text-[12px]" autoFocus value={name} onChange={(event) => setName(event.target.value)} onBlur={() => onCancel()} placeholder={placeholder} />
    </form>
  );
}

function CreationField({ initialValue, existingNames, onSubmit, onCancel, placeholder = "Name" }) {
  const [name, setName] = useState(() => getUniqueName(initialValue, existingNames));
  const isDuplicate = useMemo(() => existingNames.includes(name.trim()), [name, existingNames]);
  const isValid = name.trim().length > 0 && !isDuplicate;

  function handleSubmit(e) {
    e?.preventDefault();
    if (isValid) {
      onSubmit(name.trim());
    }
  }

  return (
    <form
      className="flex items-center gap-1.5 px-1 py-1"
      onSubmit={handleSubmit}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative flex-1">
        <Input
          className={cn(
            "h-7 text-[12px] pr-7",
            isDuplicate && "border-red-500 focus-visible:ring-red-500"
          )}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          placeholder={placeholder}
        />
        {isDuplicate && (
          <div className="absolute left-0 -bottom-4 text-[9px] text-red-500 whitespace-nowrap">
            Name already exists
          </div>
        )}
      </div>
      <button
        type="submit"
        disabled={!isValid}
        className={cn(
          "p-1 rounded hover:bg-accent transition-colors",
          isValid ? "text-green-500" : "text-muted-foreground opacity-50 cursor-not-allowed"
        )}
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="p-1 rounded hover:bg-accent text-red-500 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}

function GenerateCodeModal({ request, language, onLanguageChange, onClose }) {
  const [copied, setCopied] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const languageMenuRef = useRef(null);
  const selectedLanguage = useMemo(
    () => codegenLanguageOptions.find((option) => option.value === language) ?? codegenLanguageOptions[0],
    [language]
  );
  const codeSnippet = useMemo(
    () => (request ? generateCodeSnippet(request, language) : ""),
    [language, request]
  );

  useEffect(() => {
    if (!request) return;
    setCopied(false);
    function handleEscape(event) {
      if (event.key === "Escape") {
        if (languageOpen) {
          setLanguageOpen(false);
          return;
        }
        onClose();
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [language, languageOpen, onClose, request]);

  useEffect(() => {
    if (!languageOpen) return;
    function handlePointer(event) {
      if (languageMenuRef.current && !languageMenuRef.current.contains(event.target)) {
        setLanguageOpen(false);
      }
    }
    window.addEventListener("mousedown", handlePointer);
    return () => window.removeEventListener("mousedown", handlePointer);
  }, [languageOpen]);

  if (!request) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codeSnippet);
      setCopied(true);
    } catch (e) {
      console.error("Failed to copy", e);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Card className="grid h-[min(720px,92vh)] w-[min(920px,92vw)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-4 border border-border/50 bg-card/95 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Generate Code</div>
            <div className="mt-1 truncate text-[18px] font-semibold text-foreground">{request.name}</div>
          </div>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-3" onClick={onClose}>Close</Button>
        </div>
        <div className="grid gap-2 sm:max-w-[260px]">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Language</label>
          <div ref={languageMenuRef} className="relative">
            <button type="button" onClick={() => setLanguageOpen((c) => !c)} className="flex h-9 w-full items-center justify-between border border-border/40 bg-background/70 px-3 text-[12px] text-foreground outline-none transition-colors hover:bg-accent/35 focus-visible:ring-1 focus-visible:ring-ring">
              <span>{selectedLanguage.label}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", languageOpen && "rotate-180")} />
            </button>
            {languageOpen && (
              <div className="thin-scrollbar absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-64 overflow-auto border border-border/60 bg-popover shadow-2xl">
                {codegenLanguageOptions.map((option) => {
                  const active = option.value === language;
                  return (
                    <button key={option.value} type="button" onClick={() => { onLanguageChange(option.value); setLanguageOpen(false); }} className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-[12px] transition-colors", active ? "bg-accent/55 text-foreground" : "text-foreground hover:bg-accent/35")}>
                      <span>{option.label}</span>
                      {active && <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Selected</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <CodeEditor value={codeSnippet} readOnly language="text" className="border border-border/30" />
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-muted-foreground">{copied ? "Code copied to clipboard." : "Choose a language and copy the generated snippet."}</div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="h-9 px-4 text-[12px]" onClick={handleCopy}>{copied ? "Copied" : "Copy Code"}</Button>
            <Button type="button" className="h-9 px-4 text-[12px]" onClick={onClose}>Done</Button>
          </div>
        </div>
      </Card>
    </div>,
    document.body
  );
}

function RequestContextMenu({ menu, onGenerateCode, onCopyCurl, onRename, onDuplicate, onCopy, onPaste, onReveal, onTogglePin, onDelete, onClose, canPaste }) {
  useEffect(() => {
    if (!menu) return;
    function handlePointer() { onClose(); }
    function handleEscape(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleEscape);
    return () => { window.removeEventListener("mousedown", handlePointer); window.removeEventListener("keydown", handleEscape); };
  }, [menu, onClose]);

  if (!menu) return null;

  return createPortal(
    <div className="fixed z-[210] min-w-[180px] border border-border/60 bg-popover p-1 shadow-2xl" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onGenerateCode(menu.workspaceName, menu.collectionName, menu.requestName); onClose(); }}>
        <Code2 className="h-3.5 w-3.5" /> Generate Code
      </button>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onCopyCurl(menu.workspaceName, menu.collectionName, menu.requestName); onClose(); }}>
        <Copy className="h-3.5 w-3.5" /> Copy as cURL
      </button>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onTogglePin(menu.workspaceName, menu.collectionName, menu.requestName); onClose(); }}>
        <Pin className="h-3.5 w-3.5" /> {menu.pinned ? "Unpin" : "Pin"}
      </button>
      <div className="my-1 border-t border-border/40" />
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onCopy(menu.workspaceName, menu.collectionName, menu.requestName); onClose(); }}>
        <Copy className="h-3.5 w-3.5" /> Copy Request
      </button>
      <button type="button" disabled={!canPaste} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors", canPaste ? "text-foreground hover:bg-accent/45" : "text-muted-foreground opacity-50 cursor-not-allowed")} onClick={() => { if (canPaste) { onPaste(menu.workspaceName, menu.collectionName); onClose(); } }}>
        <Copy className="h-3.5 w-3.5" /> Paste Request
      </button>
      <div className="my-1 border-t border-border/40" />
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onRename(menu.workspaceName, menu.collectionName, menu.requestName); onClose(); }}>
        <Pencil className="h-3.5 w-3.5" /> Rename
      </button>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onDuplicate(menu.workspaceName, menu.collectionName, menu.requestName); onClose(); }}>
        <Copy className="h-3.5 w-3.5" /> Duplicate
      </button>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onReveal(menu.workspaceName, menu.collectionName, menu.requestName); onClose(); }}>
        <FolderKanban className="h-3.5 w-3.5" /> Show in Files
      </button>
      <div className="my-1 border-t border-border/40" />
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-red-500 hover:bg-accent/45" onClick={() => { onDelete(menu.workspaceName, menu.collectionName, menu.requestName); onClose(); }}>
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    </div>,
    document.body
  );
}

function CollectionContextMenu({ menu, onCreateRequest, onRename, onDuplicate, onPaste, onReveal, onDelete, onClose, canPaste }) {
  useEffect(() => {
    if (!menu) return;
    function handlePointer() { onClose(); }
    function handleEscape(event) { if (event.key === "Escape") onClose(); }
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleEscape);
    return () => { window.removeEventListener("mousedown", handlePointer); window.removeEventListener("keydown", handleEscape); };
  }, [menu, onClose]);

  if (!menu) return null;

  return createPortal(
    <div className="fixed z-[210] min-w-[180px] border border-border/60 bg-popover p-1 shadow-2xl" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onCreateRequest(menu.workspaceName, menu.collectionName); onClose(); }}>
        <Plus className="h-3.5 w-3.5" /> New Request
      </button>
      <div className="my-1 border-t border-border/40" />
      <button type="button" disabled={!canPaste} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors", canPaste ? "text-foreground hover:bg-accent/45" : "text-muted-foreground opacity-50 cursor-not-allowed")} onClick={() => { if (canPaste) { onPaste(menu.workspaceName, menu.collectionName); onClose(); } }}>
        <Copy className="h-3.5 w-3.5" /> Paste Request
      </button>
      <div className="my-1 border-t border-border/40" />
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onRename(menu.workspaceName, menu.collectionName); onClose(); }}>
        <Pencil className="h-3.5 w-3.5" /> Rename
      </button>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onDuplicate(menu.workspaceName, menu.collectionName); onClose(); }}>
        <Copy className="h-3.5 w-3.5" /> Duplicate
      </button>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent/45" onClick={() => { onReveal(menu.workspaceName, menu.collectionName); onClose(); }}>
        <FolderKanban className="h-3.5 w-3.5" /> Show in Files
      </button>
      <div className="my-1 border-t border-border/40" />
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-red-500 hover:bg-accent/45" onClick={() => { onDelete(menu.workspaceName, menu.collectionName); onClose(); }}>
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    </div>,
    document.body
  );
}

function RequestsView({
  workspaces,
  activeWorkspaceName,
  activeCollectionName,
  activeRequestName,
  onSelectWorkspace,
  onSelectCollection,
  onSelectRequest,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onDuplicateCollection,
  onCreateRequest,
  onRenameRequest,
  onDeleteRequest,
  onDuplicateRequest,
  onPasteRequest,
  onTogglePinRequest
}) {
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [codegenTarget, setCodegenTarget] = useState(null);
  const [codegenLanguage, setCodegenLanguage] = useState("shell");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [expandedWorkspaceNames, setExpandedWorkspaceNames] = useState(() => workspaces.map((w) => w.name));
  const [expandedCollectionNames, setExpandedCollectionNames] = useState([]);
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [creatingRequestInCollection, setCreatingRequestInCollection] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isWorkspaceSwitcherOpen, setIsWorkspaceSwitcherOpen] = useState(false);
  const [duplicationTarget, setDuplicationTarget] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [collectionContextMenu, setCollectionContextMenu] = useState(null);

  const activeWorkspace = useMemo(() => workspaces.find(w => w.name === activeWorkspaceName), [workspaces, activeWorkspaceName]);
  const effectiveWorkspaceName = activeWorkspace?.name ?? "";

  const codegenRequest = useMemo(() => {
    if (!codegenTarget) return null;
    return getRequestRecord(workspaces, codegenTarget.workspaceName, codegenTarget.collectionName, codegenTarget.requestName);
  }, [workspaces, codegenTarget]);

  function handleGenerateCode(workspaceName, collectionName, requestName) {
    setCodegenTarget({ workspaceName, collectionName, requestName });
  }

  async function handleCopyCurl(workspaceName, collectionName, requestName) {
    const request = getRequestRecord(workspaces, workspaceName, collectionName, requestName);
    if (!request) return;
    try {
      const curl = buildCurlCommand(request);
      await navigator.clipboard.writeText(curl);
      setFeedbackMessage("cURL command copied to clipboard.");
      setTimeout(() => setFeedbackMessage(""), 2000);
    } catch (error) {
      console.error("Failed to copy cURL:", error);
    }
  }

  function startRenameRequest(workspaceName, collectionName, requestName) {
    onSelectRequest(workspaceName, collectionName, requestName);
    setEditingItemId(`req:${collectionName}:${requestName}`);
  }

  function openRequestContextMenu(event, workspaceName, collectionName, request) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      workspaceName,
      collectionName,
      requestName: request.name,
      pinned: request.pinned
    });
  }

  function handleTogglePin(workspaceName, collectionName, requestName) {
    onTogglePinRequest(workspaceName, collectionName, requestName);
  }

  function handleDuplicateCollection(workspaceName, collectionName) {
    setDuplicationTarget({ type: 'col', workspaceName, collectionName });
  }

  function handleDuplicateRequest(workspaceName, collectionName, requestName) {
    setDuplicationTarget({ type: 'req', workspaceName, collectionName, requestName });
  }

  function handleCopyRequest(workspaceName, collectionName, requestName) {
    const request = getRequestRecord(workspaces, workspaceName, collectionName, requestName);
    if (request) {
      setClipboard({ type: 'req', request, workspaceName, collectionName });
      setFeedbackMessage(`Copied ${request.name} to clipboard.`);
      setTimeout(() => setFeedbackMessage(""), 2000);
    }
  }

  function handlePasteRequest(workspaceName, collectionName) {
    if (clipboard?.type === 'req') {

      if (clipboard.workspaceName === workspaceName && clipboard.collectionName === collectionName) {
        setFeedbackMessage("Cannot paste in the same collection.");
        setTimeout(() => setFeedbackMessage(""), 2000);
        return;
      }
      onPasteRequest(workspaceName, collectionName, clipboard.request);
      setFeedbackMessage(`Pasted ${clipboard.request.name} into ${collectionName}.`);
      setTimeout(() => setFeedbackMessage(""), 2000);
    }
  }

  async function handleReveal(workspaceName, collectionName, requestName) {
    try {
      await invoke("reveal_item", {
        workspaceName,
        collectionName: collectionName || null,
        requestName: requestName || null
      });
      setFeedbackMessage("Opening in File Explorer...");
      setTimeout(() => setFeedbackMessage(""), 2000);
    } catch (e) {
      console.error("Failed to reveal:", e);
    }
  }

  function openCollectionContextMenu(event, workspaceName, collectionName) {
    event.preventDefault();
    setCollectionContextMenu({
      x: event.clientX,
      y: event.clientY,
      workspaceName,
      collectionName
    });
  }

  const filteredCollections = useMemo(() => {
    if (!activeWorkspace) return [];
    if (!searchQuery.trim()) return activeWorkspace.collections;

    const query = searchQuery.toLowerCase();
    return activeWorkspace.collections.map(col => {
      const matchesCol = col.name.toLowerCase().includes(query);
      const matchedRequests = col.requests.filter(req => req.name.toLowerCase().includes(query));

      if (matchesCol) {
        return col;
      }
      if (matchedRequests.length > 0) {
        return { ...col, requests: matchedRequests };
      }
      return null;
    }).filter(Boolean);
  }, [activeWorkspace, searchQuery]);

  useEffect(() => {
    if (activeWorkspaceName) {
      setExpandedWorkspaceNames((c) => Array.from(new Set([...c, activeWorkspaceName])));
    }
  }, [activeWorkspaceName]);

  useEffect(() => {
    if (activeCollectionName) {
      setExpandedCollectionNames((c) => Array.from(new Set([...c, activeCollectionName])));
    }
  }, [activeCollectionName]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">

      <div className="relative mb-4">
        <button
          onClick={() => setIsWorkspaceSwitcherOpen(!isWorkspaceSwitcherOpen)}
          className="flex w-full items-center justify-between gap-2 px-1 py-1.5 text-left transition-colors hover:bg-accent/35 rounded"
        >
          <div className="flex items-center gap-2 min-w-0">
            <SquareKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-[14px] font-semibold text-foreground">
              {activeWorkspace?.name ?? "No workspace"}
            </span>
          </div>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isWorkspaceSwitcherOpen && "rotate-180")} />
        </button>

        {isWorkspaceSwitcherOpen && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 border border-border/60 bg-popover p-1 shadow-xl rounded-md">
            {workspaces.map((w) => (
              <button
                key={w.name}
                onClick={() => {
                  onSelectWorkspace(w.name);
                  setIsWorkspaceSwitcherOpen(false);
                }}
                className={cn(
                  "flex w-full items-center px-3 py-2 text-left text-[12px] transition-colors rounded hover:bg-accent/45",
                  w.name === activeWorkspaceName ? "bg-accent text-foreground" : "text-foreground/80"
                )}
              >
                {w.name}
              </button>
            ))}
            <div className="my-1 border-t border-border/40" />
            <button
              onClick={() => {
                setEditingWorkspaceName(null);
                setShowWorkspaceForm(true);
                setIsWorkspaceSwitcherOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-muted-foreground hover:bg-accent/45 rounded"
            >
              <Plus className="h-3.5 w-3.5" /> Create Workspace
            </button>
          </div>
        )}
      </div>

      {showWorkspaceForm && (
        <WorkspaceModal
          title={editingWorkspaceName ? "Rename Workspace" : "New Workspace"}
          submitLabel={editingWorkspaceName ? "Save" : "Create"}
          initialValues={editingWorkspaceName ? workspaces.find(w => w.name === editingWorkspaceName) : null}
          existingNames={workspaces.filter(w => w.name !== editingWorkspaceName).map(w => w.name)}
          onSubmit={(v) => {
            if (editingWorkspaceName) {
              onRenameWorkspace(editingWorkspaceName, v);
            } else {
              onCreateWorkspace(v);
            }
            setShowWorkspaceForm(false);
            setEditingWorkspaceName(null);
          }}
          onCancel={() => {
            setShowWorkspaceForm(false);
            setEditingWorkspaceName(null);
          }}
        />
      )}


      {activeWorkspace && (
        <>
          <div className="flex items-center justify-between px-1 mb-2">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-[12px] font-semibold text-foreground">Collections</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsSearchVisible(!isSearchVisible)}
                className={cn("p-1 text-muted-foreground hover:bg-accent hover:text-foreground rounded transition-colors", isSearchVisible && "bg-accent text-foreground")}
                title="Search"
              >
                <Search className="h-4 w-4" />
              </button>
              <button
                onClick={() => setIsCreatingCollection(true)}
                className="p-1 text-muted-foreground hover:bg-accent hover:text-foreground rounded transition-colors"
                title="Create collection"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button className="p-1 text-muted-foreground hover:bg-accent hover:text-foreground rounded transition-colors" title="Options">
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>

          {isSearchVisible && (
            <div className="px-1 mb-3">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  autoFocus
                  className="h-8 pl-8 text-[12px] bg-background/50 border-border/40 focus:border-border/60"
                  placeholder="Search collections..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          )}
        </>
      )}


      <div className="flex-1 thin-scrollbar overflow-auto pr-1">
        {!activeWorkspace ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 space-y-4 opacity-80">
            <div className="p-3 bg-accent/20 rounded-full">
              <SquareKanban className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-[13px] font-medium text-foreground">No workspace selected</p>
              <p className="text-[11px] text-muted-foreground">Select or create a workspace to start managing your collections.</p>
            </div>
            <Button
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => {
                setEditingWorkspaceName(null);
                setShowWorkspaceForm(true);
              }}
            >
              <Plus className="mr-2 h-3.5 w-3.5" /> Create Workspace
            </Button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {isCreatingCollection && (
              <div className="mb-2">
                <CreationField
                  initialValue="New Collection"
                  existingNames={activeWorkspace?.collections.map(c => c.name) || []}
                  onSubmit={(name) => {
                    onCreateCollection(effectiveWorkspaceName, name);
                    setIsCreatingCollection(false);
                  }}
                  onCancel={() => setIsCreatingCollection(false)}
                  placeholder="Collection name"
                />
              </div>
            )}
            {filteredCollections.map((col) => {
              const isColExpanded = expandedCollectionNames.includes(col.name) || searchQuery.trim() !== "";
              const isColEditing = editingItemId === `col:${col.name}`;
              const isActive = col.name === activeCollectionName;

              return (
                <div
                  key={`col-container-${col.name}`}
                  className="space-y-0.5 rounded transition-colors"
                >
                  {isColEditing ? (
                    <RenameField value={col.name} onSubmit={(n) => { onRenameCollection(effectiveWorkspaceName, col.name, n); setEditingItemId(null); }} onCancel={() => setEditingItemId(null)} />
                  ) : (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCollection(effectiveWorkspaceName, col.name);
                        setExpandedCollectionNames(c => c.includes(col.name) ? c.filter(n => n !== col.name) : [...c, col.name]);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingItemId(`col:${col.name}`);
                      }}
                      onContextMenu={(e) => openCollectionContextMenu(e, effectiveWorkspaceName, col.name)}
                      className={cn(
                        "group flex items-center gap-1 px-1 py-1 rounded transition-colors cursor-pointer select-none",
                        isActive ? "bg-accent/40 text-foreground" : "text-foreground/80 hover:bg-accent/20"
                      )}
                    >
                      <div
                        className="text-muted-foreground hover:text-foreground p-0.5"
                      >
                        {isColExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </div>
                      <div className="truncate text-[12.5px] font-medium flex-1 text-left">
                        {col.name}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => {
                          setExpandedCollectionNames(c => Array.from(new Set([...c, col.name])));
                          setCreatingRequestInCollection(col.name);
                        }} className="p-1 text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={(e) => {
                          e.stopPropagation();
                          setEditingWorkspaceName(null);
                          setEditingItemId(`col:${col.name}`);
                        }} className="p-1 text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => onDeleteCollection(effectiveWorkspaceName, col.name)} className="p-1 text-muted-foreground hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  )}
                  {isColExpanded && (
                    <div className="space-y-0.5 ml-3 pl-2 border-l border-border/30">
                      {col.requests.map((req, reqIdx) => {
                        const isReqEditing = editingItemId === `req:${col.name}:${req.name}`;
                        const isReqActive = req.name === activeRequestName && col.name === activeCollectionName;
                        return (
                          <div key={`req-${col.name}-${req.name}-${reqIdx}`}>
                            {isReqEditing ? (
                              <RenameField
                                value={req.name}
                                onSubmit={(n) => {
                                  onRenameRequest(effectiveWorkspaceName, col.name, req.name, n);
                                  setEditingItemId(null);
                                }}
                                onCancel={() => setEditingItemId(null)}
                              />
                            ) : (
                              <div
                                onClick={() => onSelectRequest(effectiveWorkspaceName, col.name, req.name)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  setEditingItemId(`req:${col.name}:${req.name}`);
                                }}
                                className={cn(
                                  "group flex items-center gap-2 px-2 py-1 text-[12px] rounded transition-colors cursor-pointer select-none",
                                  isReqActive ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent/35 hover:text-foreground"
                                )}
                                onContextMenu={(e) => openRequestContextMenu(e, effectiveWorkspaceName, col.name, req)}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                  <span className={cn("text-[10px] font-bold uppercase w-8 shrink-0", getMethodTone(req.method).split(" ")[0])}>{req.method}</span>
                                  {req.pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
                                  <span className="truncate">{req.name}</span>
                                </div>
                                <div className="flex items-center opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                                  <button type="button" className="p-1 text-muted-foreground hover:text-red-500" onClick={() => onDeleteRequest(effectiveWorkspaceName, col.name, req.name)}><Trash2 className="h-3.5 w-3.5" /></button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {creatingRequestInCollection === col.name && (
                        <CreationField
                          initialValue="New Request"
                          existingNames={col.requests.map(r => r.name)}
                          onSubmit={(name) => {
                            onCreateRequest(effectiveWorkspaceName, col.name, name);
                            setCreatingRequestInCollection(null);
                          }}
                          onCancel={() => setCreatingRequestInCollection(null)}
                          placeholder="Request name"
                        />
                      )}
                      {!col.requests.length && !searchQuery && !creatingRequestInCollection && (
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedCollectionNames(c => Array.from(new Set([...c, col.name])));
                            setCreatingRequestInCollection(col.name);
                          }}
                          className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Plus className="h-3 w-3" /> New Request
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!filteredCollections.length && searchQuery && (
              <div className="text-center py-8 text-muted-foreground text-[12px]">
                No results found for "{searchQuery}"
              </div>
            )}
          </div>
        )}
      </div>

      <RequestContextMenu
        menu={contextMenu}
        onGenerateCode={handleGenerateCode}
        onCopyCurl={handleCopyCurl}
        onRename={startRenameRequest}
        onDuplicate={handleDuplicateRequest}
        onCopy={handleCopyRequest}
        onPaste={handlePasteRequest}
        onReveal={handleReveal}
        onTogglePin={handleTogglePin}
        onDelete={onDeleteRequest}
        onClose={() => setContextMenu(null)}
        canPaste={Boolean(clipboard) && (clipboard.workspaceName !== contextMenu?.workspaceName || clipboard.collectionName !== contextMenu?.collectionName)}
      />
      <CollectionContextMenu
        menu={collectionContextMenu}
        onCreateRequest={onCreateRequest}
        onRename={(workspaceName, collectionName) => setEditingItemId(`col:${collectionName}`)}
        onDuplicate={handleDuplicateCollection}
        onPaste={handlePasteRequest}
        onReveal={handleReveal}
        onDelete={onDeleteCollection}
        onClose={() => setCollectionContextMenu(null)}
        canPaste={Boolean(clipboard) && (clipboard.workspaceName !== collectionContextMenu?.workspaceName || clipboard.collectionName !== collectionContextMenu?.collectionName)}
      />
      {duplicationTarget && (
        <WorkspaceModal
          title={duplicationTarget.type === 'col' ? "Duplicate Collection" : "Duplicate Request"}
          submitLabel="Duplicate"
          initialValues={{
            name: getUniqueName((duplicationTarget.type === 'col' ? duplicationTarget.collectionName : duplicationTarget.requestName) + " Copy",
              duplicationTarget.type === 'col'
                ? workspaces.find(w => w.name === duplicationTarget.workspaceName)?.collections.map(c => c.name) || []
                : workspaces.find(w => w.name === duplicationTarget.workspaceName)?.collections.find(c => c.name === duplicationTarget.collectionName)?.requests.map(r => r.name) || []
            )
          }}
          existingNames={
            duplicationTarget.type === 'col'
              ? workspaces.find(w => w.name === duplicationTarget.workspaceName)?.collections.map(c => c.name) || []
              : workspaces.find(w => w.name === duplicationTarget.workspaceName)?.collections.find(c => c.name === duplicationTarget.collectionName)?.requests.map(r => r.name) || []
          }
          onSubmit={(v) => {
            if (duplicationTarget.type === 'col') {
              onDuplicateCollection(duplicationTarget.workspaceName, duplicationTarget.collectionName, v.name);
            } else {
              onDuplicateRequest(duplicationTarget.workspaceName, duplicationTarget.collectionName, duplicationTarget.requestName, v.name);
            }
            setDuplicationTarget(null);
          }}
          onCancel={() => setDuplicationTarget(null)}
        />
      )}
      {feedbackMessage && <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 border border-border/50 bg-card/95 px-3 py-2 text-[12px] text-foreground shadow-xl">{feedbackMessage}</div>}
      <GenerateCodeModal request={codegenRequest} language={codegenLanguage} onLanguageChange={setCodegenLanguage} onClose={() => setCodegenTarget(null)} />
    </div>
  );
}

export function Sidebar({
  iconSrc, sidebarTab, collapsed, workspaces, activeWorkspaceName, activeCollectionName, activeRequestName,
  onSidebarTabChange, onSelectWorkspace, onSelectCollection, onSelectRequest,
  onCreateWorkspace, onRenameWorkspace, onDeleteWorkspace,
  onCreateCollection, onRenameCollection, onDeleteCollection, onDuplicateCollection,
  onCreateRequest, onRenameRequest, onDeleteRequest, onDuplicateRequest, onPasteRequest, onTogglePinRequest
}) {
  return (
    <aside className={cn("grid h-full min-h-0 overflow-hidden border-r border-border/30 bg-border/20", collapsed ? "grid-cols-[52px]" : "grid-cols-[52px_minmax(0,1fr)] gap-px")}>
      <Card className="flex min-h-0 flex-col items-center gap-2 bg-[hsl(var(--sidebar))]/96 p-2.5 shadow-none">
        <div className="flex h-8 w-8 items-center justify-center overflow-hidden bg-card/85"><img src={iconSrc} alt="Kivo" className="h-6 w-6 object-contain" /></div>
        <Button variant={sidebarTab === "requests" ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => onSidebarTabChange("requests")}><SquareKanban className="h-4 w-4" /></Button>
        <div className="mt-auto" />
      </Card>
      {!collapsed && (
        <Card className="flex min-h-0 flex-col gap-3 overflow-hidden bg-[hsl(var(--sidebar))]/98 p-2 text-[12px] text-[hsl(var(--sidebar-foreground))] shadow-none">
          <RequestsView
            workspaces={workspaces}
            activeWorkspaceName={activeWorkspaceName}
            activeCollectionName={activeCollectionName}
            activeRequestName={activeRequestName}
            onSelectWorkspace={onSelectWorkspace}
            onSelectCollection={onSelectCollection}
            onSelectRequest={onSelectRequest}
            onCreateWorkspace={onCreateWorkspace}
            onRenameWorkspace={onRenameWorkspace}
            onDeleteWorkspace={onDeleteWorkspace}
            onCreateCollection={onCreateCollection}
            onRenameCollection={onRenameCollection}
            onDeleteCollection={onDeleteCollection}
            onDuplicateCollection={onDuplicateCollection}
            onCreateRequest={onCreateRequest}
            onRenameRequest={onRenameRequest}
            onDeleteRequest={onDeleteRequest}
            onDuplicateRequest={onDuplicateRequest}
            onPasteRequest={onPasteRequest}
            onTogglePinRequest={onTogglePinRequest}
          />
        </Card>
      )}
    </aside>
  );
}
