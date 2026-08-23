# Workspace Manager

Workspace Manager (`workspace-mgr`) is an [Obsidian](https://obsidian.md/) community plugin for saving, switching, and organizing workspace sessions. It is built for people who want Obsidian layouts to feel fast, native, and keyboard-friendly — with **local-first storage that actually crosses devices** under Obsidian Sync.

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
- Manual save workflow with an unsaved-changes warning by default (auto-save-on-switch is available as an opt-in setting).
- **Manage Workspaces modal** — filter, create, switch, rename, duplicate, and delete sessions with inline icons, an item counter, an ACTIVE badge, and full keyboard navigation (↑↓ move, Enter switch, Delete remove, Esc close). Sessions are listed under collapsible group sections (chevron toggle, expanded by default) plus an "Ungrouped" section, instead of a group filter bar — workspace names within each section are sorted alphabetically.
- **Organize sessions into groups**, with a "+" to create new ones and per-group Rename / Duplicate / Delete actions right in the modal, plus a dedicated Groups section in Settings (enable/disable toggle, create, and manage existing groups). Each session row also has its own "+"/"−" icons to join or leave groups via a checkbox dropdown, so a session can belong to more than one group at once.
- **Left ribbon icon** opens a quick Group → Workspace switch menu (ungrouped sessions first, then each group, both sorted alphabetically), with a "Manage Workspaces" item at the bottom to jump straight into the full modal.
- **Sync left ribbon layout** (Settings → Ribbon) — pick a source workspace and replicate which ribbon icons it shows/hides to every other workspace with one click, plus an option to auto-apply that layout to newly created workspaces too. (Obsidian doesn't persist ribbon icon *order* anywhere, so only visibility is synced.)
- **macOS menu bar (opt-in, Mac desktop only)** — show `{Vault Name} - {Workspace}` as a native menu-bar item next to Help, kept in sync with the active session/group. Since macOS only ever shows the frontmost app's menu bar, running several vaults at once shows only the focused vault's entry — no clutter from background vaults.
- Customizable status-bar click / middle-click / right-click actions, each with Alt/Cmd(Ctrl)/Shift modifier variants (12 slots total) — reassign any of them to any action from the plugin's Settings tab or via the right-click "Customize click actions" menu. Clicking the status bar opens the session manager by default; ⌘-click saves the active session; ⌥-click cycles to the next session; the default right-click session menu also has a "Manage Workspaces" item at the bottom.
- Scroll on the status bar to switch sessions.
- **Set the status-bar session-name colour**, with separate settings colour pickers for light and dark themes.
- **Set the unsaved-changes highlight colour**, also with separate light/dark pickers (drives both the text colour and a computed background tint).
- Save, reload, duplicate, rename, delete, reorder, and bulk-delete sessions.
- Per-session version history with restore.
- Load sessions from note front-matter with `workspace-session`, and save the current note's name as a session (writing the matching front-matter).
- Available in 21 interface locales.

## What's different from the original

- **Storage that Obsidian Sync will actually carry.** Sessions live in `data.json` alongside the settings. Obsidian Sync only ever transfers four files out of a plugin folder — `manifest.json`, `main.js`, `styles.css` and `data.json` — so anything stored in a subfolder can never reach a second machine. A full mirror is still written to `{vault}/.obsidian/plugins/workspace-mgr/sessions/{session_id}.json` with an index at `sessions/index.json`, which is what holds version history and what the plugin falls back to for recovery.
- **Version history stays on the device that made it.** History snapshots are excluded from the synced payload — they are typically ~70% of the bytes, and they are per-device undo state. They are kept in the local mirror and re-attached to each session at load.
- **Live absorption of a synced change.** Obsidian Sync rewrites `data.json` underneath a running plugin; `onExternalSettingsChange` merges the incoming copy into memory instead of letting the next local save overwrite it.
- **Conflict-free merging.** Session contents merge last-writer-wins by modified time; the index is union-merged; sessions are never deleted during a merge. If an incoming synced session is newer *and* its content diverges, it is preserved as a duplicate named `… (Conflict - <timestamp>)` rather than overwriting.
- **Status-bar colours.** The session-name colour and the unsaved-changes highlight colour are each settings colour pickers with separate light/dark-theme values, applied via CSS custom properties on the document root (no dynamic style injection) and resolved against Obsidian's active theme.
- **Modern, testable codebase.** Rewritten in TypeScript with a pure, dependency-free decision core (`src/core/`) that imports nothing from Obsidian, covered by a headless Vitest suite (131 tests, including the original plugin's 83 behavioral tests ported over).

> Sessions start fresh in the new location. Data from the original
> `workspace-plus-plus` plugin is **not** migrated or read.

## Usage

Open the command palette and search for *Workspace Manager* to switch sessions, save the current layout, create a blank session, open **Manage Workspaces**, or restore version history. Bind any of these to hotkeys. The status bar shows the active group and session; click it to open Manage Workspaces (filter, create, switch, rename, duplicate, delete, and browse sessions by collapsible group section), or right-click it and choose "Customize click actions" to reassign what any click / middle-click / right-click combination (plain, Alt, Cmd/Ctrl, or Shift) does. The same action matrix is also available from **Settings → Workspace Manager → Customize click actions**. The left ribbon icon opens a faster Group → Workspace switch menu for jumping straight to a session, with its own "Manage Workspaces" item at the bottom if you need the full modal.

## Architecture

| Layer | Location | Notes |
|---|---|---|
| Pure core | `src/core/` | Session/persistence/merge logic. Zero `obsidian` imports; fully unit-tested. |
| i18n | `src/i18n/` | Per-language modules + loader. |
| Adapters | `src/adapter/` | Confine undocumented internals: workspace `getLayout`/`changeLayout`, and the opt-in macOS menu-bar `Menu`/`MenuItem` integration. |
| Shell | `src/` | `main.ts` (Plugin), status bar, settings, front-matter, modals/menus. |
| Tests | `tests/` | Vitest, headless. |

### Storage layout

| File | Synced? | Contents |
|---|---|---|
| `.obsidian/plugins/workspace-mgr/data.json` | ✅ yes | Source of truth: every setting plus all sessions, groups and order — minus version history. |
| `.obsidian/plugins/workspace-mgr/sessions/{id}.json` | ❌ no | Local mirror of each session, *including* its version history. |
| `.obsidian/plugins/workspace-mgr/sessions/index.json` | ❌ no | Local mirror index (plus `index.backup.json`). |
| `.obsidian/plugins/workspace-mgr/backups/sessions.{1,2,3}.json` | ❌ no | Hourly rotating local snapshots. |

Obsidian Sync's file filter accepts a plugin path only when it is exactly `plugins/{id}/{file}` and the basename is `manifest.json`, `main.js`, `styles.css` or `data.json`; everything in a subfolder is filtered out, which is why the synced state has to live in `data.json`.

Installs from before 1.0.15 migrate on first launch: the multi-file store seeds the first `data.json` write, with no user action required.

## Development

```bash
npm install
npm test        # run the Vitest suite
npm run build   # type-check + bundle to main.js
npm run dev     # watch build
```

## License

MIT — see [LICENSE](LICENSE). Derived from `obsidian-workspace-plus` (© 2025 s1m4ne).
