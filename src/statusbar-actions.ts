// Status-bar action registry: maps action ids to plugin behaviors and localized
// labels. Ported from the reference plugin's statusbar-actions.js.
import { App, Notice } from 'obsidian';
import * as i18n from './i18n';
import { SessionManagerModal, HistoryModal, ConfirmModal } from './modals';
import { openSessionContextMenu } from './session-context-actions';
import { openSettingsContextMenu } from './settings-context-menu';
import type { Session } from './core/types';

interface StatusBarActionPlugin {
    app: App;
    statusBarEl?: unknown;
    searchOverlayEl?: unknown;
    hideSearchOverlay?(): void;
    openSearchOverlay?(anchor: unknown): void;
    getActiveSession(): Session | null;
    saveActiveSession(): Promise<boolean>;
    saveAsSession(): Promise<boolean>;
    saveCurrentNoteNameAsSession(): Promise<unknown>;
    reloadCurrentSessionWithoutSaving(): Promise<boolean>;
    renameCurrentSession(): void;
    duplicateCurrentSession(): Promise<unknown>;
    switchRelativeFromStatusBar(offset: number): Promise<boolean>;
    createEmptySession(): Promise<unknown>;
    toggleAutoSaveOnSwitch(options?: { notify?: boolean }): Promise<boolean>;
    isVersionHistoryEnabled(): boolean;
    isVersionHistoryConfirmRestoreEnabled(): boolean;
    quickRestoreLatestHistory(): Promise<boolean>;
    isGroupFeatureEnabled(): boolean;
    getOrderedGroups(): { id: string; name: string }[];
    updateStatusBar(): void;
}

function resolveLabel(L: Record<string, unknown>, labelKey: string): string {
    const label = L[labelKey];
    return typeof label === 'function' ? (label as () => string)() : (label as string);
}

function openSessionMenuAction(plugin: StatusBarActionPlugin, event: unknown): void {
    const sess = plugin.getActiveSession();
    if (!sess) return;
    openSessionContextMenu({
        plugin: plugin as never,
        app: plugin.app,
        session: sess,
        isActive: true,
        event,
        showSaveAs: true,
        showSwitch: false,
        showRemoveFromGroup: false,
        showMoveToGroup: plugin.isGroupFeatureEnabled() && plugin.getOrderedGroups().length > 0,
        showCustomizeClicks: true,
        forceDeleteConfirm: true,
        notifyDeleted: false,
        onSessionsChanged: () => plugin.updateStatusBar(),
    });
}

function openSettingsMenuAction(plugin: StatusBarActionPlugin, event: unknown): void {
    openSettingsContextMenu({
        plugin: plugin as never,
        app: plugin.app,
        event,
        onChanged: () => plugin.updateStatusBar(),
    });
}

interface ActionDef {
    id: string;
    labelKey: string;
    run: (plugin: StatusBarActionPlugin, event?: unknown) => unknown;
}

const ACTIONS: ActionDef[] = [
    {
        id: 'quickSwitcher',
        labelKey: 'statusBarActionQuickSwitcher',
        run: (plugin) => {
            if (plugin.searchOverlayEl) plugin.hideSearchOverlay?.();
            else plugin.openSearchOverlay?.(plugin.statusBarEl);
        },
    },
    {
        id: 'sessionManager',
        labelKey: 'statusBarActionSessionManager',
        run: (plugin) => new SessionManagerModal(plugin.app as never, plugin as never).open(),
    },
    { id: 'saveSession', labelKey: 'statusBarActionSaveSession', run: (plugin) => plugin.saveActiveSession() },
    { id: 'saveAsSession', labelKey: 'cmdSaveAs', run: (plugin) => plugin.saveAsSession() },
    {
        id: 'saveCurrentNoteNameAsSession',
        labelKey: 'cmdSaveCurrentNoteNameAsSession',
        run: (plugin) => plugin.saveCurrentNoteNameAsSession(),
    },
    {
        id: 'reloadWithoutSaving',
        labelKey: 'statusBarActionReloadWithoutSaving',
        run: (plugin) => plugin.reloadCurrentSessionWithoutSaving(),
    },
    { id: 'renameSession', labelKey: 'cmdRename', run: (plugin) => plugin.renameCurrentSession() },
    { id: 'duplicateSession', labelKey: 'cmdDuplicate', run: (plugin) => plugin.duplicateCurrentSession() },
    { id: 'previousSession', labelKey: 'cmdPrevious', run: (plugin) => plugin.switchRelativeFromStatusBar(-1) },
    { id: 'nextSession', labelKey: 'cmdNext', run: (plugin) => plugin.switchRelativeFromStatusBar(1) },
    { id: 'newEmptySession', labelKey: 'cmdNewEmpty', run: (plugin) => plugin.createEmptySession() },
    {
        id: 'toggleAutoSaveOnSwitch',
        labelKey: 'cmdToggleAutoSave',
        run: (plugin) => plugin.toggleAutoSaveOnSwitch({ notify: true }),
    },
    {
        id: 'versionHistory',
        labelKey: 'statusBarActionVersionHistory',
        run: (plugin) => {
            const session = plugin.getActiveSession();
            if (session) new HistoryModal(plugin.app as never, plugin as never, session).open();
        },
    },
    {
        id: 'restoreLatestHistory',
        labelKey: 'statusBarActionRestoreLatestHistory',
        run: (plugin) => {
            const L = i18n.L;
            if (!plugin.isVersionHistoryEnabled()) {
                new Notice(L.historyNoEntries);
                return;
            }
            const activeSession = plugin.getActiveSession();
            if (!activeSession || !activeSession.history || activeSession.history.length === 0) {
                new Notice(L.historyNoEntries);
                return;
            }
            if (plugin.isVersionHistoryConfirmRestoreEnabled()) {
                const latestTime = new Date(activeSession.history[0].savedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                });
                new ConfirmModal(
                    plugin.app as never,
                    L.historyRestoreConfirm(activeSession.name, latestTime),
                    () => void plugin.quickRestoreLatestHistory(),
                    { confirmText: L.historyRestore, confirmClass: 'mod-cta' },
                ).open();
            } else {
                void plugin.quickRestoreLatestHistory();
            }
        },
    },
    { id: 'sessionMenu', labelKey: 'statusBarActionSessionMenu', run: (plugin, event) => openSessionMenuAction(plugin, event) },
    { id: 'settingsMenu', labelKey: 'statusBarActionSettingsMenu', run: (plugin, event) => openSettingsMenuAction(plugin, event) },
    { id: 'none', labelKey: 'statusBarActionNone', run: () => {} },
];

const ACTION_INDEX: Record<string, ActionDef> = {};
for (const action of ACTIONS) ACTION_INDEX[action.id] = action;

export function executeStatusBarAction(plugin: StatusBarActionPlugin, actionId: string, event?: unknown): unknown {
    if (!actionId || actionId === 'none') return;
    const action = ACTION_INDEX[actionId];
    if (!action) return;
    return action.run(plugin, event);
}

export function getActionLabel(L: Record<string, unknown>, actionId: string): string {
    const action = ACTION_INDEX[actionId] || ACTION_INDEX.none;
    return resolveLabel(L, action.labelKey);
}

export const ACTION_IDS: string[] = ACTIONS.map((a) => a.id);

export const SLOT_KEYS: string[] = [
    'click', 'altClick', 'modClick', 'shiftClick', 'middleClick', 'altMiddleClick',
    'modMiddleClick', 'shiftMiddleClick', 'rightClick', 'altRightClick', 'modRightClick', 'shiftRightClick',
];
