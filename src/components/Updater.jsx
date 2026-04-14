import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { Info, RefreshCw, X, AlertCircle, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button.jsx";

export function Updater() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [status, setStatus] = useState("idle");
  const [showToast, setShowToast] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [currentVersion, setCurrentVersion] = useState("");

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(console.error);
    checkForUpdates(false);

    const handleManualCheck = () => checkForUpdates(true);
    window.addEventListener("manual-update-check", handleManualCheck);

    return () => window.removeEventListener("manual-update-check", handleManualCheck);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("updater-status-change", { detail: { status, updateInfo } }));

    const handleStatusRequest = () => {
      window.dispatchEvent(new CustomEvent("updater-status-change", { detail: { status, updateInfo } }));
    };
    const handleManualInstall = () => {
      if (status === "available") handleInstallAndRestart();
    };

    window.addEventListener("updater-status-request", handleStatusRequest);
    window.addEventListener("manual-update-install", handleManualInstall);
    return () => {
      window.removeEventListener("updater-status-request", handleStatusRequest);
      window.removeEventListener("manual-update-install", handleManualInstall);
    };
  }, [status, updateInfo]);

  async function checkForUpdates(isManual) {
    if (status === "downloading" || status === "available") return;

    if (isManual) {
      setStatus("checking");
      setShowToast(true);
    }

    try {
      const update = await check();
      if (update) {
        setUpdateInfo(update);
        setStatus("available");
        setShowToast(true);
      } else {
        if (isManual) {
          setStatus("up-to-date");
          setShowToast(true);
          setTimeout(() => {
            setStatus("idle");
            setShowToast(false);
          }, 4000);
        }
      }
    } catch (err) {
      console.error("Update failed:", err);
      if (isManual) {
        setStatus("error");
        setShowToast(true);
        setErrorMsg(err?.message || "Failed to check for updates");
        setTimeout(() => {
          setStatus("idle");
          setShowToast(false);
        }, 5000);
      }
    }
  }

  async function handleInstallAndRestart() {
    setStatus("downloading");
    setShowToast(true);
    try {
      await updateInfo.downloadAndInstall();
      await relaunch();
    } catch (err) {
      console.error("Install failed:", err);
      setStatus("error");
      setShowToast(true);
      setErrorMsg(err?.message || "Failed to install update");
      setTimeout(() => {
        setStatus("idle");
        setShowToast(false);
      }, 5000);
    }
  }

  if (!showToast || status === "idle") return null;

  if (status === "checking") {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-sm border border-border/45 bg-card/95 px-4 py-3 shadow-xl backdrop-blur-md animate-in slide-in-from-bottom-5">
        <RefreshCw className="h-4 w-4 text-primary animate-spin" />
        <span className="text-[13px] font-medium">Checking for updates...</span>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 panel-surface flex flex-col gap-3.5 rounded-sm p-3.5 shadow-2xl min-w-[340px] max-w-[380px] animate-in slide-in-from-right-5 fade-in duration-500 border border-border/40">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-2.5 mt-0.5">
          {status === "downloading" ? (
            <RefreshCw className="h-4 w-4 text-teal-500 animate-spin shrink-0 mt-0.5" />
          ) : status === "error" ? (
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          ) : status === "up-to-date" ? (
            <CheckCircle2 className="h-4 w-4 text-teal-500 shrink-0 mt-0.5" />
          ) : (
            <Info className="h-4 w-4 text-teal-500 shrink-0 mt-0.5" />
          )}

          <span className="text-[13px] leading-relaxed text-foreground/90 font-medium tracking-wide">
            {status === "downloading" ? "Downloading and installing update..." :
              status === "error" ? errorMsg :
                status === "up-to-date" ? `Kivo is up to date (v${currentVersion}).` :
                  "Restart Kivo to apply the latest update."}
          </span>
        </div>

        {status !== "downloading" && (
          <button onClick={() => setShowToast(false)} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {status === "available" && (
        <div className="flex justify-end gap-2 mt-1">
          <Button
            size="sm"
            className="h-7 px-3 text-[12px] bg-teal-500/20 hover:bg-teal-500/30 text-teal-500 font-medium rounded shadow-none border-0"
            onClick={handleInstallAndRestart}
          >
            Update Now
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-3 text-[12px] font-medium rounded bg-accent/60 hover:bg-accent border-0 shadow-none text-foreground/90"
            onClick={() => { }}
          >
            Release Notes
          </Button>
        </div>
      )}
    </div>
  );
}
