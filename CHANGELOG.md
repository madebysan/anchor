# Changelog

All notable shipped features and changes, organized by date.
Updated every session via `/save-session`.

---

## 2026-05-14

### Features
- **Thread sidecar files:** comment threads now persist beside each markdown file
  as `<note>.md.threads.json`; existing localStorage thread data migrates on boot.
- **Move to folder:** file context menus now include a folder submenu for moving
  a note directly into any existing folder or back to root.
- **Reliable local DMG script:** added `npm run release:dmg`, which builds the
  app bundle and creates a verified DMG through `hdiutil` instead of Tauri's
  Finder/AppleScript DMG layout path.

### Fixes
- **Thread file lifecycle:** note rename, move, and delete now carry sidecar
  thread files with the markdown file.
- **Active-note move safety:** active note moves and renames now flush content
  and thread data before changing the file id.

### QA
- **Lint and optimization pass:** ESLint 9 flat config is in place, lint passes,
  accessibility issues from the QA audit were fixed, and font imports were
  reduced to Latin subsets.

### Docs
- Updated `backlog.md`, `plan.md`, and `docs/distribution.md` so open work
  matches the current app state.

## 2026-05-08

### Features
- **External notes refresh** — frontend now starts the Rust watcher, listens for `notes-changed`, refreshes the note cache/sidebar tree, reloads clean active files after external edits, and polls every 3 seconds while visible for Google Drive/Finder cases where native events are missed.
- **Empty folders in sidebar** — recursive tree walking now returns folders even before they contain `.md` files.
- **Feedback-mode personas** — personas now support `rewrite` or `feedback` mode. Editor/copywriter rewrite selected text; researcher/challenger default to feedback-only responses that stay in the comment thread.
- **Sidebar context menus** — file and folder rows now have right-click menus. Files support Reveal in Finder, Copy filepath, Rename, and Delete. Folders support Reveal in Finder and Rename folder.
- **Markdown paste formatting** — markdown-looking pasted text is parsed through the existing markdown pipeline before insertion into Tiptap.
- **Claude cancellation** — running Claude subprocesses are tracked per request, and Stop now terminates the active process instead of being a no-op.
- **Line height control** — editor appearance preferences now include Tight, Normal, Relaxed, and Loose line-height options in the toolbar and settings.
- **Expandable context chip** — persona context chips can expand to show the persona prompt and routed context preview before sending to Claude.
- **Suggestion reasons** — suggested edit reasons now appear inline under the assistant message when present.
- **Comment anchor restore** — comment threads now store passage anchors and reapply visual comment marks after markdown reload when the original passage can still be located.
- **Sidebar management v2** — sidebar menus now support new notes inside folders, new subfolders, duplicate note, move note to parent folder, and recursive folder delete.
- **First-run onboarding copy** — the folder picker now introduces Inline MD's markdown-folder + local-Claude workflow before asking for a folder.
- **Playwright smoke tests** — added a Playwright test script and initial markdown/settings regression coverage.

### Fixes
- **Startup default-note guard** — app boot/refresh no longer creates a root `Untitled.md` just because the markdown cache is temporarily empty or the selected notes folder only contains folders.
- **Disk-backed rename** — sidebar file rename now calls the Rust `rename_note` command and refreshes the document id/path instead of only mutating in-memory state.
- **Editor mount readiness** — document-store initialization now waits for an explicit Tiptap `onReady` callback instead of a fixed 100ms timeout.
- **Nested note writes** — `write_note` and `rename_note` create parent directories before writing or moving nested notes.

### Docs
- Added `docs/distribution.md` with the local build, signing/notarization, and DMG housekeeping checklist.

---

## 2026-05-06

### Features
- **Per-doc claude sessions** — first AI call in a doc starts a `claude --print --output-format json` session and captures `session_id`. Follow-ups use `--resume` so the doc context isn't re-sent every turn. Auto-retry without session on `--resume` failure.
- **Auto-apply UX** — claude's response replaces the highlighted passage directly in the editor; ⌘Z reverts. No staging accept/reject card.
- **Hierarchical sidebar** — Rust tree walker (`list_note_tree`) reads subfolders recursively. Sidebar renders nested with chevron expand/collapse. Active doc auto-expands its folder chain. Search flattens to matches across all depths.
- **Settings dialog** — three tabs (General / Personas / Shortcuts). General has notes folder + Reveal in Finder + Change folder + theme + default font/size + Reset. Personas tab has the default-persona picker.
- **Comment routing** — clickable persona-override dropdown next to the input. Default persona ("editor") fires when no `@trigger`. `Note:` / `TODO:` / `// ` prefixes opt out of AI entirely. Routing hint shown live as `→ @editor (default)`.
- **⌘⇧V keyboard shortcut** for new comment (anchored if selection, doc-level if not). Enter submits, Shift+Enter newline.
- **Native save dialog** — Tauri `dialog.save()` + new Rust `write_export_file` command. Replaces the silent `<a download>` that wrote to ~/Downloads.
- **Reveal in Finder** — Rust `open_path` command. Wired to Settings → General.
- **Onboarding hard wall** — `claude` CLI install check at boot; refuses to load editor without it. Falls back to install-instructions screen with Recheck button.
- **Folder picker onboarding** — first run prompts for a notes folder; persisted to OS app-config dir. "Change folder" reloads the window with new folder.
- **Markdown on disk** — notes are real `.md` files. `marked` + `turndown` for HTML ↔ markdown. Ids are filename stems with forward-slash separators for nested files.
- **Collapsible formatting toolbar** — left-side chevron hides B/I/H1/font/size; chrome (save indicator, export, theme, settings) stays. Default collapsed; preference persists.
- **General PATH augmentation** for production `.app` bundles — Finder-launched apps inherit a minimal PATH; `augment_path()` at startup prepends `/opt/homebrew/{bin,sbin}`, `/usr/local/{bin,sbin}`, `~/.local/bin`, `~/.npm-global/bin`, `~/.cargo/bin`, `~/.bun/bin`. Subprocess spawns inherit it.
- **App icon** — pixel-mark mark replaces Tauri default. Generated via `tauri icon` for all sizes (.icns / .ico / iOS / Android matrix).

### Fixes
- White screen on boot — replaced `claude --version` hang with PATH-based existence check; added ErrorBoundary that surfaces real error message instead of silent failure.
- Cascading boot crashes — `process.env` reference in inherited inlineai code, API-key gate rendering even though we removed API keys, missing loading states.
- "→ ref:" disclosure prefix from global ~/.claude/CLAUDE.md leaking into auto-applied replacement text — explicit prompt override + defensive line-stripper.
- "Unknown error" wallpapering Tauri invoke string rejections — error handler now handles strings, objects, and Errors.
- Symlinked subfolders failing path validation — `ensure_inside` rewritten to use literal-prefix match on normalized paths (not `canonicalize`), so Drive-synced symlinks count as "inside" the chosen folder.
- Sidebar tree overflow when expanding folders — added `min-h-0` to ScrollArea so it constrains in flex column.
- Traffic lights overlapping sidebar header — 28px draggable spacer at top of each column.
- AI prompt rebuilt as plain-English directive (XML-tagged sections weren't parsed as roles in `--print` mode); today's date injected; passage between explicit fences.
- Claude editing files behind editor's back — prompt now says "use Read freely, never Write/Edit; editor is authoritative."
- Multiple `ensure_inside` bugs — `notes.rs` was checking parent_canon == folder_canon (broke nested files); both paths now share consistent normalize-without-symlinks logic.

### Cleanup
- Removed ~600 lines of dead inheritance from inlineai web parent: API-key UI tab, multi-provider model picker, providers.ts, model-loader.ts, SetupScreen.tsx, ModelPicker.tsx, localStorage quota machinery, migration shims.
- 28 stale `"use client"` directives, 3 unused shadcn primitives (resizable, tooltip, badge), 4 unused npm deps (zod, tiptap-bubble-menu, tauri-plugin-fs, tauri-plugin-shell), 2 unused Cargo crates.
- Settings dropdown collapsed from 7 context strategies to 3 (passage-only / local-section / full-document) with on-load migration of legacy values.

### Distribution
- **Local release build preflight** — verified the icon set exists and confirmed there is no local Developer ID signing identity, so generated DMGs remain unsigned until signing is configured.
- **DMG build** — built `src-tauri/target/release/bundle/dmg/Inline MD_0.1.0_aarch64.dmg` locally and verified the disk image checksum with `hdiutil verify`.
- **`Inline MD 0.1.0 (path-fix).dmg`** built and on Desktop. ARM64, ~7 MB, unsigned. First launch: right-click → Open.

### Status: committed (working tree clean, dev server stopped)
