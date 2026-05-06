import { useEffect, useState } from "react";
import ThemeProvider from "@/components/ThemeProvider";
import EditorPage from "@/components/editor/EditorPage";
import OnboardingScreen from "@/components/onboarding/OnboardingScreen";
import InstallClaudeScreen from "@/components/onboarding/InstallClaudeScreen";
import { getNotesFolder } from "@/lib/notes-folder";
import { checkClaudeCli } from "@/lib/ai-cli";
import { bootPersistence } from "@/lib/persistence";

type FolderState = string | null | undefined;

export default function App() {
  const [claudeInstalled, setClaudeInstalled] = useState<boolean | undefined>(undefined);
  const [notesFolder, setNotesFolder] = useState<FolderState>(undefined);
  const [persistenceReady, setPersistenceReady] = useState(false);

  useEffect(() => {
    checkClaudeCli()
      .then(setClaudeInstalled)
      .catch(() => setClaudeInstalled(false));
  }, []);

  useEffect(() => {
    if (claudeInstalled !== true) return;
    getNotesFolder()
      .then(setNotesFolder)
      .catch(() => setNotesFolder(null));
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

  let view: React.ReactNode = null;
  if (claudeInstalled === undefined) {
    view = null;
  } else if (claudeInstalled === false) {
    view = <InstallClaudeScreen onInstalled={() => setClaudeInstalled(true)} />;
  } else if (notesFolder === undefined) {
    view = null;
  } else if (notesFolder === null) {
    view = <OnboardingScreen onFolderChosen={setNotesFolder} />;
  } else if (persistenceReady) {
    view = <EditorPage />;
  }

  return (
    <div className="font-sans antialiased">
      <ThemeProvider>{view}</ThemeProvider>
    </div>
  );
}
