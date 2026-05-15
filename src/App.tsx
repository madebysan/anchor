import { lazy, Suspense, useEffect, useState } from "react";
import ThemeProvider from "@/components/ThemeProvider";
import OnboardingScreen from "@/components/onboarding/OnboardingScreen";
import InstallClaudeScreen from "@/components/onboarding/InstallClaudeScreen";
import ErrorBoundary from "@/components/ErrorBoundary";
import { getNotesFolder, pickNotesFolder, persistNotesFolder } from "@/lib/notes-folder";
import { checkClaudeCli } from "@/lib/ai-cli";
import { bootPersistence } from "@/lib/persistence";

const EditorPage = lazy(() => import("@/components/editor/EditorPage"));

type FolderState = string | null | undefined;

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export default function App() {
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | undefined>(undefined);
  const [notesFolder, setNotesFolder] = useState<FolderState>(undefined);
  const [persistenceReady, setPersistenceReady] = useState(false);

  useEffect(() => {
    checkClaudeCli()
      .then(setClaudeInstalled)
      .catch((e) => {
        console.error("checkClaudeCli failed:", e);
        setClaudeInstalled(false);
      });
  }, []);

  useEffect(() => {
    if (claudeInstalled !== true) return;
    getNotesFolder()
      .then(setNotesFolder)
      .catch((e) => {
        console.error("getNotesFolder failed:", e);
        setNotesFolder(null);
      });
  }, [claudeInstalled]);

  useEffect(() => {
    if (claudeInstalled !== true || !notesFolder) {
      setPersistenceReady(false);
      return;
    }
    let cancelled = false;
    bootPersistence()
      .then(() => {
        if (!cancelled) setPersistenceReady(true);
      })
      .catch((e) => {
        console.error("bootPersistence failed:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [claudeInstalled, notesFolder]);

  // Folder change: re-pick + re-persist, then reload the window so the store
  // re-bootstraps cleanly. Cheap and avoids cross-cutting cache invalidation.
  async function handleChangeNotesFolder() {
    try {
      const next = await pickNotesFolder();
      if (!next) return;
      await persistNotesFolder(next);
      window.location.reload();
    } catch (e) {
      console.error("change notes folder failed:", e);
    }
  }

  let view: React.ReactNode;
  if (claudeInstalled === undefined) {
    view = <LoadingScreen label="Checking Claude Code…" />;
  } else if (claudeInstalled === false) {
    view = <InstallClaudeScreen onInstalled={() => setClaudeInstalled(true)} />;
  } else if (notesFolder === undefined) {
    view = <LoadingScreen label="Loading config…" />;
  } else if (notesFolder === null) {
    view = <OnboardingScreen onFolderChosen={setNotesFolder} />;
  } else if (!persistenceReady) {
    view = <LoadingScreen label="Loading notes…" />;
  } else {
    view = (
      <Suspense fallback={<LoadingScreen label="Loading editor…" />}>
        <EditorPage
          notesFolder={notesFolder}
          onChangeNotesFolder={handleChangeNotesFolder}
        />
      </Suspense>
    );
  }

  return (
    <div className="font-sans antialiased">
      <ThemeProvider>
        <ErrorBoundary>{view}</ErrorBoundary>
      </ThemeProvider>
    </div>
  );
}
