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

https://github.com/user-attachments/assets/47c28438-fa45-4f50-a00a-07a694073fcb

Anchor brings the comment loop from Google Docs into a local markdown editor. Select a sentence, leave a note, or ask Claude Code to rewrite it. The edit lands inside the document with the thread beside it and a revert path if it misses.

Anchor talks to your local [Claude Code](https://docs.anthropic.com/en/docs/claude-code) install, so the AI runs on your signed-in subscription instead of API credits. Notes stay as plain `.md` files in the folder you choose. If you have `ANTHROPIC_API_KEY` set in your shell, Anchor unsets it before launching Claude so Claude uses the subscription instead of the API key.

## Install

Download the latest DMG from [Releases](https://github.com/madebysan/anchor/releases/latest), open it, and drag Anchor into Applications.

Requirements:

- macOS on Apple Silicon or Intel.
- Claude Code installed and signed in from Terminal.
- A folder of markdown files, or an empty folder where Anchor can create them.

On first launch, pick the folder Anchor should use. The sidebar follows the folder structure on disk, including empty folders, and refreshes when files change outside the app.

## Using it

**Add Comment** drops a plain note. **Ask AI** rewrites the selected passage, and Anchor keeps the request tied to that passage so follow-ups don't drift away from the sentence you meant.

**Chat** is for whole-note requests: summarize this, translate the document, rename John to Martin everywhere, append a table at the end, or fix the section that was just added.

Comment threads live in sidecar files next to each note (`<note>.md.threads.json`). If you open the markdown elsewhere, the text is still just markdown.

## Known limitations

If a passage is rewritten outside the app, the comment anchor can drift. You may need to re-anchor it or delete the comment. Edits that move text between two separate locations aren't auto-applied yet.

Made by [santiagoalonso.com](https://santiagoalonso.com)
