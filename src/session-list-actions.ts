// Shared rename/delete prompt flows for session lists. Ported from the reference
// plugin's session-list-actions.js.
import { App, Notice } from 'obsidian';
import * as i18n from './i18n';
import ConfirmModal, { type ConfirmModalOptions } from './modals/confirm-modal';
import RenameModal, { type RenameModalOptions } from './modals/rename-modal';
import type { Session } from './core/types';

interface ListActionPlugin {
    app: App;
    data: { sessions?: Record<string, Session>; confirmDeleteByHotkey?: boolean };
    renameSessionById(sessionId: string, newName: string): Promise<boolean>;
    deleteSession(sessionId: string): Promise<boolean>;
}

interface RenamePromptOptions {
    app?: App;
    plugin: ListActionPlugin;
    session: Session;
    modalOptions?: RenameModalOptions;
    onRenamed?: (session: Session, newName: string) => void;
}

interface DeletePromptOptions {
    app?: App;
    plugin: ListActionPlugin;
    session: Session;
    isActive?: boolean;
    confirmMessage?: string;
    forceConfirm?: boolean;
    notifyDeleted?: boolean;
    notifyCannotDelete?: boolean;
    confirmOptions?: ConfirmModalOptions;
    onDeleted?: (session: Session) => void;
}

function resolveApp(options: { app?: App; plugin?: ListActionPlugin }): App | null {
    if (options.app) return options.app;
    if (options.plugin && options.plugin.app) return options.plugin.app;
    return null;
}

export function renameSessionWithPrompt(options: RenamePromptOptions): void {
    const L = i18n.L;
    const app = resolveApp(options);
    const plugin = options.plugin;
    const session = options.session;
    if (!app || !plugin || !session) return;

    const modalOptions: RenameModalOptions = Object.assign({ emptyNotice: L.emptyName }, options.modalOptions || {});
    new RenameModal(
        app,
        session.name,
        (newName) => {
            plugin.renameSessionById(session.id, newName).then((renamed) => {
                if (!renamed) return;
                if (typeof options.onRenamed === 'function') options.onRenamed(session, newName);
            });
        },
        modalOptions,
    ).open();
}

function getDeleteConfirmMessage(session: Session, options: DeletePromptOptions): string {
    const L = i18n.L;
    if (options && options.confirmMessage) return options.confirmMessage;
    return options && options.isActive ? L.confirmDeleteActive(session.name) : L.confirmDelete(session.name);
}

export function deleteSessionWithPrompt(options: DeletePromptOptions): Promise<boolean> {
    const L = i18n.L;
    const app = resolveApp(options);
    const plugin = options.plugin;
    const session = options.session;
    if (!app || !plugin || !session) return Promise.resolve(false);

    if (Object.keys(plugin.data.sessions || {}).length <= 1) {
        if (options.notifyCannotDelete !== false) new Notice(L.cannotDeleteLast);
        return Promise.resolve(false);
    }

    const doDelete = (): Promise<boolean> =>
        plugin.deleteSession(session.id).then((deleted) => {
            if (!deleted) return false;
            if (options.notifyDeleted !== false) new Notice(L.deleted(session.name));
            if (typeof options.onDeleted === 'function') options.onDeleted(session);
            return true;
        });

    const shouldConfirm = !!options.forceConfirm || plugin.data.confirmDeleteByHotkey !== false;
    if (shouldConfirm) {
        new ConfirmModal(app, getDeleteConfirmMessage(session, options), doDelete, options.confirmOptions || {}).open();
        return Promise.resolve(true);
    }
    return doDelete();
}
