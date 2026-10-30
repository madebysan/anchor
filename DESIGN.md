# Anchor Design

Anchor is a working desktop editor, not a marketing surface. The UI should feel quiet, dense, and dependable, with the document always treated as the center of gravity.

## Atmosphere

- Native-adjacent macOS utility.
- Calm productivity tool, no decorative flourishes.
- Editing-first: sidebars support the document, they do not compete with it.
- AI is visible as comments and chat, but never styled like a separate chatbot product.

## Colors

Anchor uses shadcn/Tailwind tokens from `src/styles.css`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `oklch(1 0 0)` | `oklch(0.145 0 0)` | main editor surface |
| `foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | primary text |
| `sidebar` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` | document and comment rails |
| `border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` | separators and panel edges |
| `muted-foreground` | `oklch(0.45 0 0)` | `oklch(0.708 0 0)` | labels, metadata, secondary text |
| `destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | destructive actions |

The table above is the Anchor theme. Other themes (`src/lib/appearance.ts`) choose only background, text and accent for each of light and dark; every other token is mixed from those three in sRGB, the accent becomes `primary`, `ring` and the link color, and the note's prose colors follow the theme. Text, secondary text, prose and links are pushed toward black or white until they reach 5:1 on the background (headroom for tinted rows), so any preset or picked color stays at WCAG AA. Anchor with no changes keeps the stylesheet values.

Comment highlights use warm yellow/amber `oklch` values. Applied AI edits use green `oklch` values. These accents should stay purposeful and sparse.

## Typography

- The Anchor theme uses `Geist Sans` for the interface and notes and `Geist Mono` for code, then system fonts. Other themes set their own three fonts (editor, interface, code) through `--font-editor`, `--font-ui` and `--font-code`.
- All fonts are bundled (Fontsource, SIL Open Font License, Latin subsets) so the app works offline: Geist, Inter, IBM Plex Sans/Serif/Mono, Source Sans 3, Source Serif 4, Source Code Pro, Atkinson Hyperlegible, Newsreader, Literata, EB Garamond, JetBrains Mono.
- Editor body uses Tailwind Typography through the `prose` classes.
- Sidebar labels use small uppercase text for scanability.
- Avoid hero-scale type inside app panels.

## Shape And Depth

- Base radius is `0.625rem`.
- Cards and controls use modest rounding through shadcn primitives.
- Depth is mostly border and background contrast, not shadows.
- Sidebars are full-height panels, not floating cards.

## Spacing Rhythm

- App shell is a three-column workspace: document tree, editor, comments/chat.
- Sidebars use compact `px-3` and `py-2` spacing.
- Editor content uses generous `px-12 py-8` padding.
- Resizable sidebars should keep stable minimum widths.

## Motion

- Motion is utilitarian: hover feedback, menu transitions, and temporary edit highlights.
- Applied edit highlights fade out over roughly 3 seconds.
- Avoid celebratory animation or decorative background motion.

## Patterns

| Pattern | Rule |
|---|---|
| Notes folder | Show the configured folder plainly in the sidebar footer; the name itself is the change-folder control (tooltip and hover state). |
| Comments | Passage comments stay visually anchored with `comment-highlight`. Comments are notes; requests to Claude go through the conversation with the selection attached. |
| AI edits | Apply directly in the editor, record the applied edit in the thread, and keep revert available. |
| Loading | Keep controls visible while Claude is running and expose stop actions. |
| Errors | Show actionable Claude CLI errors in the sidebar, not raw stack traces. |
| File refresh | External file changes should refresh the tree without surprising the active editor. The file watcher drives refreshes; a 15-second check (and returning to the window) catches what it misses. A refresh lists names and versions only and reads just the notes and comment files that changed; when nothing changed, no state updates. |
| Welcome | First-open guidance should stay brief and offer a sample note only by explicit user action. |
| Terminal | Bottom panel under the editor, hidden on launch and with ⌃\` without ending the session. Theme follows the app tokens. The header says whether Claude can see the open note. |
| Sidebar | One panel per selected note or folder: the note's comments (collapsible, hidden when there are none), a Conversation divider, then that note's or folder's Claude session, with a single input at the bottom. The header names the note or folder. A text selection shows as a quote above the input. No tabs, no selection bubble. |
| Chat | A full Claude Code session. Replies render as Markdown (raw HTML shown as text), tool steps as one quiet mono line each, notices as muted or destructive boxes. A chip above the input says which note and selection go with the message. |
| Document list | File names only (with `.md`), no per-row icon or timestamp; folders keep chevron and folder icon. No dividers around search. Notes and folders move by dragging onto a folder, a note inside it, or empty space (top level); the target folder highlights, a closed folder opens after a moment, and a small label follows the pointer. ⌥⌘C copies the selected item's path (as in Finder) and the footer briefly says "Path copied". |
| Window | No title bar: the strip under the traffic lights and the header rows (documents header, toolbar, chat header) move the window and zoom it on double-click; their buttons work as usual (`data-window-drag`, `src/lib/window-drag.ts`). |
| Toolbar | One row: Bold, Italic, H1, H2 and Bullet list, then a ⋮ menu with the other formatting, Text size and Line height (no Undo/Redo buttons; ⌘Z covers them). On the right, More (⋯: Export, Terminal, Focus mode, Dark mode with their shortcuts), Copy and Settings. |
| Window surfaces | Both sidebars use the editor's background; a 1px line (the resize handle) separates the panes. Fields are filled, not outlined. The note scrolls without a visible scrollbar. |
| Folder view | Selecting a folder replaces the editor with a quiet empty state (folder icon, name, note count) while the sidebar holds the folder's conversation. Only the folder row shows as selected. |
| Settings | A dialog with a section list on the left (General, Appearance, Claude, Shortcuts, About) and labelled rows (label and one-line description on the left, control on the right) grouped in bordered blocks. Visual choices (mode, theme) are picture tiles. |
| Themes | A preset fills every color and font; any field can then be changed, and Reset returns to the preset. One theme covers light and dark; Mode (System, Light, Dark) picks the variant. Color changes apply to the variant on screen. |
| Permissions | Claude's permission questions appear in the conversation as a small card with Allow and Deny. |
| Outside edits | A change another app writes to the open note is applied as one ordinary edit covering only the changed range. It is compared with the version Anchor last read or wrote, so unsaved typing elsewhere in the note is kept and saved with it (a pending save is dropped first so it can't write over the change); overlapping edits take the other app's text. the new text is left selected (drawn by the pinned selection while the editor is blurred) and ⌘Z undoes it. No review bar. |
| Diagrams | ```` ```mermaid ```` code blocks render as diagrams (Mermaid, loaded on first use, `strict` security, dark or neutral theme to match the mode). Double-click or a cursor inside shows the source; a selection that covers the block outlines it in the accent. |

## Shared Components

| Component | Variants | Sizes | File | Usages |
|---|---|---|---|---|
| AlertDialog | default | md | `src/components/ui/alert-dialog.tsx` | 1 |
| Button | default, destructive, outline, secondary, ghost, link | default, sm, lg, icon, icon-sm, icon-xs | `src/components/ui/button.tsx` | 15 |
| ContextMenu | default | md | `src/components/ui/context-menu.tsx` | 1 |
| Dialog | default | md | `src/components/ui/dialog.tsx` | 2 |
| DropdownMenu | default | md | `src/components/ui/dropdown-menu.tsx` | 2 |
| Input | default | md | `src/components/ui/input.tsx` | 2 |
| Label | default | md | `src/components/ui/label.tsx` | 1 |
| ScrollArea | default | md | `src/components/ui/scroll-area.tsx` | 3 |
| Select | default | sm, md | `src/components/ui/select.tsx` | 2 |
| Separator | horizontal, vertical | md | `src/components/ui/separator.tsx` | 1 |
| Switch | default | sm, md | `src/components/ui/switch.tsx` | 1 |
| Tabs | default | md | `src/components/ui/tabs.tsx` | 2 |
| Textarea | default | md | `src/components/ui/textarea.tsx` | 2 |

## Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-06 | Keep Anchor as a native desktop markdown editor. | The app is meant to be the daily-driver target for local markdown editing. |
| 2026-05-15 | Use plain markdown files plus thread sidecars. | Files remain user-facing and portable while preserving anchored AI context. |
| 2026-05-21 | Keep Claude Code read-only from Anchor. | The editor must stay the authoritative writer so undo, persistence, and review stay predictable. |

## Anti-Patterns

- Do not add API-key setup UI.
- Do not introduce a second AI provider picker.
- Do not make AI output feel like a separate chatbot surface when it is editing the document.
- Do not use raw hex colors in component code when a token exists.
- Do not add floating marketing-style cards to the main app workspace.
