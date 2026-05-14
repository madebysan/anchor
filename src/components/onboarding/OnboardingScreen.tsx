import { useState } from "react";
import { Button } from "@/components/ui/button";
import { pickNotesFolder, persistNotesFolder } from "@/lib/notes-folder";

interface OnboardingScreenProps {
  onFolderChosen: (path: string) => void;
}

export default function OnboardingScreen({ onFolderChosen }: OnboardingScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handlePick() {
    setError(null);
    setBusy(true);
    try {
      const path = await pickNotesFolder();
      if (!path) {
        setBusy(false);
        return;
      }
      await persistNotesFolder(path);
      onFolderChosen(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-8 bg-background p-8 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">Inline MD</h1>
        <p className="text-base text-muted-foreground">
          Work directly in a folder of markdown files. Highlight text, leave an instruction, and local Claude Code can edit that passage in place.
        </p>
        <p className="text-sm text-muted-foreground">
          Choose an existing notes folder or start with an empty one. You can change it later in Settings.
        </p>
      </div>
      <Button onClick={handlePick} size="lg" disabled={busy}>
        {busy ? "Opening picker…" : "Choose folder"}
      </Button>
      {error && (
        <p className="max-w-md text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
