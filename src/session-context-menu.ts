// Renders a session context menu from the option set built by
// session-context-actions. Functionally equivalent to the reference plugin's
// session-context-menu.js (visual surface).
import { Menu } from 'obsidian';
import * as i18n from './i18n';
import type { Session } from './core/types';

interface MenuGroupsPlugin {
    getOrderedGroups?(): { id: string; name: string }[];
}

export interface SessionContextMenuOptions {
    plugin: MenuGroupsPlugin;
    session: Session;
    isActive?: boolean;
    event?: unknown;
    showSaveAs?: boolean;
    showSwitch?: boolean;
    showRemoveFromGroup?: boolean;
    showMoveToGroup?: boolean;
    showCustomizeClicks?: boolean;
    onCustomizeClicks?: () => unknown;
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
}

export function openSessionContextMenu(options: SessionContextMenuOptions): void {
    const L = i18n.L;
    const menu = new Menu();
    const item = (title: string, icon: string, onClick?: () => unknown): void => {
        if (!onClick) return;
        menu.addItem((m) => m.setTitle(title).setIcon(icon).onClick(() => void onClick()));
    };

    if (options.showSwitch && options.onSwitch) item(L.contextSwitchSession, 'arrow-right', options.onSwitch);
    item(L.contextSaveSession, 'save', options.onSave);
    item(L.contextReloadSession, 'refresh-cw', options.onReload);
    if (options.showSaveAs) item(L.cmdSaveAs, 'copy-plus', options.onSaveAs);
    item(L.contextSaveCurrentLayoutToThisSession, 'save-all', options.onOverwriteWithCurrentLayout);
    item(L.contextDuplicateSession, 'copy', options.onDuplicate);
    item(L.contextRenameSession, 'pencil', options.onRename);
    item(L.contextVersionHistory, 'history', options.onVersionHistory);

    if (options.showMoveToGroup && options.onMoveToGroup && options.plugin.getOrderedGroups) {
        menu.addSeparator();
        for (const group of options.plugin.getOrderedGroups()) {
            menu.addItem((m) =>
                m
                    .setTitle(group.name)
                    .setIcon('folder')
                    .onClick(() => void options.onMoveToGroup!(group.id)),
            );
        }
    }
    if (options.showRemoveFromGroup) item(L.groupRemoveFromGroup, 'folder-minus', options.onRemoveFromGroup);

    if (options.showCustomizeClicks) {
        menu.addSeparator();
        item(L.contextCustomizeClicks, 'mouse-pointer-click', options.onCustomizeClicks);
    }

    menu.addSeparator();
    item(L.contextDeleteSession, 'trash', options.onDelete);

    const evt = options.event as MouseEvent | undefined;
    if (evt && typeof (evt as MouseEvent).clientX === 'number') menu.showAtMouseEvent(evt);
    else menu.showAtPosition({ x: 0, y: 0 });
}
