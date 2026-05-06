import { useEffect, useState } from "react";
import ThemeProvider from "@/components/ThemeProvider";
import EditorPage from "@/components/editor/EditorPage";
import OnboardingScreen from "@/components/onboarding/OnboardingScreen";
import { getNotesFolder } from "@/lib/notes-folder";
import { bootPersistence } from "@/lib/persistence";

type FolderState = string | null | undefined;

export default function App() {
  const [notesFolder, setNotesFolder] = useState<FolderState>(undefined);
  const [persistenceReady, setPersistenceReady] = useState(false);

  useEffect(() => {
    getNotesFolder()
      .then(setNotesFolder)
      .catch(() => setNotesFolder(null));
  }, []);

  useEffect(() => {
    if (!notesFolder) {
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
  }, [notesFolder]);

  let view: React.ReactNode = null;
  if (notesFolder === undefined) {
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
