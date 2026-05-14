# Backlog

inline-md roadmap. Forked from inlineai 2026-05-06.
Organized by topic, not chronology.

Status as of 2026-05-08: **Phases 1, 2.1, 2.2, file watching, core
auto-apply UX, feedback-mode personas, hierarchical sidebar, sidebar context
menus v1, markdown paste formatting, Claude cancellation, dead-code cleanup,
settings, session reuse, app icon + DMG, comment anchor restore, sidebar file/folder
management v2, onboarding copy, distribution runbook, and initial Playwright
smoke tests all shipped.** Remaining big chunks: deeper auto-apply polish,
arbitrary file moves, signed distribution, and branding.

---

## Phase 3 — Auto-apply polish (core shipped)

The auto-apply UX shipped. Claude's reply replaces the highlighted passage
in Tiptap; ⌘Z reverts via the editor's history. What's still missing:

### Diff highlight + auto-fade
**Files:** new `src/extensions/edit-highlight.ts`, integration in
`src/components/editor/Editor.tsx`.
- Custom Tiptap mark applied to the changed range right after a claude
  edit. Fades over ~3s.
- The snapshot is already captured by Tiptap's history extension; verify
  it consistently does so before our `replaceWith` dispatch.

### Drop the comment thread UI (deferred)
**Files:** `src/components/comments/`.
- Comments become single-message anchors, not threads.
- Per-passage history log (collapsed by default) replaces the thread.
- Coupled with comment-mark round-trip below.

### Comment-mark round-trip (best-effort shipped)
**Files:** `src/extensions/comment-mark.ts`, `src/lib/markdown.ts`,
`src/lib/persistence.ts`.
- Shipped: threads now store a ProseMirror passage anchor and the editor
  reapplies `CommentMark` on load. It falls back to matching the selected text
  when positions drift.
- Remaining: move thread storage from localStorage into a sidecar
  `<note>.md.threads.json` file and track markdown-source offsets so anchors
  survive heavier external rewrites.

## UX polish

### Multi-document drag-to-reorder
- Sidebar already has the visual scaffold. Skip unless folder-of-files mode
  ends up needing manual ordering. (Filesystem mtime sort is probably enough.)

---

## Sidebar context menus

v1 and v2 shipped. Remaining work is arbitrary destination moves and pinning.

### v2 — file/folder management (shipped 2026-05-08)

**Folder actions:**
- ✓ **New Note in this folder** — extend `allocateNoteId` to take a parent
  folder id; have the Rust `write_note` create parent dirs as needed.
  The id becomes `<folder-id>/<sanitized-title>`.
- ✓ **New Subfolder** — new Rust `create_folder(path)` command. Refresh
  tree cache. Empty folders now show in the sidebar.
- ✓ **Delete Folder (recursive)** — new Rust `delete_folder(id)`. Big
  confirmation dialog ("Delete X note files inside?"). Update tree.

**File actions:**
- ✓ **Duplicate** — read source content, allocate `<original>-copy` id
  (with collision-safe suffixing — `allocateNoteId` already handles
  this), write new file. Persistence writeNote does the rest.
- ✓ **Move to Parent Folder** — implemented via the existing disk-backed
  `rename_note` command. Updates cache id and active-doc id when needed.

### Later — needs separate design

- **Pin** — new state `pinnedDocIds: Set<string>`, persist in localStorage,
  sort sidebar with pinned at top. Visual pin indicator. Question: do
  pinned items override the mtime sort entirely, or is "pinned section
  first, then mtime-sorted" the right shape?
- **Move to arbitrary folder** — needs a folder-picker UI (sub-menu or
  dialog). "Move to Parent Folder" covers most cases for less work.

### Branding pass — final icon, app name, identity
A working pixel-mark icon was wired up via `tauri icon` (committed at
`src-tauri/icons/`), but in dev mode the Dock often shows the Tauri
default — release `.app` bundles use it correctly. When the rest of
the product is stable enough to commit to identity:
- Confirm final app name (currently "Inline MD" / `inline-md` —
  open question whether this is the keeper).
- Final icon design pass. The current pixel-mark is a placeholder
  vibe; if it stays, generate higher-fidelity variants for retina /
  hover / etc.
- Update `productName`, `identifier`, README hero, and DMG branding
  if the name changes. See
  `~/.claude/references/project-rename-checklist.md` for the
  cross-cutting rename steps.
- Run `tauri icon <source.png>` to regenerate all sizes (`.icns`,
  `.ico`, PNG matrix) once the final icon is locked.

---

## Hygiene

### Window chrome polish
**File:** `src-tauri/tauri.conf.json`.
- macOS: `titleBarStyle: "Overlay"` is set; verify the traffic-light buttons
  don't overlap the editor toolbar at narrow widths.
- Windows/Linux: needs a different decoration strategy. Skip until a non-mac
  user actually surfaces.

### Tests (Playwright)
- Initial Playwright smoke tests shipped for markdown conversion and persona
  defaults. Next targets:
  - Multi-doc switch preserves comments
  - Comment + Claude round-trip with a mock CLI
  - File save round-trips markdown without drift

### `findPassageParagraphIdx` substring brittleness
- Inherited: `context-router.ts` finds the passage by substring match.
  Fragile. The comment thread now stores a passage anchor from the selected
  range; next step is routing AI context from that anchor instead of substring
  lookup.

---

## Added 2026-05-06 (session housekeeping)

- [ ] Sign + notarize the macOS `.app` bundle for distribution. Currently
      unsigned — users get the "unidentified developer" warning on first
      launch and need to right-click → Open. Use the Apple Developer ID
      cert + `xcrun notarytool` flow per `~/.claude/references/macos-niche-rules.md`.
- [ ] Replace the second DMG-on-Desktop hack — TCC blocked us from
      overwriting the old DMG, so two are sitting on Desktop. A small
      `/release-dmg` workflow that handles "trash old, drop new" cleanly
      would be nicer.
- [x] Tests — Playwright is wired with initial smoke tests. Backlog
      candidates already noted in `## Hygiene`. First targets: comment
      auto-apply round-trip with a mocked claude, markdown-on-disk
      save/reload parity, persona override flow.
- [x] First-run UX polish — OnboardingScreen now introduces the markdown-folder
      and local-Claude workflow before asking for a notes folder.

## Added 2026-05-06 (from Things triage)

- [ ] **Tagged personas inherit the full thread.** When a comment thread reaches a follow-up that @-mentions a different persona, that persona currently gets only the new message as context. Pass the prior thread (claude's responses + user follow-ups) so the tagged persona can pick up mid-conversation without the user re-explaining. Files: `src/hooks/useAIChat.ts` (build prompt), thread-state lookup in comment store.
- [ ] **Deep-refactor option: native Swift / Mac.** Decision-deferred exploratory item. Tauri is shipping fine, but the question is whether a native Swift rewrite (likely funded with Cape credits — engineering time budget, not API credits) would unlock things Tauri can't: real macOS document model, system services, sharper UI feel. Park until either (a) Tauri hits a real wall or (b) the app's value is proven enough to justify the rewrite cost. Reference: this is the "throw it away and rebuild" option, not an incremental change.

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
