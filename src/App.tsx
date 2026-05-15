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
interface StartupState {
  claudeInstalled: boolean;
  notesFolder: string | null;
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="size-3 rounded-full border border-muted-foreground/30 border-t-muted-foreground motion-safe:animate-spin" />
        {label}
      </div>
    </div>
  );
}

export default function App() {
  const [startup, setStartup] = useState<StartupState | undefined>(undefined);
  const [notesFolder, setNotesFolder] = useState<FolderState>(undefined);
  const [persistenceReady, setPersistenceReady] = useState(false);

  useEffect(() => {
    Promise.allSettled([checkClaudeCli(), getNotesFolder()])
      .then(([claudeResult, folderResult]) => {
        const claudeInstalled =
          claudeResult.status === "fulfilled" ? claudeResult.value : false;
        const nextNotesFolder =
          folderResult.status === "fulfilled" ? folderResult.value : null;

        if (claudeResult.status === "rejected") {
          console.error("checkClaudeCli failed:", claudeResult.reason);
        }
        if (folderResult.status === "rejected") {
          console.error("getNotesFolder failed:", folderResult.reason);
        }

        setStartup({ claudeInstalled, notesFolder: nextNotesFolder });
        setNotesFolder(nextNotesFolder);
      })
      .catch((e) => {
        console.error("startup failed:", e);
        setStartup({ claudeInstalled: false, notesFolder: null });
        setNotesFolder(null);
      });
  }, []);

  useEffect(() => {
    if (startup?.claudeInstalled !== true || !notesFolder) {
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
  }, [startup?.claudeInstalled, notesFolder]);

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
  if (startup === undefined) {
    view = <LoadingScreen label="Preparing Anchor…" />;
  } else if (startup.claudeInstalled === false) {
    view = (
      <InstallClaudeScreen
        onInstalled={() =>
          setStartup({
            claudeInstalled: true,
            notesFolder: notesFolder ?? startup.notesFolder,
          })
        }
      />
    );
  } else if (notesFolder === undefined) {
    view = <LoadingScreen label="Loading folder…" />;
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
