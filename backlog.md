# Backlog

inline-md roadmap. Forked from inlineai 2026-05-06.
Organized by topic, not chronology.

Status as of 2026-05-14: **Phases 1, 2.1, 2.2, file watching, core
auto-apply UX, feedback-mode personas, hierarchical sidebar, sidebar context
menus v1, markdown paste formatting, Claude cancellation, dead-code cleanup,
settings, session reuse, app icon + DMG, comment anchor restore, sidebar
file/folder management v2, arbitrary folder moves, sidecar thread storage,
onboarding copy, distribution runbook + local DMG script, ESLint, accessibility
fixes, font bundle trimming, and initial Playwright smoke tests all shipped.**
Remaining big chunks: diff highlight polish, stronger source-offset anchoring,
signed/notarized distribution, deeper tests, and final branding.

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

### Keep the comment thread UI (decision)
**Files:** `src/components/comments/`.
- Keep threads for now. The current UI supports follow-ups, feedback personas,
  and suggested edits without forcing a redesign.
- Revisit only if threads start feeling heavy in actual use. A possible future
  shape is a collapsed per-passage history log, but this is not active work.

### Comment-mark round-trip (best-effort shipped)
**Files:** `src/extensions/comment-mark.ts`, `src/lib/markdown.ts`,
`src/lib/persistence.ts`.
- Shipped: threads now store a ProseMirror passage anchor and the editor
  reapplies `CommentMark` on load. It falls back to matching the selected text
  when positions drift.
- Shipped: thread storage moved from localStorage into sidecar
  `<note>.md.threads.json` files next to each markdown note. Existing
  localStorage threads migrate on boot.
- Remaining: track markdown-source offsets so anchors survive heavier external
  rewrites.

## UX polish

### Multi-document drag-to-reorder
- Sidebar already has the visual scaffold. Skip unless folder-of-files mode
  ends up needing manual ordering. (Filesystem mtime sort is probably enough.)

---

## Sidebar context menus

v1 and v2 shipped. Move-to-folder is now covered. Only pinning remains as a
separate product/design choice.

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
- ✓ **Move to arbitrary folder** - file context menu now exposes a folder
  submenu backed by the existing disk-backed move path.

### Later — needs separate design

- **Pin** — new state `pinnedDocIds: Set<string>`, persist in localStorage,
  sort sidebar with pinned at top. Visual pin indicator. Question: do
  pinned items override the mtime sort entirely, or is "pinned section
  first, then mtime-sorted" the right shape?

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

- [ ] Sign + notarize the macOS `.app` bundle for distribution. A Developer ID
      Application identity is now present locally. Next release pass is Tauri
      signing verification, `notarytool --keychain-profile "notarytool"`, stapling,
      and Gatekeeper verification.
- [ ] Release polish: decide whether the plain `hdiutil` DMG from
      `npm run release:dmg` is good enough for v0.1 distribution, or whether
      branded DMG layout is worth revisiting later.

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
