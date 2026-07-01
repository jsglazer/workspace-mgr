import { App, Modal } from 'obsidian';
import * as i18n from '../i18n';
import { openSessionContextMenu } from '../session-context-actions';
import formatRelativeTime from './format-relative-time';
import type { Session } from '../core/types';

interface ManagerPlugin {
    app: App;
    data: { activeSessionId?: string | null; showFilterInput?: boolean };
    getOrderedSessions(): Session[];
    switchSession(sessionId: string): Promise<boolean>;
    createSessionValidated(name: string): Promise<{ created: boolean }>;
    updateStatusBar(): void;
}

/**
 * Session manager overlay: filter, create, switch, and per-session context menu.
 * A compact functional equivalent of the reference plugin's large
 * modals/session-manager-modal.js (visual/manual-QA surface; class prefix
 * wpp- -> wsmgr-). Core session logic is delegated to the plugin/services.
 */
export default class SessionManagerModal extends Modal {
    private plugin: ManagerPlugin;
    private filter = '';
    private listEl: HTMLElement | null = null;

    constructor(app: App, plugin: ManagerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const L = i18n.L;
        const contentEl = this.contentEl;
        contentEl.addClass('wsmgr-manager');
        this.titleEl.setText(L.modalTitle);

        const createRow = contentEl.createDiv({ cls: 'wsmgr-manager-create' });
        const nameInput = createRow.createEl('input', {
            type: 'text',
            placeholder: L.savePlaceholder,
            cls: 'wsmgr-manager-name',
        });
        const createBtn = createRow.createEl('button', { text: L.save, cls: 'mod-cta' });
        createBtn.addEventListener('click', () => {
            void this.plugin.createSessionValidated(nameInput.value).then((res) => {
                if (res.created) {
                    nameInput.value = '';
                    this.renderList();
                }
            });
        });

        if (this.plugin.data.showFilterInput) {
            const filterInput = contentEl.createEl('input', {
                type: 'text',
                placeholder: L.filterPlaceholder,
                cls: 'wsmgr-manager-filter',
            });
            filterInput.addEventListener('input', () => {
                this.filter = filterInput.value.trim().toLowerCase();
                this.renderList();
            });
        }

        this.listEl = contentEl.createDiv({ cls: 'wsmgr-manager-list' });
        this.renderList();
    }

    private renderList(): void {
        if (!this.listEl) return;
        const L = i18n.L;
        this.listEl.empty();
        const sessions = this.plugin.getOrderedSessions().filter((s) => !this.filter || s.name.toLowerCase().includes(this.filter));

        for (const session of sessions) {
            const row = this.listEl.createDiv({ cls: 'wsmgr-manager-item' });
            if (session.id === this.plugin.data.activeSessionId) row.addClass('is-active');
            row.createSpan({ cls: 'wsmgr-manager-item-name', text: session.name });
            if (typeof session.modified === 'number') {
                row.createSpan({ cls: 'wsmgr-manager-item-time', text: formatRelativeTime(session.modified) });
            }
            row.addEventListener('click', () => {
                void this.plugin.switchSession(session.id).then((ok) => {
                    if (ok) this.close();
                });
            });
            row.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                openSessionContextMenu({
                    plugin: this.plugin as never,
                    session,
                    event,
                    onSessionsChanged: () => {
                        this.plugin.updateStatusBar();
                        this.renderList();
                    },
                });
            });
        }

        if (sessions.length === 0) this.listEl.createEl('p', { text: L.noSession });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
