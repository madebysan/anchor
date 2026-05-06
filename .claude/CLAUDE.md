# inline-md — project notes

Native desktop document editor where AI instructions are anchored to text passages.
Forked from `~/Projects/inlineai/` 2026-05-06. The web parent (web-smart-docs.vercel.app)
remains as the portfolio/demo version; this fork is the daily-driver target.

## Stack

- **Shell:** [Tauri 2.x](https://tauri.app/) (Rust backend + native OS webview, no bundled Chromium)
- **Frontend:** Vite 6 + React 19 + TypeScript
- **Editor:** Tiptap (ProseMirror)
- **State:** Zustand (single store at `src/lib/document-store.ts` — inherited from InlineAI)
- **Styling:** Tailwind CSS 4 + shadcn/ui + Radix
- **AI:** Shells out to local `claude` CLI via Tauri command. No API keys, no Vercel functions, no `@ai-sdk/*` packages.
- **Persistence:** Markdown files on disk. No localStorage, no SQLite.

## What's different from the inlineai parent

| | inlineai (web) | inline-md (fork) |
|---|---|---|
| Shell | Next.js + Vercel | Tauri (Rust + webview) |
| Build | Next.js | Vite |
| AI backend | `@ai-sdk/anthropic` + DeepSeek | local `claude` CLI subprocess |
| Auth | env-var API keys | Claude Code's own auth in `~/.claude/` |
| Storage | localStorage | `.md` files in a user-chosen folder |
| Comments | thread (chat) | anchored instruction + auto-apply + ⌘Z undo |
| Models | per-persona dropdown | whatever Claude Code is configured to use |
| Personas | prompt + model + context strategy | prompt template + context strategy only |
| Streaming | SSE token-by-token | full response on completion (CLI `--print`) |
| Onboarding | enter API key | hard wall: "install Claude Code" |
| Offline | no | no (Claude Code calls Anthropic API; ollama option deliberately dropped) |

## Locked decisions

- **Claude Code only.** No `codex` / `opencode` / `ollama` fallbacks. Single-target backend.
- **Hard wall on onboarding.** If `claude` isn't installed, show install instructions and refuse to run. No API-key fallback.
- **Markdown on disk.** Files are user-facing. Tiptap loads markdown, saves markdown.
- **Auto-apply + undo** for AI edits. Claude edits the file directly, change is highlighted, ⌘Z reverts to pre-edit snapshot. No staging card.

## Build & run

```bash
npm install
npm run tauri dev      # opens dev window with hot reload
npm run tauri build    # production .app + .dmg
```

Vite dev server runs on port 1420 (Tauri-standard, not 3000).

## Architecture (current state)

- **`src/hooks/useAIChat.ts`** — calls `invokeClaudeSession` (Tauri command). Module-level `Map<docId, sessionId>` holds per-doc claude sessions. First call passes `file_path` to start a session; subsequent calls pass `session_id` for `--resume`. Auto-retry on session failure (one transparent retry without session_id). Prompt is a plain-English directive (NOT XML-tagged sections — claude --print sees the whole thing as text).
- **`src/lib/ai/context-router.ts`** — 7 strategies still resolve at this layer; only 3 (`passage-only`, `local-section`, `full-document`) are exposed in the Settings UI. Migrations in `lib/settings.ts` rewrite hidden strategies on load.
- **`src/lib/persistence.ts`** — markdown files on disk. `bootPersistence` calls `list_note_tree`, flattens files into `noteCache` (id-keyed), and exposes `getNoteTree()` for the sidebar. Threads still in localStorage (Phase 3).
- **`src/lib/document-store.ts`** — Zustand store. `createDocument` uses sanitized-title ids (e.g. `Untitled-2`), not `doc-{ts}-{rand}`. ids include forward-slash separators for nested files (e.g. `playbook/foo`).
- **`src/components/editor/EditorPage.tsx`** — props: `notesFolder`, `onChangeNotesFolder` from `App.tsx`. Threads `sidebarTree` (augmented with synthetic root entries for in-memory-only docs) to `DocumentSidebar`.

## Production-only gotchas (learned 2026-05-06)

- **`.app` bundles inherit minimal PATH.** Mac apps launched from Finder get only `/usr/bin:/bin:...` — not the user's shell PATH. So Homebrew-installed tools (`/opt/homebrew/bin/claude`) are invisible. Fix: `augment_path()` in `src-tauri/src/lib.rs` runs at startup, prepending common dev locations to PATH. Subprocess spawns via `std::process::Command` inherit it. The `find_in_path()` helper in `ai.rs` reads the same augmented PATH.
- **`Path::canonicalize` resolves symlinks.** For path-traversal checks in folders that contain symlinks (Drive-synced subfolders, etc.), canonicalize will resolve out of the chosen folder and break `starts_with`. Use the `normalize()` helper in `notes.rs` / `ai.rs` instead — it resolves `.` and `..` without following symlinks. The user's chosen folder is authoritative; everything inside (including symlinks pointing elsewhere) counts as "inside."
- **`--bare` flag on claude is unusable.** It skips CLAUDE.md auto-discovery (which we want — see next point) but ALSO forces `ANTHROPIC_API_KEY` auth, defeating the subscription-quota benefit. Don't use it.
- **Global `~/.claude/CLAUDE.md` disclosure rules leak into outputs.** san's global file says "every response starts with `→ ref:`". Claude obeys that even in our automated rewriting context, prepending the disclosure to the replacement text. Two-layer fix: prompt explicitly tells claude to ignore global conventions for this turn, AND `stripCommentary()` in `useAIChat.ts` strips leading `→ ref:`/`Here is…`/`<thinking>` lines as a safety net.
- **Claude has Read AND Write/Edit tools at runtime** when launched via `claude --print --dangerously-skip-permissions`. We tell it in the prompt to use Read freely but NEVER Write/Edit — the editor is the authoritative writer, and direct file writes get clobbered on the next debounced save.

## File watcher (scaffolded, JS side TODO)

Rust side is in `src-tauri/src/watcher.rs` with `notify` crate, debounce, self-write marker, and `start_watching_notes` command. Hooked into `write_note` to suppress bouncing our own saves. JS listener (App.tsx → `listen("notes-changed")` → refresh cache → reload editor when active doc clean) is the next step. See backlog for details.

## What to keep from inlineai's `.claude/CLAUDE.md`

These rules carry over verbatim:
- **Personas are a primitive, not a marketplace** (no marketplace UI, no first-run persona-creation flow)
- **Surface what gets sent to the AI** (the chip in `CommentInput` showing strategy + char count must stay accurate)
- **Token efficiency is a first-class concern** (don't default everything to `full-document`)
- **Tiptap mount race:** the 100ms `setTimeout` in `EditorPage` is still needed
- **`editor.commands.setContent(html)` must pass `{ emitUpdate: false }`** to avoid update loops

## What to ignore from inlineai's notes

- Hardcoded model IDs (n/a — Claude Code chooses)
- Anthropic error-prefix-with-⚠️ rule (n/a — no streaming text errors from API)
- DeepSeek tool-use compliance (n/a — DeepSeek is gone)
- Migration shim for `apiKey` → `anthropicKey` (n/a — no API keys at all)
- Vercel deployment (n/a — this is a desktop app)

## Reference

- Parent repo: `/Users/san/Projects/inlineai/` (still active as web portfolio version)
- Shell-out reference implementation: [Scratch](https://github.com/erictli/scratch),
  specifically `src/services/ai.ts` and `ai_execute_claude` in `src-tauri/src/lib.rs`
