# Backlog

inline-mac roadmap. Forked from inlineai 2026-05-06.
Organized by topic, not chronology.

---

## Phase 1 — Make the AI layer work again

The fork compiles and the window opens, but the AI layer is currently disconnected
(the `/api/ai` route is gone, `useAIChat.ts` still calls `fetch("/api/ai")`).
This phase replaces that call with a Tauri command that shells out to `claude`.

### Add `ai_execute_claude` Rust command
**File:** `src-tauri/src/lib.rs` (new command + handler).
Reference: [Scratch's `ai_execute_claude`](https://github.com/erictli/scratch/blob/main/src-tauri/src/lib.rs).

- Spawn `claude <file_path> --dangerously-skip-permissions --print` with the
  user's prompt piped to stdin.
- Validate the file path is inside the user's notes folder (path-traversal guard,
  same pattern Scratch uses).
- Return `{ success, output, error }` to the JS side via `tauri::command`.
- Register in `tauri::generate_handler![]`.

### Replace `useAIChat.ts` with a Tauri-invoke wrapper
**File:** `src/hooks/useAIChat.ts`.
- Drop the `fetch("/api/ai")` SSE parser entirely.
- Call `invoke("ai_execute_claude", { filePath, prompt })` from `@tauri-apps/api/core`.
- Keep the same `UseAIChatReturn` shape so `EditorPage.tsx` doesn't need to change yet.
- `isLoading` is now a single boolean per thread (no streaming chunks).
- `stopGeneration` becomes a Rust-side process kill.

### Detect Claude CLI on launch
**Files:** `src-tauri/src/lib.rs` (new `ai_check_claude_cli` command), some
new component on first launch (`OnboardingScreen.tsx`?).
- If `claude` not found in PATH, show install instructions and refuse to run.
- No fallback to API keys (locked decision).

---

## Phase 2 — Markdown on disk

### Folder picker on first run
**Files:** new `src/components/onboarding/`, `src-tauri` config.
- "Choose your notes folder" via `tauri-plugin-dialog`.
- Persist the folder path (Tauri store, not localStorage).
- All `.md` files in that folder become the document list.

### Replace `localStorage` persistence with file I/O
**File:** `src/lib/persistence.ts`.
- Read: list `.md` files in the notes folder, parse each into a `DocumentSnapshot`.
- Write: save HTML-as-markdown back to the source file.
- Watcher: notify the store when files change on disk (drop-in replacement for
  the current `QuotaError` pub/sub).

### Markdown ↔ Tiptap conversion
**Files:** `src/lib/document-store.ts`, possibly new `src/lib/markdown.ts`.
- Tiptap loads from markdown (`tiptap-markdown` extension or `marked` + a
  custom paste handler).
- Save converts the editor's HTML back to markdown.
- Round-trip parity is the milestone — no formatting drift on save/reload.

### Per-passage comment storage
- Threads currently live in localStorage as JSON. Two options:
  1. Sidecar file: `note.md` + `note.md.threads.json` (visible but ugly in Finder).
  2. YAML frontmatter or fenced code block embedded in the markdown.
- Probably option 1 — simpler, doesn't pollute the markdown.
- Tracked separately because this is a real product decision, not just plumbing.

---

## Phase 3 — UX shift: thread → instruction-with-undo

### Auto-apply + diff highlight + ⌘Z
**Files:** `src/components/editor/Editor.tsx`, `src/extensions/comment-mark.ts`,
new `src/extensions/edit-highlight.ts`.
- After Claude returns, the new text replaces the old in the document.
- Add a transient `editHighlight` Tiptap mark that fades over ~3s.
- ⌘Z reverts to the pre-edit snapshot. Tiptap's history extension already
  supports this — verify the snapshot is captured before the AI write.

### Drop the comment thread UI
**Files:** `src/components/comments/`.
- Comments become single-message anchors, not threads.
- The comment record is: `{ passage, instruction, claudeOutput, decision: "kept" | "reverted" }`.
- Per-passage history log (collapsed by default) replaces the thread view.

### Drop `suggestEdit` accept/reject card
**File:** `src/components/comments/SuggestedEdit.tsx`.
- Delete entirely. The interaction is now in the document, not in a sidebar card.

---

## UX polish (carried from inlineai)

### Suggestion `reason` display
- The new flow is auto-apply, but Claude's text response (the "why") is still
  worth surfacing. Show under the comment, not as a card.

### Click-to-expand context chip
**File:** `src/components/comments/CommentInput.tsx`.
- The chip already shows strategy + char count. Make it clickable to reveal
  the actual prompt that will be sent to Claude. Full transparency.

### Multi-document drag-to-reorder
- Sidebar already has the visual scaffold. Skip unless folder-of-files mode
  ends up needing manual ordering. (Filesystem mtime sort is probably enough.)

### Keyboard shortcut to leave a comment
- Today commenting requires a mouse: highlight passage, click the floating
  comment button. Add `⌘⇧M` to open the comment composer on the current
  selection.

---

## Hygiene

### Window chrome polish
**File:** `src-tauri/tauri.conf.json`.
- macOS: `titleBarStyle: "Overlay"` is set; verify the traffic-light buttons
  don't overlap the editor toolbar at narrow widths.
- Windows/Linux: needs a different decoration strategy. Skip until a non-mac
  user actually surfaces.

### App icon
- Currently using Tauri's default icon. Generate a real one via `/mac-icons`
  → `/generate-image` when the rest is functional.
- Use `tauri icon <source.png>` to produce all sizes (`.icns`, `.ico`, PNG matrix).

### Tests (Playwright)
- Inherited from inlineai's backlog. `playwright` is in devDeps; no tests
  written yet. Same suggested first targets:
  - Multi-doc switch preserves comments
  - Comment + Claude round-trip with a mock CLI
  - File save round-trips markdown without drift

### Editor mount race
- Inherited: 100ms `setTimeout` in `EditorPage.tsx` waits for Tiptap to mount.
  Replace with an `onReady` callback prop on the Editor component.

### `findPassageParagraphIdx` substring brittleness
- Inherited: `context-router.ts` finds the passage by substring match.
  Fragile. Track passage position via the comment mark's range when the
  comment is created, store it on the thread.

---

## Future / exploratory

### Cross-platform sync
- Currently single-machine, single-folder. If multi-device sync becomes a
  need: see `~/.claude/skills/cross-platform-sync/`. Most likely answer for
  a markdown-on-disk app: just point the notes folder at iCloud Drive,
  Dropbox, or Google Drive and let the OS sync.
- No CloudKit, no Supabase, no app-managed sync layer. Files-on-disk
  delegates this problem.

### Windows + Linux builds
- Tauri makes this technically free, but signing/notarization for each
  platform is real work.
- Defer until someone other than san asks for it.

### Persona context strategies on top of Claude Code's native context
- Claude Code already reads adjacent files in the folder, has tool use, can
  multi-file edit. Some personas may not need any of `passage-only` /
  `tight` / `local-section` — they could just call `claude` on the file
  with the instruction and let Claude decide what to read.
- Investigate after Phase 1 — the right design depends on how Claude Code
  behaves with structured prompts vs free-form ones.
