<p><img src="assets/app-icon.png" width="128" height="128" alt="Anchor app icon"></p>

<h1>Anchor</h1>

<p>Collaborate with AI writers inside your local notes.<br>
Select a passage, ask Claude Code for a change, and review the edit where you wrote it.</p>

<p><strong>Version 0.1.2</strong> · macOS · Universal</p>

<p>
  <img src="https://img.shields.io/badge/Tauri-24c8db" alt="Tauri">
  <img src="https://img.shields.io/badge/React-61dafb" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-3178c6" alt="TypeScript">
  <img src="https://img.shields.io/badge/macOS-000000" alt="macOS">
</p>

<p>
  <a href="https://github.com/madebysan/anchor/releases/latest">Download for Mac</a> ·
  <a href="https://anchor.santiagoalonso.com">anchor.santiagoalonso.com</a>
</p>

<video src="public/anchor-demo.mp4" controls muted playsinline>
  <a href="public/anchor-demo.mp4">Watch the Anchor demo video</a>
</video>

Anchor brings the comment loop from Google Docs into a local markdown editor. Select a sentence, leave a note, or ask Claude Code to rewrite the passage. The edit lands inside the document with the thread beside it and a revert path if it misses.

It uses your local [Claude Code](https://docs.anthropic.com/en/docs/claude-code) install. There is no API-key screen in Anchor and no hosted document store. On launch, Anchor checks that Claude Code is installed and signed in before it opens the editor. If you have `ANTHROPIC_API_KEY` set in your shell, Anchor removes it before launching Claude so Claude Code uses your signed-in account instead of API credits. Your notes stay as `.md` files in the folder you choose. When you ask AI to work on text, the selected passage or relevant document context is sent through Claude Code; Anchor does not send notes anywhere on its own.

## Install

Download the latest DMG from [Releases](https://github.com/madebysan/anchor/releases/latest), open it, and drag Anchor into Applications.

Requirements:

- macOS on Apple Silicon or Intel.
- Claude Code installed and signed in from Terminal.
- A folder of markdown files, or an empty folder where Anchor can create them.

On first launch, pick the folder Anchor should use. The sidebar follows the folder structure on disk, including empty folders, and refreshes when files change outside the app.

## How It Works

Use **Add Comment** for plain notes and **Ask AI** when you want the selected passage rewritten. Anchor keeps the request tied to that passage, so follow-ups do not drift away from the sentence you meant.

Use **Chat** when the request needs the whole note: summarize this, translate the document, rename John to Martin everywhere, append a table at the end, or fix the section that was just added.

## Working With Files

Anchor reads and writes plain markdown. Comment threads live in sidecar files next to the note, using the pattern `<note>.md.threads.json`. If you open the markdown elsewhere, the text is still just markdown.

## Development

```bash
npm install
npm run tauri dev
```

Release builds use:

```bash
npm run release:mac
```

That builds the app, signs the DMG, submits it for notarization, staples the result, and runs the local Gatekeeper check.

## Known Limitations

Comment anchor restoration is best-effort if the underlying passage is heavily rewritten outside the app. Structural edits that move text between two separate locations are intentionally not auto-applied yet.

For feedback, open an issue in this repo.

Made by [santiagoalonso.com](https://santiagoalonso.com)
