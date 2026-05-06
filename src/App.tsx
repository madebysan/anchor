import { useEffect, useState } from "react";
import ThemeProvider from "@/components/ThemeProvider";
import EditorPage from "@/components/editor/EditorPage";
import OnboardingScreen from "@/components/onboarding/OnboardingScreen";
import InstallClaudeScreen from "@/components/onboarding/InstallClaudeScreen";
import ErrorBoundary from "@/components/ErrorBoundary";
import { getNotesFolder } from "@/lib/notes-folder";
import { checkClaudeCli } from "@/lib/ai-cli";
import { bootPersistence } from "@/lib/persistence";

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
      .then((ok) => {
        console.log("checkClaudeCli ->", ok);
        setClaudeInstalled(ok);
      })
      .catch((e) => {
        console.error("checkClaudeCli failed:", e);
        setClaudeInstalled(false);
      });
  }, []);

  useEffect(() => {
    if (claudeInstalled !== true) return;
    getNotesFolder()
      .then((f) => {
        console.log("getNotesFolder ->", f);
        setNotesFolder(f);
      })
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
        if (!cancelled) {
          console.log("bootPersistence done");
          setPersistenceReady(true);
        }
      })
      .catch((e) => {
        console.error("bootPersistence failed:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [claudeInstalled, notesFolder]);

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
    view = <EditorPage />;
  }

  return (
    <div className="font-sans antialiased">
      <ThemeProvider>
        <ErrorBoundary>{view}</ErrorBoundary>
      </ThemeProvider>
    </div>
  );
}
