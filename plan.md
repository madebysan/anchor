# plan

## Done this session (2026-05-06)

Massive multi-phase day — fork stabilized, full AI integration shipped, multiple fix passes.

### Architecture
- Renamed inline-mac → inline-md (folder, npm, Cargo, lib name, bundle id, product name)
- Hierarchical sidebar: subfolder traversal in Rust (`list_note_tree`), tree types in JS, expand/collapse persistence, search-flattens-to-list mode
- Per-doc claude sessions via `--resume` for token-cheap follow-ups; auto-retry without session on `--resume` failure (no request lost)
- Auto-apply UX: claude's response replaces the highlighted passage in Tiptap; ⌘Z reverts
- File watcher Rust scaffolding (notify crate + self-write marker + debounce); JS listener still TODO

### UX
- Settings dialog rewritten: General (default) / Personas / Shortcuts. Notes folder + Reveal in Finder + theme + default font/size + Reset. Default-persona picker.
- Comment input: Enter submits, Shift+Enter newline; clickable persona-override dropdown; `→ @editor (default)` routing hint; `Note:` prefix opt-out from AI; ⌘⇧V keyboard shortcut for new comment.
- Toolbar: collapsible formatting cluster (default collapsed), removed keyboard-shortcuts icon (Settings tab covers it).
- Sidebar: traffic-light overlap fixed (28px drag spacer per column), notes folder shown in footer with Change action, scroll constraint fixed (`min-h-0`).
- Native save dialog for export (`@tauri-apps/plugin-dialog` save() + Rust `write_export_file`).
- Onboarding: install-Claude-Code hard wall, folder picker, claude-CLI auto-detection.

### Cleanup
- Two cleanup batches removed ~600 lines of dead inheritance from inlineai: API-key UI, multi-provider machinery (`providers.ts`, `model-loader.ts`, `ModelPicker.tsx`, `SetupScreen.tsx`), localStorage quota machinery, migration shims, 28 stale `"use client"` directives, 4 unused npm deps + 2 unused Cargo crates, 3 unused shadcn primitives.

### Bug fixes
- Several boot-stage cascade fixes: `process.env` reference, API-key gate, claude `--version` hang, white-screen-on-render-error → ErrorBoundary added.
- Path validation: `ensure_inside` rewritten to use literal-prefix match on normalized paths (not canonicalize), so symlinked subfolders (Drive sync) work.
- Production `.app` PATH augmentation so Finder-launched apps find Homebrew-installed `claude`.
- Prompt rebuild as plain-English directive with explicit passage fences; today's date injected; `→ ref:` stripper added defensively.
- Claude told to use Read but never Write/Edit (editor is authoritative; external writes get clobbered).
- Strategy picker simplified from 7 to 3 visible options with on-load migration.

### Distribution
- App icon swapped to san's pixel-mark via `tauri icon`.
- Built `Inline MD 0.1.0_aarch64.dmg` and saved to Desktop. Two on Desktop currently — `Inline MD 0.1.0.dmg` (older, missing PATH fix; TCC-locked) and `Inline MD 0.1.0 (path-fix).dmg` (newer, use this).

## Current state

- File watcher JS listener, Google Drive polling fallback, empty-folder sidebar,
  feedback-mode personas, sidebar context menus v1, markdown paste formatting,
  Claude subprocess cancellation, line-height control, expandable context chip,
  suggestion reason display, and explicit Tiptap editor readiness have been
  implemented.
- Comment anchors now restore visual highlights after markdown reload on a
  best-effort basis using stored ProseMirror positions, markdown-source offsets,
  and text fallback.
- Auto-applied edits and accepted suggestions now get a temporary highlight
  that fades after the replacement lands.
- Sidebar context menus v2 shipped: new note in folder, new subfolder,
  duplicate, move to parent folder, move to arbitrary folder, and recursive
  folder delete.
- Comment threads now persist in `<note>.md.threads.json` sidecar files next to
  the markdown note. Existing localStorage thread data migrates on boot.
- Tests: Playwright is wired via `npm run test:e2e` with markdown, persona
  settings, source-offset routing, thread-history smoke coverage, and a
  Vite-backed browser regression for mocked Tauri/Claude comment auto-apply plus
  markdown reload parity. The browser suite also covers multi-document switching
  with sidecar-backed comment and visual mark restore.
- QA: ESLint 9 flat config is present, lint passes, accessibility fixes from
  the QA pass are in place, and font imports were trimmed to Latin subsets.
- Docs: `docs/distribution.md` captures the local app build, the reliable
  `npm run release:dmg` path, notarization, and DMG housekeeping checklist.
- Startup default-note guard was added after manual testing showed the app could
  create a root `Untitled.md` on boot/refresh. It now only auto-creates the
  starter note when the selected notes folder is truly empty.
- Tauri dev process was restarted after the boot fix. Latest dev session used
  Vite on `http://localhost:1420/`.
- Local Keychain has a valid Developer ID Application identity. `npm run
  release:dmg` builds and signs the app/DMG, and `npm run release:notarize`
  submits, staples, and Gatekeeper-checks the DMG. The latest accepted Apple
  submission is `c8ac8c64-dce1-47ab-bd62-eddb55cb685e`.

## Next steps

Highest-value chunks queued in `backlog.md`:

- [ ] **Branding** - final name, icon, README hero, and release identity.

## Decisions & context

- **Personas should NOT auto-rewrite for everything** — shipped as per-persona `rewrite` / `feedback` mode. Researcher/challenger default to feedback.
- **Pinning** the only sidebar feature considered "later" — needs sort-logic + persistence + visual indicator design.
- **Branding** — "Inline MD" + pixel-mark icon are placeholders. Final naming + identity pass deferred until product is more stable.
- **Tauri `--bare` won't help** with the global CLAUDE.md leak — it forces ANTHROPIC_API_KEY auth, defeating subscription-quota benefit. Prompt-level override + output stripper is the path.

## Dependencies added (this session)

- npm: (none new — actually removed: `zod`, `@tiptap/extension-bubble-menu`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-shell`)
- Cargo: `notify = "8"` (file watcher), removed `tauri-plugin-fs`, `tauri-plugin-shell`
- macOS: nothing system-level

## Build & run

```bash
npm install
npm run tauri dev      # dev window with hot reload
npm run tauri build -- --bundles app
npm run release:dmg    # production .app + signed verified DMG via hdiutil
npm run release:notarize
npm run release:mac    # signed DMG + notarization + stapling
```

For unsigned local DMGs, use `INLINE_MD_NO_SIGN=1 npm run release:dmg`.
