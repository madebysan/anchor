import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDocumentStore } from "@/lib/document-store";

const WELCOME_STORAGE_KEY = "anchor-welcome-dismissed-v1";
const SAMPLE_NOTE_TITLE = "Creative Brief - Weekend Photo Walk";

const SAMPLE_NOTE_MARKDOWN = `# Creative Brief: Weekend Photo Walk

## Goal

Make a small photo set that captures a Saturday morning walk before the neighborhood gets busy. The final set should feel quiet, specific, and easy to share.

## Audience

This is for friends who like photography, walking routes, and small city details. It should not feel like a travel guide or a polished campaign.

## Route

Start at the corner cafe, walk through the side streets with older storefronts, then end near the park entrance. Keep the route short enough to finish in 90 minutes.

## Shot List

| Shot | Why It Matters | Note |
|---|---|---|
| First coffee on the table | Sets the morning tone | Look for window light |
| Closed storefront signs | Adds texture and place | Avoid readable private info |
| Crosswalk shadows | Gives the set a graphic rhythm | Try a low angle |
| Park entrance detail | Creates a natural ending | Wait for a clean frame |

## Constraints

- Shoot only with one lens.
- Keep the edit to 12 final photos.
- Avoid photographing people directly unless they are unrecognizable in the frame.
- Make the captions plain and specific.

## Open Questions

- Should the set be black and white or muted color?
- Does the route need a stronger ending shot?
- Is this a standalone post, or the first entry in a recurring weekend series?

## Try This In Anchor

- Select the Goal paragraph and ask Claude to make it more specific.
- Add a comment on any shot that needs a better constraint.
- Use Chat to turn the shot list into a tighter sequence.
`;

function rememberDismissed(): void {
  try {
    localStorage.setItem(WELCOME_STORAGE_KEY, "true");
  } catch {
    // Ignore storage failures; the dialog can show again next launch.
  }
}

function shouldShowWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_STORAGE_KEY) !== "true";
  } catch {
    return true;
  }
}

export default function WelcomeDialog() {
  const initialized = useDocumentStore((state) => state.initialized);
  const createDocumentFromMarkdown = useDocumentStore(
    (state) => state.createDocumentFromMarkdown,
  );
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) return;
    setOpen(shouldShowWelcome());
  }, [initialized]);

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen);
    if (!nextOpen) rememberDismissed();
  }

  async function handleCreateSample(): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      await createDocumentFromMarkdown({
        title: SAMPLE_NOTE_TITLE,
        markdown: SAMPLE_NOTE_MARKDOWN,
      });
      rememberDismissed();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  }

  function handleSkip(): void {
    rememberDismissed();
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Welcome to Anchor</DialogTitle>
          <DialogDescription>
            Use the comment workflow you already know from shared docs, but tag
            Claude Code as the editor. Leave feedback, ask for changes, and keep
            iterating in your markdown.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/30 p-4">
            <p className="font-medium">A fast way to try it:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Select a sentence, then choose Ask AI for a focused rewrite.</li>
              <li>Use Add Comment when you want a note without calling Claude.</li>
              <li>Use Chat for questions, research notes, or full-document edits.</li>
            </ul>
          </div>

          <p className="text-muted-foreground">
            Anchor can create a sample creative brief so you can test selection edits,
            comments, tables, and document chat without risking your own notes.
          </p>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={handleSkip} disabled={creating}>
            Skip
          </Button>
          <Button type="button" onClick={handleCreateSample} disabled={creating}>
            {creating ? "Creating Sample..." : "Create Sample Note"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
