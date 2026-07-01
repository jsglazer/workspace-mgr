import { App, Menu, Modal, setIcon } from 'obsidian';
import * as i18n from '../i18n';
import { openSessionContextMenu } from '../session-context-actions';
import { renameSessionWithPrompt, deleteSessionWithPrompt } from '../session-list-actions';
import RenameModal from './rename-modal';
import ConfirmModal from './confirm-modal';
import formatRelativeTime from './format-relative-time';
import type { Group, Session } from '../core/types';

interface ManagerPlugin {
    app: App;
    data: { activeSessionId?: string | null; showFilterInput?: boolean };
    getOrderedSessions(): Session[];
    getOrderedSessionsForGroup(groupId: string | null): Session[];
    getOrderedGroups(): Group[];
    isGroupFeatureEnabled(): boolean;
    createGroupValidated(name: string): Promise<string | false>;
    renameGroupValidated(groupId: string, newName: string): Promise<boolean>;
    deleteGroup(groupId: string): Promise<boolean>;
    switchSession(sessionId: string): Promise<boolean>;
    createSessionValidated(name: string): Promise<{ created: boolean }>;
    updateStatusBar(): void;
}

/**
 * Session manager overlay: group tabs (view-only filter), filter, create,
 * switch, inline rename/delete, and keyboard navigation. A compact functional
 * equivalent of the reference plugin's large modals/session-manager-modal.js
 * (visual/manual-QA surface; class prefix wpp- -> wsmgr-). Core session logic
 * is delegated to the plugin/services.
 */
export default class SessionManagerModal extends Modal {
    private plugin: ManagerPlugin;
    private filter = '';
    private selectedGroupId: string | null = null;
    private selectedIndex = 0;
    private sessions: Session[] = [];
    private listEl: HTMLElement | null = null;
    private groupsEl: HTMLElement | null = null;
    private counterEl: HTMLElement | null = null;
    private navKeyHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(app: App, plugin: ManagerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const L = i18n.L;
        const contentEl = this.contentEl;
        contentEl.addClass('wsmgr-manager');
        this.titleEl.setText(L.modalTitle);

        this.counterEl = contentEl.createDiv({ cls: 'wsmgr-manager-counter' });

        const createRow = contentEl.createDiv({ cls: 'wsmgr-manager-create' });
        const nameInput = createRow.createEl('input', {
            type: 'text',
            placeholder: L.savePlaceholder,
            cls: 'wsmgr-manager-name',
        });
        const createBtn = createRow.createEl('button', { text: L.save, cls: 'mod-cta' });
        const doCreate = (): void => {
            void this.plugin.createSessionValidated(nameInput.value).then((res) => {
                if (res.created) {
                    nameInput.value = '';
                    this.renderList();
                }
            });
        };
        createBtn.addEventListener('click', doCreate);
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doCreate();
            }
        });

        if (this.plugin.isGroupFeatureEnabled()) {
            this.groupsEl = contentEl.createDiv({ cls: 'wsmgr-manager-groups' });
            this.renderGroupTabs();
        }

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
        contentEl.createDiv({ cls: 'wsmgr-modal-footer', text: L.managerKeyboardHint });
        this.renderList();

        this.navKeyHandler = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
            if (this.sessions.length === 0) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.selectedIndex = Math.min(this.selectedIndex + 1, this.sessions.length - 1);
                this.updateSelectionHighlight();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
                this.updateSelectionHighlight();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const session = this.sessions[this.selectedIndex];
                if (session) void this.plugin.switchSession(session.id).then((ok) => ok && this.close());
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                const session = this.sessions[this.selectedIndex];
                if (session) this.deleteSession(session);
            }
        };
        document.addEventListener('keydown', this.navKeyHandler, true);
    }

    private renderGroupTabs(): void {
        if (!this.groupsEl) return;
        const L = i18n.L;
        this.groupsEl.empty();

        const allTab = this.groupsEl.createEl('button', { text: L.groupAll, cls: 'wsmgr-manager-group-tab' });
        if (!this.selectedGroupId) allTab.addClass('is-selected');
        allTab.addEventListener('click', () => {
            this.selectedGroupId = null;
            this.renderGroupTabs();
            this.renderList();
        });

        for (const group of this.plugin.getOrderedGroups()) {
            const tab = this.groupsEl.createEl('button', { text: group.name, cls: 'wsmgr-manager-group-tab' });
            if (this.selectedGroupId === group.id) tab.addClass('is-selected');
            tab.addEventListener('click', () => {
                this.selectedGroupId = group.id;
                this.renderGroupTabs();
                this.renderList();
            });
            tab.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                const menu = new Menu();
                menu.addItem((m) =>
                    m.setTitle(L.groupContextRename).setIcon('pencil').onClick(() => {
                        new RenameModal(
                            this.plugin.app,
                            group.name,
                            (newName) => {
                                void this.plugin.renameGroupValidated(group.id, newName).then(() => this.renderGroupTabs());
                            },
                            { title: L.groupContextRename, placeholder: L.groupCreatePlaceholder, buttonText: L.save, emptyNotice: L.groupEmptyName },
                        ).open();
                    }),
                );
                menu.addItem((m) =>
                    m.setTitle(L.groupContextDelete).setIcon('trash').onClick(() => {
                        new ConfirmModal(this.plugin.app, L.confirmDeleteGroup(group.name), () => {
                            void this.plugin.deleteGroup(group.id).then(() => {
                                if (this.selectedGroupId === group.id) this.selectedGroupId = null;
                                this.renderGroupTabs();
                                this.renderList();
                            });
                        }).open();
                    }),
                );
                menu.showAtMouseEvent(event);
            });
        }

        const addTab = this.groupsEl.createEl('button', { text: '+', cls: 'wsmgr-manager-group-add' });
        addTab.setAttribute('aria-label', L.groupCreateNew);
        addTab.addEventListener('click', () => {
            new RenameModal(
                this.plugin.app,
                '',
                (name) => {
                    void this.plugin.createGroupValidated(name).then((groupId) => {
                        if (!groupId) return;
                        this.selectedGroupId = groupId;
                        this.renderGroupTabs();
                        this.renderList();
                    });
                },
                { title: L.groupCreateNew, placeholder: L.groupCreatePlaceholder, buttonText: L.save, emptyNotice: L.groupEmptyName },
            ).open();
        });
    }

    private deleteSession(session: Session): void {
        deleteSessionWithPrompt({
            app: this.plugin.app,
            plugin: this.plugin as never,
            session,
            isActive: session.id === this.plugin.data.activeSessionId,
            onDeleted: () => {
                this.plugin.updateStatusBar();
                this.renderList();
            },
        });
    }

    private renderList(): void {
        if (!this.listEl) return;
        const L = i18n.L;
        this.listEl.empty();
        const base = this.plugin.getOrderedSessionsForGroup(this.selectedGroupId);
        this.sessions = base.filter((s) => !this.filter || s.name.toLowerCase().includes(this.filter));

        const activeIdx = this.sessions.findIndex((s) => s.id === this.plugin.data.activeSessionId);
        this.selectedIndex = activeIdx !== -1 ? activeIdx : 0;

        for (const session of this.sessions) {
            const row = this.listEl.createDiv({ cls: 'wsmgr-manager-item' });
            if (session.id === this.plugin.data.activeSessionId) row.addClass('is-active');

            const info = row.createDiv({ cls: 'wsmgr-manager-item-info' });
            info.createSpan({ cls: 'wsmgr-manager-item-name', text: session.name });
            if (typeof session.modified === 'number') {
                info.createSpan({ cls: 'wsmgr-manager-item-time', text: formatRelativeTime(session.modified) });
            }

            const actions = row.createDiv({ cls: 'wsmgr-manager-item-actions' });
            if (session.id === this.plugin.data.activeSessionId) {
                actions.createSpan({ cls: 'wsmgr-manager-item-badge', text: L.active });
            }
            const renameBtn = actions.createEl('button', { cls: 'wsmgr-manager-item-icon clickable-icon' });
            setIcon(renameBtn, 'pencil');
            renameBtn.setAttribute('aria-label', L.contextRenameSession);
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                renameSessionWithPrompt({
                    app: this.plugin.app,
                    plugin: this.plugin as never,
                    session,
                    onRenamed: () => this.renderList(),
                });
            });
            const deleteBtn = actions.createEl('button', { cls: 'wsmgr-manager-item-icon clickable-icon' });
            setIcon(deleteBtn, 'trash');
            deleteBtn.setAttribute('aria-label', L.contextDeleteSession);
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteSession(session);
            });

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

        if (this.sessions.length === 0) this.listEl.createEl('p', { text: L.noSession });
        this.updateSelectionHighlight();
    }

    private updateSelectionHighlight(): void {
        if (!this.listEl || !this.counterEl) return;
        const L = i18n.L;
        const rows = this.listEl.children;
        for (let i = 0; i < rows.length; i++) {
            rows[i].classList.toggle('is-selected', i === this.selectedIndex);
        }
        this.counterEl.setText(this.sessions.length === 0 ? '0 / 0' : L.managerCounter(this.selectedIndex + 1, this.sessions.length));
    }

    onClose(): void {
        if (this.navKeyHandler) {
            document.removeEventListener('keydown', this.navKeyHandler, true);
            this.navKeyHandler = null;
        }
        this.contentEl.empty();
    }
}
