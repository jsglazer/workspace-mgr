// The one workspace menu, shared by the ribbon icon and the status bar so both
// look and behave identically: the grouped session list (click to switch) on
// top, then every action on the active session, then customization and the
// manager. Also provides the grouped session list on its own, which the
// "Save current layout to session..." picker reuses so it is arranged the same.
import { App, Menu } from 'obsidian';
import * as i18n from './i18n';
import { createSessionContextMenuOptions } from './session-context-actions';
import { SessionManagerModal } from './modals';
import type { Group, Session } from './core/types';

export interface WorkspaceMenuPlugin {
    app: App;
    data: { activeSessionId?: string | null; sessionGroups?: Record<string, string[]> };
    getActiveSession(): Session | null;
    getOrderedSessions(): Session[];
    getOrderedGroups(): Group[];
    getOrderedSessionsForGroup(groupId: string | null): Session[];
    isGroupFeatureEnabled(): boolean;
    switchSession(sessionId: string): Promise<boolean>;
    openSaveCurrentLayoutMenu(event?: unknown): void;
    updateStatusBar(): void;
}

export interface SessionListOptions {
    /** Session id to leave out of the list (e.g. the active one). */
    excludeId?: string | null;
    /** Tick the active session. */
    checkActive?: boolean;
    icon?: string;
    onPick: (session: Session, evt: MouseEvent | KeyboardEvent) => unknown;
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/**
 * Add the sessions to `menu`, arranged as the workspace menu shows them:
 * ungrouped sessions first, then one block per group under a disabled folder
 * header, everything sorted by name. Returns how many sessions were added.
 */
export function addGroupedSessionItems(menu: Menu, plugin: WorkspaceMenuPlugin, options: SessionListOptions): number {
    const activeId = plugin.data.activeSessionId;
    const keep = (s: Session): boolean => s.id !== options.excludeId;
    let added = 0;
    const addSession = (session: Session): void => {
        menu.addItem((item) => {
            item.setTitle(session.name).onClick((evt) => void options.onPick(session, evt));
            if (options.checkActive) item.setChecked(session.id === activeId);
            if (options.icon) item.setIcon(options.icon);
        });
        added++;
    };

    const allSessions = plugin.getOrderedSessions().filter(keep);
    if (!plugin.isGroupFeatureEnabled()) {
        for (const session of allSessions.slice().sort(byName)) addSession(session);
        return added;
    }

    const sessionGroups = plugin.data.sessionGroups || {};
    const ungrouped = allSessions.filter((s) => !sessionGroups[s.id] || sessionGroups[s.id].length === 0).sort(byName);
    for (const session of ungrouped) addSession(session);

    let wroteBlock = ungrouped.length > 0;
    for (const group of plugin.getOrderedGroups().slice().sort(byName)) {
        const groupSessions = plugin.getOrderedSessionsForGroup(group.id).filter(keep).sort(byName);
        if (groupSessions.length === 0) continue;
        if (wroteBlock) menu.addSeparator();
        menu.addItem((item) => item.setTitle(group.name).setIcon('folder').setDisabled(true));
        for (const session of groupSessions) addSession(session);
        wroteBlock = true;
    }
    return added;
}

function showMenu(menu: Menu, event?: unknown): void {
    const evt = event as MouseEvent | undefined;
    if (evt && typeof evt.clientX === 'number') menu.showAtMouseEvent(evt);
    else menu.showAtPosition({ x: 0, y: 0 });
}

/** A small follow-up menu listing the groups; picking one moves the session there exclusively. */
function openMoveToGroupMenu(groups: Group[], onMove: (groupId: string) => unknown, event?: unknown): void {
    const menu = new Menu();
    for (const group of groups) {
        menu.addItem((item) =>
            item
                .setTitle(group.name)
                .setIcon('folder')
                .onClick(() => void onMove(group.id)),
        );
    }
    showMenu(menu, event);
}

export function buildWorkspaceMenu(plugin: WorkspaceMenuPlugin): Menu {
    const L = i18n.L;
    const menu = new Menu();

    const count = addGroupedSessionItems(menu, plugin, {
        checkActive: true,
        onPick: (session) => plugin.switchSession(session.id),
    });
    if (count === 0) menu.addItem((item) => item.setTitle(L.ribbonWorkspacesEmpty).setDisabled(true));

    const active = plugin.getActiveSession();
    const actions = active
        ? createSessionContextMenuOptions({
              plugin: plugin as never,
              app: plugin.app,
              session: active,
              isActive: true,
              forceDeleteConfirm: true,
              notifyDeleted: false,
              onSessionsChanged: () => plugin.updateStatusBar(),
          })
        : null;
    const add = (title: string, icon: string, onClick: (evt: MouseEvent | KeyboardEvent) => unknown): void => {
        menu.addItem((item) =>
            item
                .setTitle(title)
                .setIcon(icon)
                .onClick((evt) => void onClick(evt)),
        );
    };

    if (actions) {
        menu.addSeparator();
        add(L.statusBarActionSaveSession, 'save', () => actions.onSave());
        add(L.cmdSaveCurrentLayoutToSession, 'save-all', (evt) => plugin.openSaveCurrentLayoutMenu(evt));
        add(L.cmdSaveAs, 'copy-plus', () => actions.onSaveAs());
        add(L.statusBarActionReloadWithoutSaving, 'refresh-cw', () => actions.onReload());

        menu.addSeparator();
        add(L.contextRenameSession, 'pencil', () => actions.onRename());
        add(L.contextDuplicateSession, 'copy', () => actions.onDuplicate());
        add(L.contextVersionHistory, 'history', () => actions.onVersionHistory());
        const groups = plugin.isGroupFeatureEnabled() ? plugin.getOrderedGroups() : [];
        if (groups.length > 0) {
            add(L.groupMoveToGroup + '...', 'folder-input', (evt) =>
                openMoveToGroupMenu(groups, (groupId) => actions.onMoveToGroup(groupId), evt),
            );
        }
        add(L.contextDeleteSession, 'trash', () => actions.onDelete());
    }

    menu.addSeparator();
    if (actions) add(L.contextCustomizeClicks, 'mouse-pointer-click', () => actions.onCustomizeClicks());
    add(L.modalTitle, 'list', () => new SessionManagerModal(plugin.app, plugin as never).open());
    return menu;
}

export function openWorkspaceMenu(plugin: WorkspaceMenuPlugin, event?: unknown): void {
    showMenu(buildWorkspaceMenu(plugin), event);
}
