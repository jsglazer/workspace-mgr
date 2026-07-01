// Builds the shared option set for a session context menu (save / reload /
// duplicate / group membership / rename / delete / version history) with default
// handlers and refresh callbacks. Ported from the reference plugin's
// session-context-actions.js. UI rendering is delegated to session-context-menu.
import { App, Notice } from 'obsidian';
import * as i18n from './i18n';
import HistoryModal from './modals/history-modal';
import CustomizeClicksModal from './modals/customize-clicks-modal';
import * as sessionContextMenu from './session-context-menu';
import * as sessionListActions from './session-list-actions';
import type { ConfirmModalOptions } from './modals/confirm-modal';
import type { Session } from './core/types';

interface ContextActionPlugin {
    app: App;
    data: {
        groups?: Record<string, { id: string; name: string }>;
        activeSessionId?: string | null;
        sessions?: Record<string, Session>;
        confirmDeleteByHotkey?: boolean;
        statusBarActions?: Record<string, string> | null;
    };
    isGroupFeatureEnabled?(): boolean;
    getOrderedGroups?(): { id: string; name: string }[];
    setStatusBarAction(slotKey: string, actionId: string): Promise<unknown>;
    updateStatusBar(): void;
    saveActiveSession(): Promise<boolean>;
    reloadCurrentSessionWithoutSaving(): Promise<boolean>;
    saveAsSession(): Promise<boolean>;
    confirmOverwriteSessionWithCurrentLayout(sessionId: string, options: { onSaved?: () => void }): boolean;
    duplicateSession(sessionId: string): Promise<unknown>;
    removeSessionFromGroup(sessionId: string, groupId: string): Promise<boolean>;
    moveSessionToGroupExclusive(sessionId: string, groupId: string): Promise<boolean>;
    renameSessionById(sessionId: string, newName: string): Promise<boolean>;
    deleteSession(sessionId: string): Promise<boolean>;
    restoreFromHistoryEntry(sessionId: string, entryIndex: number): Promise<boolean>;
    countPanesInLayout(layout: unknown): number;
}

export interface SessionContextActionOptions {
    plugin: ContextActionPlugin;
    app?: App;
    session: Session;
    isActive?: boolean;
    event?: unknown;
    getViewGroupId?: () => string | null;
    onGroupsChanged?: () => void;
    onSessionsChanged?: () => void;
    showSaveAs?: boolean;
    showSwitch?: boolean;
    showRemoveFromGroup?: boolean;
    showMoveToGroup?: boolean;
    showCustomizeClicks?: boolean;
    onCustomizeClicks?: () => unknown;
    forceDeleteConfirm?: boolean;
    notifyDeleted?: boolean;
    deleteConfirmMessage?: string;
    deleteConfirmOptions?: unknown;
    onSave?: () => unknown;
    onReload?: () => unknown;
    onSaveAs?: () => unknown;
    onOverwriteWithCurrentLayout?: () => unknown;
    onSwitch?: () => unknown;
    onRename?: () => unknown;
    onDuplicate?: () => unknown;
    onDelete?: () => unknown;
    onRemoveFromGroup?: () => unknown;
    onMoveToGroup?: (groupId: string) => unknown;
    onVersionHistory?: () => unknown;
    [key: string]: unknown;
}

function hasOwn(options: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(options, key);
}

function optionOrDefault<T>(options: Record<string, unknown>, key: string, fallback: T): T {
    return hasOwn(options, key) ? (options[key] as T) : fallback;
}

function call(fn: unknown): void {
    if (typeof fn === 'function') (fn as () => void)();
}

function callAfter<T>(promise: T, fn: unknown): T {
    const p = promise as unknown as { then?: (cb: (v: unknown) => unknown) => unknown };
    if (p && typeof p.then === 'function') {
        return p.then((value: unknown) => {
            call(fn);
            return value;
        }) as unknown as T;
    }
    call(fn);
    return promise;
}

function getGroupName(plugin: ContextActionPlugin, groupId: string): string {
    return ((plugin.data.groups || {})[groupId] || ({} as { name?: string })).name || '';
}

function shouldShowMoveToGroup(plugin: ContextActionPlugin): boolean {
    return !!(
        plugin &&
        plugin.isGroupFeatureEnabled &&
        plugin.isGroupFeatureEnabled() &&
        plugin.getOrderedGroups &&
        plugin.getOrderedGroups().length > 0
    );
}

function refreshSessions(options: SessionContextActionOptions): void {
    call(options.onSessionsChanged);
}
function refreshGroups(options: SessionContextActionOptions): void {
    call(options.onGroupsChanged);
}
function refreshGroupsAndSessions(options: SessionContextActionOptions): void {
    refreshGroups(options);
    refreshSessions(options);
}

export function createSessionContextMenuOptions(options: SessionContextActionOptions) {
    const L = i18n.L;
    const opts = options || ({} as SessionContextActionOptions);
    const plugin = opts.plugin;
    const app = (opts.app || (plugin ? plugin.app : null)) as App;
    const session = opts.session;
    if (!plugin || !app || !session) return null;

    const isActive = hasOwn(opts, 'isActive') ? !!opts.isActive : session.id === plugin.data.activeSessionId;
    const getViewGroupId = typeof opts.getViewGroupId === 'function' ? opts.getViewGroupId : () => null;

    function defaultSave() {
        return callAfter(plugin.saveActiveSession(), () => refreshSessions(opts));
    }
    function defaultReload() {
        return plugin.reloadCurrentSessionWithoutSaving();
    }
    function defaultSaveAs() {
        return callAfter(plugin.saveAsSession(), () => refreshSessions(opts));
    }
    function defaultOverwriteWithCurrentLayout() {
        return plugin.confirmOverwriteSessionWithCurrentLayout(session.id, {
            onSaved: () => refreshSessions(opts),
        });
    }
    function defaultRename() {
        return sessionListActions.renameSessionWithPrompt({
            app,
            plugin,
            session,
            onRenamed: () => refreshSessions(opts),
        });
    }
    function defaultDuplicate() {
        return callAfter(plugin.duplicateSession(session.id), () => refreshSessions(opts));
    }
    function defaultRemoveFromGroup() {
        const groupId = getViewGroupId();
        if (!groupId) return;
        const groupName = getGroupName(plugin, groupId);
        return plugin.removeSessionFromGroup(session.id, groupId).then(() => {
            new Notice(L.groupRemovedSession(session.name, groupName));
            refreshGroupsAndSessions(opts);
        });
    }
    function defaultMoveToGroup(groupId: string) {
        const groupName = getGroupName(plugin, groupId);
        return plugin.moveSessionToGroupExclusive(session.id, groupId).then((moved) => {
            if (!moved) return false;
            new Notice(L.groupAddedSession(session.name, groupName));
            refreshGroupsAndSessions(opts);
            return true;
        });
    }
    function defaultDelete() {
        const confirmMessage = hasOwn(opts, 'deleteConfirmMessage')
            ? opts.deleteConfirmMessage
            : isActive
              ? L.confirmDeleteActive(session.name)
              : L.confirmDelete(session.name);
        return sessionListActions.deleteSessionWithPrompt({
            app,
            plugin,
            session,
            isActive,
            confirmMessage,
            forceConfirm: !!opts.forceDeleteConfirm,
            notifyDeleted: opts.notifyDeleted,
            confirmOptions: opts.deleteConfirmOptions as ConfirmModalOptions | undefined,
            onDeleted: () => refreshSessions(opts),
        });
    }
    function defaultVersionHistory() {
        return new HistoryModal(app, plugin, session).open();
    }
    function defaultCustomizeClicks() {
        return new CustomizeClicksModal(app, plugin).open();
    }

    return {
        plugin,
        app,
        session,
        isActive,
        event: opts.event,
        showSaveAs: !!opts.showSaveAs,
        showSwitch: !!opts.showSwitch,
        showRemoveFromGroup: optionOrDefault(opts, 'showRemoveFromGroup', !!getViewGroupId()),
        showMoveToGroup: optionOrDefault(opts, 'showMoveToGroup', shouldShowMoveToGroup(plugin)),
        showCustomizeClicks: !!opts.showCustomizeClicks,
        onCustomizeClicks: opts.onCustomizeClicks || defaultCustomizeClicks,
        onSave: opts.onSave || defaultSave,
        onReload: opts.onReload || defaultReload,
        onSaveAs: opts.onSaveAs || defaultSaveAs,
        onOverwriteWithCurrentLayout: opts.onOverwriteWithCurrentLayout || defaultOverwriteWithCurrentLayout,
        onSwitch: opts.onSwitch,
        onRename: opts.onRename || defaultRename,
        onDuplicate: opts.onDuplicate || defaultDuplicate,
        onDelete: opts.onDelete || defaultDelete,
        onRemoveFromGroup: opts.onRemoveFromGroup || defaultRemoveFromGroup,
        onMoveToGroup: opts.onMoveToGroup || defaultMoveToGroup,
        onVersionHistory: opts.onVersionHistory || defaultVersionHistory,
    };
}

export function openSessionContextMenu(options: SessionContextActionOptions): void {
    const menuOptions = createSessionContextMenuOptions(options);
    if (!menuOptions) return;
    sessionContextMenu.openSessionContextMenu(menuOptions);
}
