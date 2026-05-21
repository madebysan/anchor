# Security Policy

Anchor is a local macOS app. It reads and writes markdown files in the folder the user chooses, and it shells out to the local Claude Code CLI when the user asks AI to work on text.

## Supported Versions

Security fixes target the latest tagged release and `main`.

## Reporting

For sensitive issues, use GitHub private vulnerability reporting if it is available on this repository. For non-sensitive security hardening or dependency issues, open a normal GitHub issue.

Please do not include private notes, Claude transcripts, local file paths, credentials, or other personal data in public issues.

## Current Security Model

- Documents stay as markdown files on disk.
- Comment threads are sidecar JSON files next to the markdown note.
- Anchor does not have a hosted backend or API-key screen.
- AI requests use the user's local Claude Code install.
- Claude Code is launched with tool restrictions so Anchor remains the writer of record for edits.
- Raw markdown HTML is escaped before it reaches the editor.

## Not In Scope

Anchor does not try to sandbox the user's selected notes folder from the user. If a folder is chosen, Anchor can read and write markdown files there by design.
