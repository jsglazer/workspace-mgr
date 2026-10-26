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
- Manual save workflow with an unsaved-changes warning by default (auto-save-on-switch is available as an opt-in setting). The warning's default action is **Switch without saving**, so pressing Enter never silently overwrites the stored layout — choose *Save and switch* deliberately.
- **Manage Workspaces modal** — filter, create, switch, rename, duplicate, and delete sessions with inline icons, an item counter, an ACTIVE badge, and full keyboard navigation (↑↓ move, Enter switch, Delete remove, Esc close). Sessions are listed under collapsible group sections (chevron toggle, expanded by default) plus an "Ungrouped" section, instead of a group filter bar. Sections appear in your chosen group order, and each header has ↑/↓ buttons to move it, Ungrouped included. Workspace names within each section are sorted alphabetically.
- **Organize sessions into groups**, with a "+" to create new ones and per-group Rename / Duplicate / Delete actions right in the modal, plus a dedicated Groups section in Settings (enable/disable toggle, create, manage and reorder existing groups with ↑/↓, Ungrouped included, or reset with **Sort A–Z**). Each session row also has its own "+"/"−" icons to join or leave groups via a checkbox dropdown, so a session can belong to more than one group at once.
- **One workspace menu, two entry points** — the left ribbon icon and a right-click on the status bar open the *same* menu: **Save session** (orange) and **Reload without saving** (blue) on top, then the Group → Workspace session list (one block per group in your chosen group order, Ungrouped included, each group under a folder header, sessions sorted alphabetically, the active one ticked, workspaces with a pinned window size marked with a window icon), then "Save current layout to session…", Save as, Rename, Duplicate, Version history, Pin window size / Clear pinned window size (desktop), Move to group…, Delete, and finally Customize click actions and Manage Workspaces.
- **Save current layout to an existing workspace** — pick any other session (listed in the same grouped arrangement as the workspace menu) from the command palette, the workspace menu, or an assignable status-bar click action. After a confirmation prompt it's overwritten with the layout you're looking at and becomes the active session, so the status bar shows its name. The session you came from keeps its last saved layout.
- **Pinned window size (desktop)** — "Pin window size to this workspace" (workspace menu, a session's right-click menu, or the command palette) makes a workspace remember Obsidian's main-window size; switching to it restores that size before the layout loads. Choose **Size only** (default) or **Size + location** in Settings → Window size; location also re-maximizes or re-enters full screen if the window was pinned that way. A window pinned on a display that's no longer attached is brought onto a visible one and shrunk to fit. A normal save never changes the pinned size; "Clear pinned window size" removes it. Pinned sizes sync with the session. Popout windows are never touched, and the feature is hidden on mobile.
- **Ribbon lock** (Settings → Ribbon, or the command palette) — every saved layout carries its own left-ribbon snapshot, so switching workspaces can reorder or unhide ribbon icons. "Lock ribbon to current layout" freezes one configuration (icon order *and* visibility) for the whole vault: it is re-applied at startup, written into the layout before every workspace switch (no flicker), and restored after any other layout load (core Workspaces, Commander macros). Hand edits are undone with a notice pointing at "Update locked ribbon from current"; "Unlock ribbon" turns it off. Icons the lock doesn't know (a new plugin, a renamed command) are added at the end — hidden by default, or shown via *Icons not in the lock* — and named once in a notice. While locked, saves store the locked ribbon and ribbon differences don't mark a workspace unsaved. The lock syncs across devices (the later change wins); phones are skipped.
- **Sync left ribbon layout** (Settings → Ribbon, shown while the ribbon is unlocked) — a one-time copy of a source workspace's saved ribbon (icon order and visibility — Obsidian stores the order as the key order of `left-ribbon.hiddenItems`) into every other workspace, plus an option to apply it to newly created workspaces too.
- **macOS menu bar (opt-in, Mac desktop only)** — show `{Vault Name} - {Workspace}` as a native menu-bar item next to Help, kept in sync with the active session/group. Since macOS only ever shows the frontmost app's menu bar, running several vaults at once shows only the focused vault's entry — no clutter from background vaults.
- Customizable status-bar click / middle-click / right-click actions, each with Alt/Cmd(Ctrl)/Shift modifier variants (12 slots total) — reassign any of them to any action from the plugin's Settings tab or via the right-click "Customize click actions" menu, including "Save current layout to session…". Clicking the status bar opens the session manager by default; ⌘-click saves the active session; ⌥-click cycles to the next session; right-click opens the workspace menu.
- Scroll on the status bar to switch sessions.
- **Set the status-bar session-name colour**, with separate settings colour pickers for light and dark themes.
- **Set the unsaved-changes highlight colour**, also with separate light/dark pickers (drives both the text colour and a computed background tint).
- Save, reload, duplicate, rename, delete, reorder, and bulk-delete sessions. Deletes stick across devices (see *Conflict-free merging* below).
- Per-session version history with restore.
- Load sessions from note front-matter with `workspace-session`, and save the current note's name as a session (writing the matching front-matter).
- Available in 21 interface locales.

## What's different from the original

- **Storage that Obsidian Sync will actually carry.** Sessions live in `data.json` alongside the settings. Obsidian Sync only ever transfers four files out of a plugin folder — `manifest.json`, `main.js`, `styles.css` and `data.json` — so anything stored in a subfolder can never reach a second machine. A full mirror is still written to `{vault}/.obsidian/plugins/workspace-mgr/sessions/{session_id}.json` with an index at `sessions/index.json`, which is what holds version history and what the plugin falls back to for recovery.
- **Version history stays on the device that made it.** History snapshots are excluded from the synced payload — they are typically ~70% of the bytes, and they are per-device undo state. They are kept in the local mirror and re-attached to each session at load.
- **Live absorption of a synced change.** Obsidian Sync rewrites `data.json` underneath a running plugin; `onExternalSettingsChange` merges the incoming copy into memory instead of letting the next local save overwrite it.
- **Conflict-free merging.** Session contents merge last-writer-wins by modified time; the index is union-merged; sessions are never deleted during a merge. A session you delete leaves a small tombstone (`deletedSessions` in `data.json`, kept for 90 days), so another device that still holds it cannot sync it back; an edit made on another device *after* the delete still wins. Every device must run 1.0.19 or later for deletes to propagate. If an incoming synced session is newer *and* its content diverges, it is preserved as a duplicate named `… (Conflict - <timestamp>)` rather than overwriting.
- **Status-bar colours.** The session-name colour and the unsaved-changes highlight colour are each settings colour pickers with separate light/dark-theme values, applied via CSS custom properties on the document root (no dynamic style injection) and resolved against Obsidian's active theme.
- **Modern, testable codebase.** Rewritten in TypeScript with a pure, dependency-free decision core (`src/core/`) that imports nothing from Obsidian, covered by a headless Vitest suite (194 tests, including the original plugin's 83 behavioral tests ported over).

> Sessions start fresh in the new location. Data from the original
> `workspace-plus-plus` plugin is **not** migrated or read.

## Usage

Open the command palette and search for *Workspace Manager* to switch sessions, save the current layout, save the current layout to a *different* existing session, create a blank session, open **Manage Workspaces**, or restore version history. Bind any of these to hotkeys. The status bar shows the active group and session; click it to open Manage Workspaces (filter, create, switch, rename, duplicate, delete, and browse sessions by collapsible group section), or right-click it to open the workspace menu, whose "Customize click actions" item lets you reassign what any click / middle-click / right-click combination (plain, Alt, Cmd/Ctrl, or Shift) does. The same action matrix is also available from **Settings → Workspace Manager → Customize click actions**. The left ribbon icon opens that same workspace menu, for jumping straight to a session or acting on the current one.

## Architecture

| Layer | Location | Notes |
|---|---|---|
| Pure core | `src/core/` | Session/persistence/merge logic. Zero `obsidian` imports; fully unit-tested. |
| i18n | `src/i18n/` | Per-language modules + loader. |
| Adapters | `src/adapter/` | Confine undocumented internals: workspace `getLayout`/`changeLayout`, the opt-in macOS menu-bar `Menu`/`MenuItem` integration, the main `BrowserWindow`/`screen` (pinned window size), and `workspace.leftRibbon` (ribbon lock). |
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
