import { useState, useEffect } from "react";
import { FolderOpen, Settings, CheckCircle2, ArrowRight } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Input } from "@/components/ui/input.jsx";

export function SetupWizard({ onComplete }) {
  const [path, setPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function initDefaultPath() {
      try {
        const defaultPath = await invoke("get_default_storage_path");
        setPath(defaultPath);
      } catch (error) {
        console.error("Failed to get default path:", error);
      }
    }
    initDefaultPath();
  }, []);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: path,
      });
      if (selected) {
        setPath(selected);
      }
    } catch (error) {
      console.error("Failed to pick directory:", error);
    }
  };

  const handleFinish = async () => {
    if (!path) return;
    setIsSubmitting(true);
    try {
      await invoke("set_storage_path", { path });
      onComplete();
    } catch (error) {
      console.error("Failed to set storage path:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-lg border-border/40 bg-card/95 p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Settings className="h-8 w-8 animate-spin-slow" />
          </div>
          
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
            Welcome to Kivo
          </h1>
          <p className="mb-8 text-[14px] text-muted-foreground lg:text-[15px]">
            Let's set up your workspace. Choose where you want to store your API collections and data.
          </p>

          <div className="w-full space-y-4 text-left">
            <div className="space-y-2">
              <label className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Storage Location
              </label>
              <div className="flex gap-2">
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="C:/Users/name/Documents/Kivo"
                  className="h-11 border-border/40 bg-card/50 text-[14px]"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0 border-border/40 bg-card/50"
                  onClick={handleBrowse}
                >
                  <FolderOpen className="h-5 w-5" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Your workspaces, collections, and requests will be stored here.
              </p>
            </div>
          </div>

          <div className="mt-10 w-full space-y-3">
            <Button
              className="h-12 w-full gap-2 text-[15px] font-semibold shadow-lg shadow-primary/20"
              onClick={handleFinish}
              disabled={isSubmitting || !path}
            >
              {isSubmitting ? "Setting up..." : "Complete Setup"}
              <CheckCircle2 className="h-5 w-5" />
            </Button>
            
            <div className="flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
              <span>You can change this later in settings</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
