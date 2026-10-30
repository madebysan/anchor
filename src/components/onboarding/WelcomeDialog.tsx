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

## Working Title

Before the neighborhood wakes up

## Short Version

Make a small photo essay from a Saturday morning walk. The set should feel quiet and local, like somebody noticing details before the day gets loud.

## Audience

This is for adult beginner photographers who want a simple assignment they can finish in one morning. They probably know their camera, but they still need help deciding what to look for and when to stop shooting.

## Story

The walk starts with coffee and window light, moves through side streets and closed storefronts, then ends at the park entrance when the neighborhood starts filling up. The sequence should feel like a slow reveal, not a checklist of pretty corners.

## Route Notes

Start at the corner cafe around 7:30 AM. Walk east for two blocks, turn toward the older storefronts, cross at the wide intersection, then finish near the park entrance. The route should take about 90 minutes if the group stops often.

## Source Check

The route passes a Saturday market, a privately owned arcade, and a small park conservatory. Before publishing the route, confirm whether photography is allowed inside the arcade and whether the market has rules about close-up photos of vendors or stalls.

## Shot List

| Shot | Purpose | Direction |
|---|---|---|
| First coffee on the table | Opens the story quietly | Shoot near the window, not from above |
| Closed storefront signs | Adds place and texture | Avoid readable phone numbers or private info |
| Crosswalk shadows | Gives the set a graphic break | Try one low angle and one wide frame |
| Market setup | Shows the neighborhood waking up | Keep people secondary unless they give permission |
| Park entrance detail | Creates a natural ending | Wait for a clean frame |

## Caption Drafts

- The first table by the window gets the softest light.
- The storefronts look asleep, but the reflections are already busy.
- The best ending might be the park gate, not the park itself.

## Constraints

- Shoot only with one lens.
- Keep the edit to 12 final photos.
- Avoid photographing people directly unless they are unrecognizable in the frame.
- Make the captions plain and specific.
- Leave room for one unexpected shot if the route feels too predictable.

## Open Questions

- Should the set be black and white or muted color?
- Does the route need a stronger ending shot?
- Is this a standalone post, or the first entry in a recurring weekend series?
- Should the captions mention camera settings, or would that make the piece feel too technical?
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
