import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Sidebar } from "@/components/workspace/Sidebar.jsx";
import { RequestTabs } from "@/components/workspace/RequestTabs.jsx";
import { SidebarResizer } from "@/components/workspace/SidebarResizer.jsx";
import { SetupWizard } from "@/components/workspace/SetupWizard.jsx";
import { WorkspaceView } from "@/components/workspace/WorkspaceView.jsx";
import { WorkspaceModal } from "@/components/workspace/WorkspaceModal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { useTheme } from "@/hooks/use-theme.js";
import { useWorkspaceStore } from "@/hooks/use-workspace-store.js";
import { SIDEBAR_COLLAPSED_WIDTH } from "@/lib/workspace-utils.js";
import { SquareKanban, Layers, Star, Sun, Moon, Settings, Github } from "lucide-react";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const {
    store,
    isSending,
    isSetupComplete,
    starCount,
    resizeRef,
    activeWorkspace,
    activeCollection,
    activeRequest,
    requestTabs,
    response,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_REOPEN_WIDTH,
    handleSidebarTabChange,
    handleRequestFieldChange,
    createWorkspaceRecord,
    renameWorkspaceRecord,
    deleteWorkspaceRecord,
    createCollectionRecord,
    renameCollectionRecord,
    deleteCollectionRecord,
    createRequestRecord,
    duplicateRequestRecord,
    pasteRequestRecord,
    renameRequestRecord,
    deleteRequestRecord,
    selectWorkspace,
    selectCollection,
    selectRequest,
    togglePinRequestRecord,
    closeRequestTab,
    handleSend,
    updateActiveRequest,
    checkSetup,
    duplicateCollectionRecord,
  } = useWorkspaceStore();

  if (!isSetupComplete) {
    return <SetupWizard onComplete={checkSetup} />;
  }

  const workspaceTitle = activeWorkspace?.name ?? "No workspace selected";
  const workspaceDescription = activeWorkspace?.description?.trim();
  const showNoWorkspaceState = !activeWorkspace;
  const showNoCollectionsState = activeWorkspace && activeWorkspace.collections.length === 0;
  const showNoRequestsInCollection = activeCollection && activeCollection.requests.length === 0;
  const showNoRequestSelected = activeCollection && activeCollection.requests.length > 0 && !activeRequest;
  const showEmptyCanvas = !activeRequest;
  const sidebarWidth = store.sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : store.sidebarWidth;

  return (
    <div className="h-full overflow-hidden">
      {showWorkspaceModal && (
        <WorkspaceModal
          title="New Workspace"
          submitLabel="Create"
          existingNames={store.workspaces.map(w => w.name)}
          onSubmit={(v) => {
            createWorkspaceRecord(v);
            setShowWorkspaceModal(false);
          }}
          onCancel={() => setShowWorkspaceModal(false)}
        />
      )}
      <div className="flex h-full min-h-0 overflow-hidden border border-border/30 bg-card/35">
        <div style={{ width: `${sidebarWidth}px` }} className="min-h-0 shrink-0 overflow-hidden">
          <Sidebar
            iconSrc="/icon.ico"
            sidebarTab={store.sidebarTab}
            collapsed={store.sidebarCollapsed}
            workspaces={store.workspaces}
            activeWorkspaceName={store.activeWorkspaceName}
            activeCollectionName={store.activeCollectionName}
            activeRequestName={store.activeRequestName}
            onSidebarTabChange={handleSidebarTabChange}
            onSelectWorkspace={selectWorkspace}
            onSelectCollection={selectCollection}
            onSelectRequest={selectRequest}
            onCreateWorkspace={createWorkspaceRecord}
            onRenameWorkspace={renameWorkspaceRecord}
            onDeleteWorkspace={deleteWorkspaceRecord}
            onCreateCollection={createCollectionRecord}
            onRenameCollection={renameCollectionRecord}
            onDeleteCollection={deleteCollectionRecord}
            onDuplicateCollection={duplicateCollectionRecord}
            onCreateRequest={createRequestRecord}
            onRenameRequest={renameRequestRecord}
            onDeleteRequest={deleteRequestRecord}
            onDuplicateRequest={duplicateRequestRecord}
            onPasteRequest={pasteRequestRecord}
            onTogglePinRequest={togglePinRequestRecord}
          />
        </div>

        <SidebarResizer
          onMouseDown={(event) => {
            resizeRef.current = { active: true, startX: event.clientX, startWidth: sidebarWidth };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {showNoWorkspaceState ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <SquareKanban className="h-8 w-8 text-primary" />
              </div>
              <div className="max-w-md space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">No Workspace Yet</div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">Create a workspace to get started</h2>
                <p className="text-muted-foreground">Start with your own workspace and build it the way you want.</p>
              </div>
              <Button
                className="mt-8 h-11 px-8"
                onClick={() => setShowWorkspaceModal(true)}
              >
                Create workspace
              </Button>
            </div>
          ) : showNoCollectionsState ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Layers className="h-8 w-8 text-primary" />
              </div>
              <div className="max-w-md space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">No Collections Yet</div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">Create your first collection</h2>
                <p className="text-muted-foreground">Organize your requests by creating a collection first.</p>
              </div>
              <Button
                className="mt-8 h-11 px-8"
                onClick={() => createCollectionRecord(activeWorkspace.name, "New Collection")}
              >
                Create collection
              </Button>
            </div>
          ) : showNoRequestSelected ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SquareKanban className="h-8 w-8" />
              </div>
              <div className="max-w-md space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">No Request Selected</div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">Select a request from the sidebar</h2>
                <p className="text-muted-foreground">Click on a request in "{activeCollection.name}" to view and edit its details.</p>
              </div>
            </div>
          ) : showNoRequestsInCollection ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Layers className="h-8 w-8" />
              </div>
              <div className="max-w-md space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Empty Collection</div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">No requests in this collection</h2>
                <p className="text-muted-foreground">This collection is currently empty. Create your first request here.</p>
              </div>
              <Button className="mt-8 h-11 px-8" onClick={() => createRequestRecord(activeWorkspace.name, activeCollection.name)}>New request</Button>
            </div>
          ) : showEmptyCanvas ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SquareKanban className="h-8 w-8" />
              </div>
              <div className="max-w-md space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">No Requests Yet</div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">Create your first request in this workspace</h2>
                <p className="text-muted-foreground">Kivo is ready, but this workspace is empty right now. Add a request from the sidebar or here.</p>
              </div>
              <Button className="mt-8 h-11 px-8" onClick={() => createRequestRecord(activeWorkspace.name)}>New request</Button>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-border/25 bg-background/40 px-5 py-3.5 backdrop-blur-md">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <div className="text-[18px] font-semibold tracking-tight text-foreground">{activeCollection?.name ?? "No Collection"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-accent/30 px-3 py-1.5 text-muted-foreground transition-all hover:bg-accent/50 hover:text-foreground"
                    onClick={() => openUrl("https://github.com/dexter-xD/Kivo")}
                  >
                    <Github className="h-[16px] w-[16px]" />
                    <span className="text-[11px] font-semibold">{starCount ?? "..."}</span>
                    <Star className="h-[14px] w-[14px] fill-current text-yellow-500/80" />
                  </div>
                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground hover:bg-accent/40 hover:text-foreground" onClick={toggleTheme}>{theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}</Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground hover:bg-accent/40 hover:text-foreground"><Settings className="h-[18px] w-[18px]" /></Button>
                </div>
              </div>

              <div className="flex min-h-0 shrink-0 border-b border-border/25 bg-background/25">
                <RequestTabs
                  activeWorkspaceName={activeWorkspace?.name}
                  activeCollectionName={activeCollection?.name}
                  activeRequestName={activeRequest?.name}
                  requestTabs={requestTabs}
                  selectRequest={selectRequest}
                  closeRequestTab={closeRequestTab}
                  createRequestRecord={createRequestRecord}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-hidden bg-background/20">
                <WorkspaceView request={activeRequest} isSending={isSending} onSend={handleSend} onFieldChange={handleRequestFieldChange} onUpdateActiveRequest={updateActiveRequest} response={response} />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
