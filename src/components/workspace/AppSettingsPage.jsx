import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { FolderOpen, HardDrive, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Input } from "@/components/ui/input.jsx";
import { switchStoragePath, validateStoragePath } from "@/lib/http-client.js";

function normalizePath(path) {
  return String(path ?? "").trim().replace(/[\\/]+$/, "").toLowerCase();
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
    () => normalizePath(pathInput) === normalizePath(storagePath),
    [pathInput, storagePath]
  );

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
    const trimmed = pathInput.trim();
    if (!trimmed) {
      setPathError("Path is required.");
      setPathValidation(null);
      return null;
    }

    try {
      const result = await validateStoragePath(trimmed);
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

    if (!validation.exists) {
      setPathError("Selected path does not exist.");
      return;
    }
    if (!validation.isDirectory) {
      setPathError("Selected path must be a directory.");
      return;
    }
    if (!validation.writable) {
      setPathError("Selected path is not writable.");
      return;
    }

    setIsSubmitting(true);
    try {
      await switchStoragePath(pathInput.trim(), mode);
      onStoragePathChanged?.(pathInput.trim());
      toast.success("Storage path updated.");
    } catch (error) {
      setPathError(String(error ?? "Failed to switch storage path."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Settings2 className="h-4.5 w-4.5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">App Settings</h2>
          <p className="text-[13px] text-muted-foreground">Manage storage path and software updates.</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border/25 bg-background/45 p-5">
          <div className="mb-4 flex items-center gap-2 text-foreground">
            <HardDrive className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Storage Path</h3>
          </div>

          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={pathInput}
                onChange={(event) => {
                  setPathInput(event.target.value);
                  setPathError("");
                  setPathValidation(null);
                }}
                placeholder="Select storage folder"
                className="h-10"
              />
              <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={handleBrowse}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2 text-[12px]">
              <Button type="button" variant="secondary" size="sm" className="h-8" onClick={handleValidate}>
                Validate Path
              </Button>
              {pathValidation ? (
                <span className="text-muted-foreground">
                  {pathValidation.exists && pathValidation.isDirectory && pathValidation.writable
                    ? "Path looks valid"
                    : "Path is not valid"}
                </span>
              ) : null}
            </div>

            <div className="space-y-2 rounded-md border border-border/30 bg-accent/20 p-3">
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
              <div className="text-[12px] text-amber-500">Selected path matches current storage path.</div>
            ) : null}
            {pathError ? <div className="text-[12px] text-red-500">{pathError}</div> : null}

            <div className="flex items-center justify-between pt-1">
              <div className="text-[11px] text-muted-foreground">
                Current: <span className="font-mono">{storagePath || "-"}</span>
              </div>
              <Button type="button" className="h-9" onClick={handleApplyPath} disabled={isSubmitting || !pathInput.trim()}>
                {isSubmitting ? "Applying..." : "Apply Path"}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="border-border/25 bg-background/45 p-5">
          <div className="mb-4 flex items-center gap-2 text-foreground">
            <RefreshCw className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Software Update</h3>
          </div>

          <div className="space-y-3 text-[12px]">
            <div className="text-muted-foreground">Current version: <span className="text-foreground">v{appVersion}</span></div>
            <div className="text-muted-foreground">Status: <span className="text-foreground">{updaterStatus}</span></div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8"
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
      </div>
    </div>
  );
}
