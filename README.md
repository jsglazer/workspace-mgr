# Workspace Manager

Workspace Manager (`workspace-mgr`) is an [Obsidian](https://obsidian.md/)
community plugin for saving, switching, and organizing workspace sessions. It is
built for people who want Obsidian layouts to feel fast, native, and
keyboard-friendly — with **local-first, sync-friendly storage** so sessions
travel cleanly between devices under Obsidian Sync.

> **Derived from [obsidian-workspace-plus](https://github.com/s1m4ne/obsidian-workspace-plus)**
> by s1m4ne. Workspace Manager is a modern TypeScript rewrite of that plugin with
> a redesigned multi-file storage layer and a status-bar colour setting. It is
> distributed under the MIT License (see [LICENSE](LICENSE)), which retains the
> original author's copyright.

> [!IMPORTANT]
> The core Obsidian **Workspace** plugin must be enabled for Workspace Manager
> to work.

## Highlights

- Save the current workspace layout as a named session.
- Switch sessions from the status bar, command palette, hotkeys, or session manager.
- Manual save workflow with an unsaved-changes warning by default (auto-save-on-switch
  is available as an opt-in setting).
- Organize sessions into groups.
- Customizable status-bar click / middle-click / right-click / modified-click actions —
  clicking the status bar opens the session manager (add/select/delete sessions) by default.
- Scroll on the status bar to switch sessions.
- **Set the status-bar session-name colour**, with separate settings colour pickers for
  light and dark themes.
- **Set the unsaved-changes highlight colour**, also with separate light/dark pickers
  (drives both the text colour and a computed background tint).
- Save, reload, duplicate, rename, delete, reorder, and bulk-delete sessions.
- Per-session version history with restore.
- Load sessions from note front-matter with `workspace-session`, and save the
  current note's name as a session (writing the matching front-matter).
- Available in 21 interface locales.

## What's different from the original

- **Sync-friendly storage.** Sessions are stored as individual files at
  `{vault}/.obsidian/plugins/workspace-mgr/sessions/{session_id}.json` with an
  index at `sessions/index.json`, instead of a single vault-root file. On startup
  the plugin scans the sessions directory and auto-merges any session files that
  arrived from another device but are not yet in the index.
- **Conflict-free merging.** Session contents merge last-writer-wins by modified
  time; the index is union-merged; sessions are never deleted during a merge. If
  an incoming synced session is newer *and* its content diverges, it is preserved
  as a duplicate named `… (Conflict - <timestamp>)` rather than overwriting.
- **Status-bar colours.** The session-name colour and the unsaved-changes
  highlight colour are each settings colour pickers with separate light/dark-theme
  values, applied via CSS custom properties on the document root (no dynamic
  style injection) and resolved against Obsidian's active theme.
- **Modern, testable codebase.** Rewritten in TypeScript with a pure,
  dependency-free decision core (`src/core/`) that imports nothing from Obsidian,
  covered by a headless Vitest suite (102 tests, including the original plugin's
  83 behavioral tests ported over).

> Sessions start fresh in the new location. Data from the original
> `workspace-plus-plus` plugin is **not** migrated or read.

## Usage

Open the command palette and search for *Workspace Manager* to switch sessions,
save the current layout, create a blank session, open the session manager, or
restore version history. Bind any of these to hotkeys. The status bar shows the
active group and session; click it to open the session manager (add, switch to,
or delete sessions), or reconfigure the click / middle-click / right-click
actions in settings.

## Architecture

| Layer | Location | Notes |
|---|---|---|
| Pure core | `src/core/` | Session/persistence/merge logic. Zero `obsidian` imports; fully unit-tested. |
| i18n | `src/i18n/` | Per-language modules + loader. |
| Layout adapter | `src/adapter/` | The only module that touches Obsidian's `getLayout`/`changeLayout`. |
| Shell | `src/` | `main.ts` (Plugin), status bar, settings, front-matter, modals/menus. |
| Tests | `tests/` | Vitest, headless. |

## Development

```bash
npm install
npm test        # run the Vitest suite
npm run build   # type-check + bundle to main.js
npm run dev     # watch build
```

## License

MIT — see [LICENSE](LICENSE). Derived from `obsidian-workspace-plus` (© 2025 s1m4ne).
