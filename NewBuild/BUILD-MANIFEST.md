# Build Manifest — workspace-mgr (Workspace Manager)

Obsidian plugin derived from `obsidian-workspace-plus`. Modern TypeScript, pure
testable core, multi-file sync-friendly storage. **97/97 Vitest tests green**
(83 reference tests ported + 14 new deterministic tests); `tsc --noEmit` clean;
production esbuild bundle builds (`main.js`).

**Targeted Obsidian version:** `minAppVersion` 1.11.0 (matches reference),
verified against the installed build **1.12.7**. The undocumented workspace layout
APIs (`getLayout()` / `changeLayout()`) are present and stable across that range;
they are confined to `src/adapter/layout-adapter.ts`.

## Files created

### Project scaffold
- `package.json` / `tsconfig.json` (strict) / `vitest.config.ts` / `esbuild.config.mjs` — TS + Vitest + esbuild toolchain.
- `manifest.json` / `versions.json` — id `workspace-mgr`, minAppVersion 1.11.0.
- `styles.css` — reference styles with `wpp-` → `wsmgr-`, plus `:root { --wsmgr-status-name-color }` and `.wsmgr-status-name { color: var(...) }`.

### Pure core (`src/core/`, zero `obsidian` imports)
- `types.ts` — Session/Group/SessionData/Layout types.
- `utils.ts` — id generation + platform/modifier helpers.
- `layout-utils.ts` — structural layout compare/clone/merge (volatile-state stripping).
- `css.ts` — colour-picker value → `--wsmgr-status-name-color` declaration mapping.
- `sync.ts` — pure merge helpers: union `mergeOrder`, local-delete-aware object merge, `reconcileSessionConflict` (duplicate-on-conflict), `mergeDiscoveredSessions` (orphan auto-merge).
- `default-data.ts` — default persisted state.
- `host.ts` — structural interfaces for the injected App/adapter/manifest.
- `session-service.ts` — **SessionService**: all session/group/CRUD/saving/switching/startup/command-sync/settings-state/validation/version-history *data* logic (composition, no prototype patching).
- `persistence-service.ts` — **PersistenceService**: multi-file storage + merge orchestration + Promise write-queue + debounce.

### i18n (`src/i18n/`)
- `helpers.ts`, `strings.ts` (generated interface), `index.ts` (loader: `resolveLocale`/`L`/`LANG_OPTIONS`/`LANG_ORDER`), `locales/<lang>.ts` × 21 — the reference's monolithic ~7,600-line `i18n.js` split per-language (all 5 source tables: STRINGS, EXTENDED_STRINGS, NOTE_SESSION_STRINGS, RESTORE_STRINGS, RESET_STRINGS, merged with the reference's precedence). Every language retained.

### Shell (`src/`, imports `obsidian` at the boundary only)
- `main.ts` — `Plugin` subclass: composes the services, wires collaborator seams to Obsidian, registers commands/status bar/settings/frontmatter, cleans up in `onunload`.
- `adapter/layout-adapter.ts` — the single module wrapping `getLayout`/`changeLayout`.
- `session-statusbar.ts` — status-bar render (`wsmgr-` classes).
- `statusbar-controller.ts` / `statusbar-actions.ts` — scroll/click handling + action registry.
- `frontmatter.ts` — `workspace-session` front-matter integration (`FrontmatterController`).
- `session-context-actions.ts` / `session-context-menu.ts` / `session-list-actions.ts` / `settings-context-menu.ts` — session menu option builder + renderers.
- `settings-tab.ts` — settings incl. the status-bar colour picker (applied via the CSS custom property on the document root).
- `modals/` — confirm / rename / unsaved-switch (faithful ports) + history / session-manager (functional equivalents) + `index.ts`.

### Tests (`tests/`, Vitest)
- 15 ported reference suites (83 cases) + `css`, `sync`, `persistence` (14 new deterministic cases) + `stubs/obsidian.ts`.

### Generation scripts (`~/.claude/scripts/`)
- `workspace-mgr-gen-styles.sh`, `workspace-mgr-split-i18n.mjs`, `workspace-mgr-gen-strings-type.mjs`.

## Objections to build-to constraints

1. **Instruction #3 named `fileItems[path].setCollapsed` as "the internal API the
   audit specified."** It is not: the audit (§2) flags the workspace *layout*
   serialization APIs, and the reference plugin uses no file-explorer internals at
   all. Implementing folder-collapse would have *added* a feature, violating
   "neither invent, add, nor omit relative to the reference." **Resolved with the
   user** (AskUserQuestion): the thin adapter wraps the layout APIs actually used;
   no folder-collapse feature was added.

2. **Ported-test divergences from the reference (all intentional per the
   constraints):** status-bar test class assertions changed `wpp-` → `wsmgr-`;
   `reset-cleanup` backup paths adapted to the new plugin storage location; the
   `session-sync` reload test targets the multi-file storage seam. In every case
   the *behavioral* assertions were preserved exactly.

3. **Internal persist-stamp keys `_wppSavedAt` / `_wppBackupPlatform`** are retained
   verbatim (they are JSON metadata keys in the *new* files, exercised by the ported
   `session-sync` tests — not CSS classes and not a legacy path). Flagging for a
   human in case a full de-branding to `_wsmgr*` is desired.

Otherwise: none.

## Reviewer criteria → where satisfied

| Criterion | Satisfied by |
|---|---|
| Zero `obsidian` imports in core session mgmt + merge logic | `src/core/*` (verified: 0 matches). SessionService & PersistenceService import only i18n/pure helpers. |
| Overlay DOM listeners use `registerDomEvent` / cleaned up on unload | Modals remove their `keydown` handlers in `onClose`; `main.ts onunload` clears timers/notices. |
| No FS writes bypass PersistenceService / outside plugin dir | All I/O in `PersistenceService`; every path derives from `manifest.dir` (test `persistence: paths`). |
| Settings colour picker → CSS custom property, no dynamic style injection | `settings-tab.ts` colour picker → `main.applyStatusNameColor()` sets `--wsmgr-status-name-color` on `:root`; `styles.css` consumes it. No `registerAndAddStyle`, no `<style>`/`innerHTML` (verified: 0). |
| No `registerAndAddStyle` / non-existent API | Verified: 0 matches. |
| Index named `sessions/index.json`, no `sessions/manifest.json` | `PersistenceService.getIndexPath()`; verified 0 `manifest.json` refs; test `persistence: paths`. |
| Status-bar classes use `wsmgr-`, no legacy `wpp-` | `styles.css`, `session-statusbar.ts`, `statusbar-controller.ts`; remaining `wpp-` are comments only. |
| 83 reference tests present & passing | `tests/*.test.ts` (ports) — 83 + 14 new = 97 green. |
| Never reads/imports legacy `workspace-plus-plus`; never writes outside plugin dir | No legacy path reads (verified); tests `persistence: multi-file load` (empty → null, reads only new location) and `persistence: paths`. |
| Directory scanner auto-merges orphan files | `sync.mergeDiscoveredSessions` + `PersistenceService.scanAndMergeOrphanSessions`; tests in `sync`/`persistence`. |
| Sync merge conflicting mtimes; newer wins, none dropped | `mergeExternalSessionDataForWrite` / `reconcileSessionConflict`; tests `session-sync`, `sync`. |
| Diverging newer → `(Conflict - <ISO>)` duplicate, no overwrite | `reconcileSessionConflict` / `conflictSessionName`; tests `sync`, `persistence`. |
| Write queue + debounce (fake timers) | `PersistenceService.persistData` (queue) / `requestPersist` (debounce); test `persistence: write queue`. |
| Colour value → CSS declaration string | `core/css.ts`; test `css`. |
