# Backlog

inline-md roadmap. Forked from inlineai 2026-05-06.
Organized by topic, not chronology.

Status as of 2026-05-06 end-of-session: **Phase 1, 2.1, 2.2 shipped.** Auto-apply
UX (Phase 3) and comment-mark round-trip (Phase 3 sub) are the remaining
big chunks before this is daily-driver quality.

---

## Phase 3 — Auto-apply + ⌘Z UX

The current AI loop drops Claude's response into the comment thread as
text. The locked design is auto-apply: claude edits the file directly,
the change is highlighted, ⌘Z reverts.

### Switch from `ai_chat_claude` to `ai_execute_claude` for edits
**Files:** `src/hooks/useAIChat.ts`, possibly new `src/hooks/useAIEdit.ts`.
- The Rust command exists already (`ai_execute_claude` in
  `src-tauri/src/ai.rs`), takes a file path + prompt.
- Active doc's path is `<notes_folder>/<docId>.md`. The hook needs to
  resolve that. Either pass it from EditorPage, or have the hook read
  `useDocumentStore.getState().activeDocId` + `getNotesFolder()`.
- After claude returns, re-read the file from disk and pipe through
  `markdownToHtml()` into `pendingContentLoad`.

### Diff highlight + auto-fade
**Files:** new `src/extensions/edit-highlight.ts`, integration in
`src/components/editor/Editor.tsx`.
- Custom Tiptap mark applied to the changed range right after a claude
  edit. Fades over ~3s.
- ⌘Z reverts to the pre-edit snapshot. Tiptap's history extension already
  supports this — verify the snapshot is captured before the AI write.

### Drop the comment thread UI
**Files:** `src/components/comments/`.
- Comments become single-message anchors, not threads.
- The comment record is: `{ passage, instruction, claudeOutput, decision: "kept" | "reverted" }`.
- Per-passage history log (collapsed by default) replaces the thread view.

### Drop `suggestEdit` accept/reject card
**File:** `src/components/comments/SuggestedEdit.tsx`.
- Delete entirely. The interaction is now in the document, not a sidebar card.

### Comment-mark round-trip (KNOWN BROKEN)
**Files:** `src/extensions/comment-mark.ts`, `src/lib/markdown.ts`,
`src/lib/persistence.ts`.
- Phase 2 trade-off: turndown strips comment marks when converting HTML →
  markdown. Threads in localStorage survive but their visual highlights in
  the doc disappear on reload.
- Fix: store passage positions per-thread (start/end offsets in the
  markdown source), re-apply CommentMark on load by mapping those offsets
  to ProseMirror positions.
- Or: switch comment storage to a sidecar `<note>.md.threads.json` file
  alongside each note, with positions captured at create time.

---

## Phase 2.3 — File watching

### Detect external file changes (JS listener — Rust side scaffolded)
The Rust watcher is in place (`src-tauri/src/watcher.rs`, `notify` crate,
emits `notes-changed` events with `{ path, kind }`, debounces per-path,
self-write marker prevents bouncing our own saves). What's missing:

**Files:** `src/App.tsx` (or new `src/hooks/useFileWatcher.ts`),
`src/lib/persistence.ts`, `src/lib/document-store.ts`.

- After `bootPersistence()` succeeds, call
  `invoke("start_watching_notes")` to start the watcher.
- Listen for `notes-changed` via `@tauri-apps/api/event`'s `listen()`.
- On event:
  - Resolve the `path` to a doc id by stripping `<notes-folder>/` prefix
    and `.md` suffix.
  - Re-fetch the file content (`readNote(id)`) and update `noteCache`.
  - Update the sidebar tree cache so renames/creates/deletes show up.
  - If the changed doc is the active doc:
    - Editor clean (`saveStatus !== "saving"` and no pending content) →
      reload the editor with the new content via `pendingContentLoad`.
    - Editor dirty → log a warning and skip the reload. v2 adds a small
      conflict toast ("file changed externally — [Reload] [Keep mine]").

**Why this matters:** lets the user edit notes in vim/Obsidian/Bear and
have Inline MD pick up changes. Also re-enables claude-writes-the-file
flows (currently blocked via prompt because edits would get clobbered).

**Trigger:** when the "claude can edit the file" workflow becomes
worth re-enabling, OR when external editing is a regular workflow.

---

## UX polish

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

### Rename note (file rename on disk)
**File:** `src/lib/document-store.ts`.
- The Rust `rename_note` command exists. The store's `renameDocument`
  currently just mutates state.documents — the in-memory rename doesn't
  hit disk. Wire it up so renaming a doc renames the .md file and updates
  the cache id everywhere.
- Folded into the "Sidebar context menus — v1" item below.

---

## Sidebar context menus

Replace the per-row hover icons (Pencil, Trash) with a right-click menu.
Different actions per item kind (file vs folder). Reference: macOS Notes
and Bear context-menu UX patterns.

### v1 — low-hanging set (~2 hours)
**Files:** `src/components/documents/DocumentSidebar.tsx` (or new
`SidebarContextMenu.tsx`), needs `shadcn/ui`'s `context-menu` component
installed (`npx shadcn add context-menu`).

- Wrap each FileRow and TreeNodeView folder header in `<ContextMenu>`.
- File menu items:
  - **Reveal in Finder** — call existing `open_path` Rust command on the
    file's parent dir + select the file (`open -R <path>` reveals).
  - **Copy filepath** — `navigator.clipboard.writeText(path)`.
  - **Rename** — same flow as the current Pencil button (inline edit).
    Wire renameDocument to also call the Rust `rename_note` command (the
    folded "Rename note (file rename on disk)" task above).
  - **Delete** — same flow as the current Trash button (existing
    AlertDialog confirmation).
- Folder menu items:
  - **Reveal in Finder** — `open_path` on the folder.
  - **Rename folder** — needs a small Rust `rename_folder(old, new)`
    command (one `fs::rename` call). Update the tree cache.
- Remove the hover Pencil/Trash icons from FileRow.

### v2 — file/folder management (~1 day)

**Folder actions:**
- **New Note in this folder** — extend `allocateNoteId` to take a parent
  folder id; have the Rust `write_note` create parent dirs as needed.
  The id becomes `<folder-id>/<sanitized-title>`.
- **New Subfolder** — new Rust `create_folder(path)` command. Refresh
  tree cache. Empty folders are currently hidden by `walk_dir` — change
  that, or leave it (folders only appear once they have a `.md` inside).
- **Delete Folder (recursive)** — new Rust `delete_folder(id)`. Big
  confirmation dialog ("Delete X note files inside?"). Update tree.

**File actions:**
- **Duplicate** — read source content, allocate `<original>-copy` id
  (with collision-safe suffixing — `allocateNoteId` already handles
  this), write new file. Persistence writeNote does the rest.
- **Move to Parent Folder** — new Rust `move_note(id, target_dir)`
  command (fs::rename across folders). Update cache id everywhere.
  Active-doc id rewrite if needed.

### Later — needs separate design

- **Pin** — new state `pinnedDocIds: Set<string>`, persist in localStorage,
  sort sidebar with pinned at top. Visual pin indicator. Question: do
  pinned items override the mtime sort entirely, or is "pinned section
  first, then mtime-sorted" the right shape?
- **Move to arbitrary folder** — needs a folder-picker UI (sub-menu or
  dialog). "Move to Parent Folder" covers most cases for less work.

### App icon
- Currently using Tauri's default icon. Generate a real one via `/mac-icons`
  → `/generate-image` when the rest is functional.
- Use `tauri icon <source.png>` to produce all sizes (`.icns`, `.ico`, PNG matrix).

---

## Hygiene

### Window chrome polish
**File:** `src-tauri/tauri.conf.json`.
- macOS: `titleBarStyle: "Overlay"` is set; verify the traffic-light buttons
  don't overlap the editor toolbar at narrow widths.
- Windows/Linux: needs a different decoration strategy. Skip until a non-mac
  user actually surfaces.

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

### Subprocess cancellation
- `useAIChat.stopGeneration()` is a no-op. Add a Rust command that kills
  the running claude subprocess by pid (track per-thread).

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
- Investigate after Phase 3. The right design depends on how Claude Code
  behaves with structured prompts vs free-form ones.

---

## Done

- ✓ **Init** (commit `a7fe28c`) — Tauri + Vite scaffold, fork from inlineai,
  fonts swapped, window opens.
- ✓ **Rename to inline-md** (commit `16bab76`) — folder, npm, Cargo, lib,
  bundle id, product name. Plus folder-picker onboarding (Phase 2.1).
- ✓ **Phase 2.2: markdown on disk** (commit `edf5a53`) — Rust file I/O
  commands, marked + turndown round-trip, persistence.ts rewritten,
  document store uses filename-based ids.
- ✓ **Phase 1: Claude Code integration** (commit `0da3765`) —
  ai_check_claude_cli + ai_chat_claude + ai_execute_claude commands,
  install-detection hard wall, useAIChat rewritten to invoke claude.
