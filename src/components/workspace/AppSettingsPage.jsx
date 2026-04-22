import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BookOpen, ExternalLink, FileText, FolderOpen, Github, HardDrive, Heart, RefreshCw, Settings2, Siren, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Input } from "@/components/ui/input.jsx";
import { switchStoragePath, validateStoragePath } from "@/lib/http-client.js";

function normalizePath(path) {
  return String(path ?? "").trim().replace(/[\\/]+$/, "").toLowerCase();
}

function resolveKivoStoragePath(base) {
  const trimmed = String(base ?? "").trim();
  if (!trimmed) return "";
  const lastSegment = trimmed.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "";
  if (lastSegment.toLowerCase() === "kivo") {
    return trimmed;
  }
  const isWindows = /^[A-Za-z]:[/\\]/.test(trimmed);
  const sep = isWindows ? "\\" : "/";
  const baseWithoutTrailing = trimmed.replace(/[\\/]+$/, "");
  return `${baseWithoutTrailing}${sep}Kivo`;
}

export function AppSettingsPage({ storagePath, onStoragePathChanged }) {
  const [pathInput, setPathInput] = useState(storagePath ?? "");
  const [mode, setMode] = useState("copy");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pathValidation, setPathValidation] = useState(null);
  const [pathError, setPathError] = useState("");
  const [appVersion, setAppVersion] = useState("...");
  const [updaterStatus, setUpdaterStatus] = useState("idle");

  useEffect(() => {
    setPathInput(storagePath ?? "");
  }, [storagePath]);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});

    const handleStatusChange = (event) => {
      setUpdaterStatus(event.detail.status);
    };

    window.addEventListener("updater-status-change", handleStatusChange);
    window.dispatchEvent(new CustomEvent("updater-status-request"));

    return () => window.removeEventListener("updater-status-change", handleStatusChange);
  }, []);

  const isSamePath = useMemo(
    () => normalizePath(resolveKivoStoragePath(pathInput)) === normalizePath(storagePath),
    [pathInput, storagePath]
  );

  const resolvedTargetPath = useMemo(() => resolveKivoStoragePath(pathInput), [pathInput]);

  async function handleOpenExternal(url, label) {
    try {
      await openUrl(url);
    } catch {
      toast.error(`Unable to open ${label}.`);
    }
  }

  async function handleBrowse() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: pathInput || storagePath || undefined,
      });
      if (selected) {
        setPathInput(selected);
        setPathError("");
        setPathValidation(null);
      }
    } catch {
      toast.error("Unable to open folder picker.");
    }
  }

  async function handleValidate() {
    if (!resolvedTargetPath) {
      setPathError("Path is required.");
      setPathValidation(null);
      return null;
    }

    try {
      const result = await validateStoragePath(resolvedTargetPath);
      setPathValidation(result);
      setPathError("");
      return result;
    } catch (error) {
      const message = String(error ?? "Invalid path.");
      setPathError(message);
      setPathValidation(null);
      return null;
    }
  }

  async function handleApplyPath() {
    if (isSamePath) {
      setPathError("Selected path is already the current storage path.");
      return;
    }

    const validation = await handleValidate();
    if (!validation) return;

    if (validation.exists && !validation.isDirectory) {
      setPathError("Selected path must be a directory.");
      return;
    }
    if (!validation.writable) {
      setPathError("Selected path is not writable.");
      return;
    }

    setIsSubmitting(true);
    try {
      await switchStoragePath(resolvedTargetPath, mode);
      onStoragePathChanged?.(resolvedTargetPath);
      toast.success("Storage path updated.");
    } catch (error) {
      setPathError(String(error ?? "Failed to switch storage path."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const validationTone = pathValidation
    ? pathValidation.exists && pathValidation.isDirectory && pathValidation.writable
      ? "text-emerald-400"
      : "text-amber-400"
    : "text-muted-foreground";

  const statusTone =
    updaterStatus === "available"
      ? "bg-emerald-500/12 text-emerald-400 border-emerald-500/30"
      : updaterStatus === "downloading"
        ? "bg-blue-500/12 text-blue-400 border-blue-500/30"
        : "bg-muted/35 text-muted-foreground border-border/30";

  return (
    <div className="thin-scrollbar flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden p-6 lg:p-7">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center border border-primary/25 bg-primary/12 text-primary shadow-sm shadow-primary/10">
          <Settings2 className="h-4.5 w-4.5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">App Settings</h2>
          <p className="text-[13px] text-muted-foreground">Storage, updates, and project resources.</p>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card className="border border-border/35 bg-gradient-to-b from-background/75 to-background/45 p-5 shadow-[0_10px_24px_hsl(var(--background)/0.28)]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-foreground">
              <HardDrive className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-semibold">Storage Path</h3>
            </div>
            <div className="rounded-md border border-border/35 bg-accent/25 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Active data root
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="flex gap-2">
              <Input
                value={pathInput}
                onChange={(event) => {
                  setPathInput(event.target.value);
                  setPathError("");
                  setPathValidation(null);
                }}
                placeholder="Select storage folder"
                className="h-10 border-border/35 bg-background/35 text-[13px]"
              />
              <Button type="button" variant="outline" size="icon" className="h-10 w-10 border-border/45 bg-background/30" onClick={handleBrowse}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Button type="button" variant="secondary" size="sm" className="h-8 border border-border/40 bg-accent/40" onClick={handleValidate}>
                Validate Path
              </Button>
              {pathValidation ? (
                <span className={validationTone}>
                  {pathValidation.exists && pathValidation.isDirectory && pathValidation.writable
                    ? "Path looks valid"
                    : "Path is not valid"}
                </span>
              ) : null}
            </div>

            <div className="rounded-lg border border-border/35 bg-accent/20 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Resolved path</div>
              <div className="mt-1 break-all font-mono text-[11px] text-foreground/90">{resolvedTargetPath || "-"}</div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/35 bg-accent/20 p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">When switching</div>
              <label className="flex items-center gap-2 text-[12px] text-foreground">
                <input
                  type="radio"
                  name="migration-mode"
                  checked={mode === "copy"}
                  onChange={() => setMode("copy")}
                  className="accent-primary"
                />
                Copy all existing data to new path
              </label>
              <label className="flex items-center gap-2 text-[12px] text-foreground">
                <input
                  type="radio"
                  name="migration-mode"
                  checked={mode === "fresh"}
                  onChange={() => setMode("fresh")}
                  className="accent-primary"
                />
                Start fresh at new path
              </label>
            </div>

            {isSamePath ? (
              <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[12px] text-amber-400">Selected path matches current storage path.</div>
            ) : null}
            {pathError ? <div className="rounded-md border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[12px] text-red-400">{pathError}</div> : null}

            <div className="flex items-center justify-between gap-4 border-t border-border/20 pt-3">
              <div className="text-[11px] text-muted-foreground min-w-0">
                Current: <span className="font-mono">{storagePath || "-"}</span>
              </div>
              <Button type="button" className="h-9 px-5" onClick={handleApplyPath} disabled={isSubmitting || !pathInput.trim()}>
                {isSubmitting ? "Applying..." : "Apply Path"}
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="border border-border/35 bg-gradient-to-b from-background/70 to-background/45 p-5 shadow-[0_8px_20px_hsl(var(--background)/0.2)]">
            <div className="mb-4 flex items-center justify-between gap-2 text-foreground">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" />
                <h3 className="text-[14px] font-semibold">Software Update</h3>
              </div>
              <div className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusTone}`}>
                {updaterStatus}
              </div>
            </div>

            <div className="space-y-3 text-[12px]">
              <div className="rounded-lg border border-border/30 bg-accent/15 px-3 py-2.5 text-muted-foreground">
                Current version: <span className="font-semibold text-foreground">v{appVersion}</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 border border-border/40 bg-accent/40"
                  onClick={() => window.dispatchEvent(new CustomEvent("manual-update-check"))}
                  disabled={updaterStatus === "downloading"}
                >
                  Check for Updates
                </Button>
                {updaterStatus === "available" ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    onClick={() => window.dispatchEvent(new CustomEvent("manual-update-install"))}
                  >
                    Restart to Update
                  </Button>
                ) : null}
              </div>
            </div>

          </Card>

          <Card className="border border-border/35 bg-gradient-to-b from-background/70 to-background/45 p-5 shadow-[0_8px_20px_hsl(var(--background)/0.2)]">
            <div className="mb-4 flex items-center gap-2 text-foreground">
              <BookOpen className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-semibold">Resources & Support</h3>
            </div>

            <div className="grid gap-2.5 text-[12px]">
              <button
                type="button"
                onClick={() => handleOpenExternal("https://github.com/dexter-xD/Kivo/blob/main/CHANGELOG.md", "changelog")}
                className="flex items-center justify-between rounded-lg border border-border/35 bg-accent/15 px-3 py-2.5 text-left transition-colors hover:bg-accent/30"
              >
                <span className="flex items-center gap-2 text-foreground"><BookOpen className="h-3.5 w-3.5 text-primary" />View Changelog</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </button>

              <button
                type="button"
                onClick={() => handleOpenExternal("https://github.com/dexter-xD/Kivo/blob/main/LICENSE.md", "license")}
                className="flex items-center justify-between rounded-lg border border-border/35 bg-accent/15 px-3 py-2.5 text-left transition-colors hover:bg-accent/30"
              >
                <span className="flex items-center gap-2 text-foreground"><FileText className="h-3.5 w-3.5 text-primary" />View License</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </button>

              <button
                type="button"
                onClick={() => handleOpenExternal("https://github.com/dexter-xD/Kivo", "GitHub")}
                className="flex items-center justify-between rounded-lg border border-border/35 bg-accent/15 px-3 py-2.5 text-left transition-colors hover:bg-accent/30"
              >
                <span className="flex items-center gap-2 text-foreground"><Star className="h-3.5 w-3.5 text-amber-400" />Give a Star on GitHub</span>
                <Github className="h-3.5 w-3.5 text-muted-foreground" />
              </button>

              <button
                type="button"
                onClick={() => handleOpenExternal("https://github.com/sponsors/dexter-xD", "sponsorship page")}
                className="flex items-center justify-between rounded-lg border border-border/35 bg-accent/15 px-3 py-2.5 text-left transition-colors hover:bg-accent/30"
              >
                <span className="flex items-center gap-2 text-foreground"><Heart className="h-3.5 w-3.5 text-rose-400" />Sponsor this Project</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </button>

              <button
                type="button"
                onClick={() => handleOpenExternal("https://github.com/dexter-xD/Kivo/issues/new", "issue form")}
                className="flex items-center justify-between rounded-lg border border-border/35 bg-accent/15 px-3 py-2.5 text-left transition-colors hover:bg-accent/30"
              >
                <span className="flex items-center gap-2 text-foreground"><Siren className="h-3.5 w-3.5 text-orange-400" />Report Issue</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
