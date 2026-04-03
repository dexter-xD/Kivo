import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Input } from "@/components/ui/input.jsx";
import { cn } from "@/lib/utils.js";

export function WorkspaceModal({ initialValues, title, submitLabel, onSubmit, onCancel, existingNames = [] }) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");

  const isDuplicate = useMemo(() => existingNames.includes(name.trim()), [name, existingNames]);

  function handleSubmit(event) {
    event.preventDefault();
    if (!name.trim() || isDuplicate) return;
    onSubmit({ name: name.trim(), description: description.trim() });
  }

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-background/80 backdrop-blur-sm p-6" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <Card className="w-full max-w-md border border-border/50 bg-card/95 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button onClick={onCancel} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Name</label>
            <div className="relative">
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter name..."
                className={cn("h-10", isDuplicate && "border-red-500 focus-visible:ring-red-500")}
              />
              {isDuplicate && (
                <p className="absolute -bottom-5 left-0 text-[10px] text-red-500">This name is already taken</p>
              )}
            </div>
          </div>

          <div className="grid gap-2 mt-2">
            <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Description (optional)</label>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this for?"
              className="h-10"
            />
          </div>

          <div className="flex items-center justify-end gap-3 mt-6">
            <Button type="button" variant="ghost" className="h-10 px-6" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" className="h-10 px-8" disabled={!name.trim() || isDuplicate}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </Card>
    </div>,
    document.body
  );
}
