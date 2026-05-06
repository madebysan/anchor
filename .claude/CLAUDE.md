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

## Architecture seams (inherited from inlineai, will be reshaped)

- **`src/hooks/useAIChat.ts`** — currently calls `fetch("/api/ai")` which no longer exists. Will be replaced with a Tauri `invoke("ai_execute_claude", ...)` call. Same return shape so `EditorPage.tsx` keeps compiling.
- **`src/lib/ai/context-router.ts`** — the 7 strategies (`passage-only`, `tight`, etc.) still apply. The output shape changes: instead of building a `messages[]` array for the AI SDK, it builds a single prompt string passed to `claude` via stdin.
- **`src/lib/ai/providers.ts`** + **`model-loader.ts`** — gone. No multi-provider, no live model fetch. A single config object replaces them.
- **`src/lib/ai/tools.ts`** — already deleted. No more typed `suggestEdit` tool calls; we get plain text or in-place file edits from claude.
- **`src/lib/persistence.ts`** — currently localStorage. Will be replaced with a Tauri-side `tauri_plugin_fs` reader/writer for the user's chosen notes folder.
- **`src/lib/document-store.ts`** — keep most of the shape. Replace the `localStorage` subscription with a directory-watcher-driven sync.

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
