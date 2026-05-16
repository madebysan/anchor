# Changelog

All notable shipped features and changes, organized by date.
Updated every session via `/save-session`.

---

## 2026-05-15

### Features
- **Before/After diff mode:** auto-applied AI rewrites now render an Applied
  edit card with before/after text and a one-click Revert action.
- **Caret insertion commands:** document-level AI comments that explicitly ask
  to insert, add, write, draft, append, or prepend text now write at the caret
  instead of turning the request into advice.
- **Ask AI at cursor:** the comments panel now offers a document-level AI entry
  point so new text can be drafted from the caret without selecting existing
  text first.
- **Sidebar Chat mode:** the right sidebar now separates anchored Comments from
  document-level Chat, so users can ask questions and request global edits
  without selecting text first.
- **Chat-driven global edits:** Chat can run document-wide rename/replace-all
  actions and whole-document transformations such as translation through
  editor-owned operations instead of Claude writing files directly.
- **Chat full-document default:** short Chat edit requests like "translate to
  spanish" or "make the intro better" now use the whole document by default
  instead of asking for a text selection.
- **Chat intent routing:** Chat now uses a dedicated intent classifier so
  realistic QA prompts are regression coverage, not hardcoded product behavior.
- **Chat append edits:** follow-up requests like "add those bullet points at
  the end of the document" now append a new section directly instead of asking
  the user to move the caret.
- **Markdown table edits:** generated markdown tables now render as real editor
  tables, save back to markdown tables, and can be fixed by follow-up AI edits.
- **No copy-paste edit fallback:** document-level edit requests without a
  selected target now ask for a selection or caret insertion instead of drafting
  text for the user to paste manually.

### Branding
- **Renamed app to Anchor:** updated product name, app window title, package
  metadata, Rust crate metadata, bundle identifier, visible onboarding/settings
  copy, README, distribution docs, and release script output naming.
- **Flipped Anchor icon:** regenerated the app icon set from the horizontally
  flipped mark so the symbol reads closer to a lowercase "a".
- **Migration safety:** Anchor reads prior localStorage keys and the
  old Tauri app-config folder so existing notes-folder selection, active note,
  editor preferences, expanded folders, and old thread data can carry forward.

### QA
- **Expanded real-life AI edit QA:** ran a 20-scenario Claude QA matrix across
  rewrites, direct inserts, off-topic inserts, vague document edits, structural
  moves, and conditional research-then-edit requests.
- **Safer AI edit routing:** vague quality edits without a selection now ask for
  a target, conditional research/edit chains stay in the thread until verified,
  and multi-range move requests no longer silently rewrite the selected text.
- **Whole-document rename edits:** selected text can now drive a document-wide
  replacement, so a request like "John is now called Martin, update it
  everywhere" changes every exact word occurrence through the editor.
- **Discussion grounding:** document-level discussion prompts now include the
  routed document snapshot so ordinary questions can answer from current editor
  context without modifying the file.
- Added browser coverage for Chat Q&A, no-selection document-wide rename,
  whole-document translation, and the existing selected-text rewrite path.
- Added browser coverage for AI rewrite diff rendering and reverting an
  applied edit back to the original selected passage.
- Added browser coverage for document-level AI insertion so direct insert
  commands cannot regress into "paste this yourself" responses.
- Added browser coverage to keep no-selection edit requests from producing
  copy-paste instructions.
- **Performance cleanup:** lazy-loaded the editor after startup gates, removed
  WOFF fallback font assets, and added an explicit SVG favicon. Production
  preview Lighthouse improved from 88 to 97, with initial transfer dropping
  from 384 KiB to 191 KiB.
- **Startup polish:** Claude availability and notes-folder config now load in
  parallel behind one smooth startup state instead of separate loading flashes.
- **Visual QA cleanup:** viewport safe-area metadata, touch-safe hover styling,
  and the render-error screen now pass the mobile static checks.
- **Notarized release artifact:** Apple accepted submission
  `21de2fc8-b4de-431c-a03e-c16430aded2a`; the stapled DMG passes Gatekeeper as
  a Notarized Developer ID artifact.
- **Flipped-icon release artifact:** Apple accepted submission
  `41cd2f68-5134-44ac-bc14-cb433d6b7674`; the stapled DMG passes Gatekeeper as
  a Notarized Developer ID artifact.
- Removed dead UI component exports, cleared stale Tauri build cache from the
  pre-rename path, and refreshed the file-watcher handoff note.
- Verified the rename with `npm run lint`, `npm run build`,
  `npm run test:e2e`, `cargo check`, and `npm run tauri build -- --bundles app`.
  The Tauri build produced a signed `Anchor.app`.

## 2026-05-14

### Features
- **Split selection actions:** selecting text now shows separate Add Comment
  and Ask AI actions. Add Comment creates a plain anchored note by default;
  Ask AI keeps the existing Claude/persona flow.
- **Thread sidecar files:** comment threads now persist beside each markdown file
  as `<note>.md.threads.json`; existing localStorage thread data migrates on boot.
- **Edit highlight fade:** auto-applied Claude edits and accepted suggestions now
  briefly highlight the changed range, then fade out.
- **Source-offset anchors:** comment anchors now store approximate markdown-source
  offsets and use them to route context when highlighted text appears more than
  once in a document.
- **Thread-aware persona switches:** follow-up messages include prior thread
  context, so a later `@researcher` or `@challenger` mention can pick up the
  conversation instead of seeing only the latest message.
- **Move to folder:** file context menus now include a folder submenu for moving
  a note directly into any existing folder or back to root.
- **Reliable local DMG script:** added `npm run release:dmg`, which builds the
  app bundle and creates a verified DMG through `hdiutil` instead of Tauri's
  Finder/AppleScript DMG layout path.
- **Signed macOS release workflow:** Tauri now uses the local Developer ID
  Application identity, the DMG script signs the generated image, and
  `npm run release:notarize` submits, staples, and Gatekeeper-checks the DMG.

### Fixes
- **Clearer Claude failures:** Claude CLI failures now surface specific,
  actionable messages instead of a generic exit-status line.
- **Responsive comment loading:** comment submission now keeps the UI responsive
  while Claude runs, so the editor no longer feels frozen during the loading
  window.
- **Thread file lifecycle:** note rename, move, and delete now carry sidecar
  thread files with the markdown file.
- **Active-note move safety:** active note moves and renames now flush content
  and thread data before changing the file id.

### QA
- **Editor chrome cleanup:** removed the optional font picker, dynamic font
  loader, nine unused font packages, and the live word-count footer. Size and
  line-height controls remain.
- **Lint and optimization pass:** ESLint 9 flat config is in place, lint passes,
  accessibility issues from the QA audit were fixed, and font imports were
  reduced to Latin subsets.
- **Routing tests:** added regression coverage for source-offset routing and
  thread history prompt formatting.
- **Browser-level editor regression:** Playwright now boots the Vite app with
  mocked Tauri and Claude commands, auto-applies a comment rewrite, checks the
  temporary edit highlight, and confirms the saved markdown reloads cleanly.
- **Multi-document comment regression:** browser coverage now switches between
  notes and confirms sidecar-backed comments plus visual marks restore on return.
- **Notarized release artifact:** Apple accepted the latest ARM64 DMG submission
  `7c9d0db2-0a06-4559-8428-87a1426b6960`; the stapled Desktop DMG passes
  Gatekeeper assessment.

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
- **First-run onboarding copy** — the folder picker now introduces Anchor's markdown-folder + local-Claude workflow before asking for a folder.
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
- **DMG build** — built `src-tauri/target/release/bundle/dmg/Anchor_0.1.0_aarch64.dmg` locally and verified the disk image checksum with `hdiutil verify`.
- **`Anchor 0.1.0 (path-fix).dmg`** built and on Desktop. ARM64, ~7 MB, unsigned. First launch: right-click → Open.

### Status: committed (working tree clean, dev server stopped)
