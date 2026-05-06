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

- Build: TS + Rust both clean. Vite production build clean. `.app` + `.dmg` bundles successfully.
- Tests: none written for inline-md yet. Playwright is in devDeps but unused.
- Working tree: clean (auto-checkpoint hooks committed everything).
- Tauri dev process: stopped at end of session.

## Next steps

Three discrete chunks queued in `backlog.md`:

- [ ] **File watcher JS listener** (Phase 2.3) — Rust scaffolding ready. App.tsx needs to call `start_watching_notes` after boot, listen for `notes-changed`, refresh cache, reload editor when active doc is clean. Required before re-enabling claude-Write/Edit flows.
- [ ] **Sidebar context menus v1** — replace hover Pencil/Trash with right-click menu. File menu: Reveal in Finder, Copy filepath, Rename, Delete. Folder menu: Reveal in Finder, Rename. ~2h. Needs `shadcn/ui add context-menu`.
- [ ] **Comment-mark roundtrip** (Phase 3) — turndown strips Tiptap CommentMark on save, so anchored comments don't survive doc reload. Need position-based comment storage in a sidecar `<note>.threads.json` file.

## Decisions & context

- **Personas should NOT auto-rewrite for everything** — researcher/challenger arguably need a "feedback only, no auto-apply" mode. Open design question; not in v1.
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
npm run tauri build    # production .app + .dmg → src-tauri/target/release/bundle/
```

For the production .dmg: ARM64 (Apple Silicon) build, ~7 MB. Unsigned — first launch needs right-click → Open.
