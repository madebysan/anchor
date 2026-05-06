import { useEffect, useState } from "react";
import ThemeProvider from "@/components/ThemeProvider";
import EditorPage from "@/components/editor/EditorPage";
import OnboardingScreen from "@/components/onboarding/OnboardingScreen";
import { getNotesFolder } from "@/lib/notes-folder";

type FolderState = string | null | undefined;

export default function App() {
  const [notesFolder, setNotesFolder] = useState<FolderState>(undefined);

  useEffect(() => {
    getNotesFolder()
      .then(setNotesFolder)
      .catch(() => setNotesFolder(null));
  }, []);

  return (
    <div className="font-sans antialiased">
      <ThemeProvider>
        {notesFolder === undefined ? null : notesFolder === null ? (
          <OnboardingScreen onFolderChosen={setNotesFolder} />
        ) : (
          <EditorPage />
        )}
      </ThemeProvider>
    </div>
  );
}
