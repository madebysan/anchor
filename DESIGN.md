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

Comment highlights use warm yellow/amber `oklch` values. Applied AI edits use green `oklch` values. These accents should stay purposeful and sparse.

## Typography

- Sans: `Geist Sans`, then system fonts.
- Mono: `Geist Mono`, then platform monospace.
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
| Notes folder | Show the configured folder plainly and keep the change-folder action available. |
| Comments | Passage comments stay visually anchored with `comment-highlight`. |
| AI edits | Apply directly in the editor, record the applied edit in the thread, and keep revert available. |
| Loading | Keep controls visible while Claude is running and expose stop actions. |
| Errors | Show actionable Claude CLI errors in the sidebar, not raw stack traces. |
| File refresh | External file changes should refresh the tree without surprising the active editor. |
| Welcome | First-open guidance should stay brief and offer a sample note only by explicit user action. |

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
| 2026-05-06 | Keep Anchor as a native desktop fork of inlineai. | The app is meant to be the daily-driver target for local markdown editing. |
| 2026-05-15 | Use plain markdown files plus thread sidecars. | Files remain user-facing and portable while preserving anchored AI context. |
| 2026-05-21 | Keep Claude Code read-only from Anchor. | The editor must stay the authoritative writer so undo, persistence, and review stay predictable. |

## Anti-Patterns

- Do not add API-key setup UI.
- Do not introduce a second AI provider picker.
- Do not make AI output feel like a separate chatbot surface when it is editing the document.
- Do not use raw hex colors in component code when a token exists.
- Do not add floating marketing-style cards to the main app workspace.
