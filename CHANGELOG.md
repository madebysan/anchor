# Changelog

## Unreleased

- Landing page: new illustrations for the three feature rows, built with the Stageshow kit (MIT). The conversations and edits rows animate, and the theme card tours Anchor's eight themes and repaints the whole page when a visitor picks one. The illustrations follow the page's evening mode and the picked theme.

## 0.1.5 (2026-10-30)

- **A Claude conversation per note and per folder.** Each note keeps its own conversation, history included, and it comes back when you return to the note, even after quitting. Selecting a folder shows the folder instead of a note and opens that folder's conversation, for work across its notes (rename, reorganize, summarize) with your usual Claude permissions. Conversations follow notes and folders you rename or move in Anchor, and an open note that another tool renames.
- Each conversation is a real Claude Code session in your notes folder: Claude reads and edits notes with its usual tools and shows each step (Read, Edit, …) as it works. Its edits land in the note in place.
- Selected text shows as a quote above the chat input and goes with your next message; the Add Comment / Ask AI bubble is gone.
- When Claude needs a permission it doesn't have, it asks in the chat with Allow and Deny instead of stalling.
- One sidebar: the open note's comments at the top (collapsible), the conversation below, one input.
- A quieter window: the document list shows only file names (no file icons or "3d ago" lines), the search field has no dividers, and clicking the folder name in the footer changes the notes folder. The formatting toolbar fits on one row: Bold, Italic, H1, H2 and Bullet list stay visible, and a ⋮ menu holds the rest along with text size and line height. The Undo/Redo buttons and the collapse arrow are gone (⌘Z still works). The toolbar keeps Copy and Settings and moves Export, Terminal, Focus mode and Dark mode into one More (⋯) menu. Both sidebars now share the editor's black background, separated by thin lines; the search and message fields have no outline, and the note scrolls without a visible scrollbar. The Claude panel drops its "Claude · file name" header, and opens with a one-line "Ask about this note" and a "Message…" input.
- Document names show their file name with `.md`; long names and long replies stay inside their panels.
- Opening, selecting or leaving a note no longer rewrites it. Notes written by other tools keep their formatting until you edit them.
- A terminal under the editor (⌃` or More → Show terminal, hidden on launch) runs your shell in the notes folder and starts Claude Code, which follows the open note and your selection.
- When Claude (or any other app) changes the open note, only the changed text is replaced, in place, and it stays selected so you can see it. ⌘Z undoes it like any edit. There is no review bar.
- Mermaid diagrams: a ```` ```mermaid ```` code block shows the rendered diagram (following light and dark mode). Double-click it, or move the cursor into it, to edit the source; leave the block and it renders again. The file keeps the plain fenced code.
- **Paragraph spacing** (Small, Medium, Large) in Settings → Appearance and the ⋮ formatting menu sets the space between paragraphs and list items.
- ⌘Z right after opening a note no longer steps back into the previous note.
- **Move notes and folders by dragging them** in the documents list, as in Finder: drop on a folder, on a note inside it, or on empty space for the top level. A closed folder opens when you rest on it.
- **⌥⌘C copies the path** of the selected note or folder (Finder's shortcut). Copy path is also in the folder menu.
- The window moves when you drag any empty part of the headers (the documents header, the toolbar, the chat header), and double-clicking there zooms it.
- Typing is no longer lost when Claude changes the same note. A change Claude writes while you type elsewhere in the note is merged with your typing and both are saved; before, your pending save could write over Claude's change. If you both edit the same words, Claude's version wins and ⌘Z brings yours back.
- Themes keep text, secondary text and links readable: every theme (and any color you pick) is held to at least 4.5:1 contrast. Solarized, Sepia and Catppuccin light and Solarized dark were below it.
- Keyboard: Shift+F10 (or the Menu key) opens a note's or folder's menu in the documents list, folders gain **Move to folder** so they can move without dragging, arrow keys move through the Mode and Theme choices, and closing Settings puts focus back on the gear. The editor, diagrams and changes from other apps are announced to screen readers.
- Exporting asks for the destination in a dialog Anchor opens itself, and Reveal in Finder only shows items (a folder named like an app is never launched).
- Chat history stays within the app's storage limit by dropping the oldest conversations first, so saving can't quietly stop.
- **Much lighter when idle.** Anchor used to reread every note in the folder every 3 seconds. It now follows the file watcher, checks every 15 seconds and when you return to the window, and reads only notes that changed. On a 2,638-note folder idle CPU went from about 34% of a core to about 1%, and memory after launch from about 1 GB to about 350 MB.
- **Themes.** Settings → Appearance has eight themes (Anchor, Clay, Graphite, Paper, Sepia, Nord, Solarized, Catppuccin), each with a light and a dark version and its own fonts for notes, interface and code. Change any theme's accent, background and text colors or its fonts; Reset brings the theme back. Fonts ship with the app.
- **A new Settings window** with sections down the left: General (notes folder), Appearance (mode, theme, colors, fonts, text size, line height), Claude (Claude Code status, how conversations edit, the terminal switch), Shortcuts (now accurate) and About (the real version number). ⌘, opens it, as well as ⌘/.
- **Personas are gone.** Comments no longer call Claude (no more `@editor`, `@copywriter` or default persona); they are plain notes on a passage, and Claude is reached through the conversation. The Personas tab is removed from Settings, along with the old one-shot Claude calls behind it.

## 0.1.4 (2026-10-17)

- In-app updates: Anchor checks for a new version once per launch and offers to install it.
- New app icon: the standard Mac tile with margin, edge and shadow.

## 0.1.3 (2026-10-12)

- Anchor runs Claude Code exactly as you set it up, with your Claude account or your own API key. It no longer removes `ANTHROPIC_API_KEY` before launching Claude.
- Security update for the Tiptap editor.

## 0.1.1 and 0.1.2 (2026-05-21)

- A sample creative brief for new users, and onboarding copy that explains working with an AI collaborator.
- Startup checks that Claude Code is installed and signed in before you start.
- Comments on a selected passage that ask for an edit now apply it.
- AI insertions and rewrites keep Markdown formatting, including bullet lists.
- Safer Reveal in Finder for folders.
- Title, description and share metadata for the landing page.

## 0.1.0 (2026-05-16)

First release, as a signed and notarized universal DMG.

- Work in a folder of plain `.md` files. The sidebar mirrors the folder, including empty folders, refreshes when files change outside the app, and supports new notes and folders, rename, move, duplicate and delete.
- Select a passage to add a comment or ask Claude for a change. Threads are saved in sidecar files beside each note and stay anchored to their passage.
- Claude's edits land in the document with a highlight that fades, a before/after view, and a way to revert.
- Chat in the sidebar for document-wide edits such as renaming, translating or appending.
- Personas that either rewrite or give feedback, and an Ask AI entry at the cursor.
- Markdown tables render as editable tables, and pasted Markdown keeps its formatting.
- Line height control, and Stop cancels a running Claude request.
