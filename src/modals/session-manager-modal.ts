import { App, Modal, Notice, setIcon } from 'obsidian';
import * as i18n from '../i18n';
import { openSessionContextMenu } from '../session-context-actions';
import { renameSessionWithPrompt, deleteSessionWithPrompt } from '../session-list-actions';
import RenameModal from './rename-modal';
import ConfirmModal from './confirm-modal';
import formatRelativeTime from './format-relative-time';
import type { Group, Session } from '../core/types';

interface ManagerPlugin {
    app: App;
    data: { activeSessionId?: string | null; showFilterInput?: boolean; sessionGroups?: Record<string, string[]> };
    getOrderedSessions(): Session[];
    getOrderedSessionsForGroup(groupId: string | null): Session[];
    getOrderedGroups(): Group[];
    isGroupFeatureEnabled(): boolean;
    createGroupValidated(name: string): Promise<string | false>;
    renameGroupValidated(groupId: string, newName: string): Promise<boolean>;
    deleteGroup(groupId: string): Promise<boolean>;
    duplicateGroup(groupId: string): Promise<string | false>;
    switchSession(sessionId: string): Promise<boolean>;
    duplicateSession(sessionId: string): Promise<unknown>;
    createSessionValidated(name: string): Promise<{ created: boolean }>;
    addSessionToGroup(sessionId: string, groupId: string): Promise<boolean>;
    removeSessionFromGroup(sessionId: string, groupId: string): Promise<boolean>;
    updateStatusBar(): void;
}

const UNGROUPED_KEY = '__ungrouped__';

/**
 * Session manager overlay: collapsible group sections (default expanded),
 * filter, create, switch, inline rename/duplicate/delete, and keyboard
 * navigation. A compact functional equivalent of the reference plugin's large
 * modals/session-manager-modal.js (visual/manual-QA surface; class prefix
 * wpp- -> wsmgr-). Core session/group logic is delegated to the plugin/services.
 */
export default class SessionManagerModal extends Modal {
    private plugin: ManagerPlugin;
    private filter = '';
    private selectedIndex = 0;
    private sessions: Session[] = [];
    private rowEls: HTMLElement[] = [];
    private collapsed: Set<string> = new Set();
    private listEl: HTMLElement | null = null;
    private counterEl: HTMLElement | null = null;
    private navKeyHandler: ((e: KeyboardEvent) => void) | null = null;
    private openDropdownEl: HTMLElement | null = null;
    private openDropdownAnchor: HTMLElement | null = null;
    private openDropdownCleanup: (() => void) | null = null;

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
            const groupsHeaderRow = contentEl.createDiv({ cls: 'wsmgr-manager-groups-toolbar' });
            const addGroupBtn = groupsHeaderRow.createEl('button', { text: L.groupCreateNew, cls: 'wsmgr-manager-group-add' });
            addGroupBtn.addEventListener('click', () => {
                new RenameModal(
                    this.plugin.app,
                    '',
                    (name) => {
                        void this.plugin.createGroupValidated(name).then((groupId) => {
                            if (!groupId) return;
                            this.collapsed.delete(groupId);
                            this.renderList();
                        });
                    },
                    { title: L.groupCreateNew, placeholder: L.groupCreatePlaceholder, buttonText: L.save, emptyNotice: L.groupEmptyName },
                ).open();
            });
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

    private closeGroupDropdown(refresh: boolean): void {
        if (this.openDropdownCleanup) {
            this.openDropdownCleanup();
            this.openDropdownCleanup = null;
        }
        if (this.openDropdownEl) {
            this.openDropdownEl.remove();
            this.openDropdownEl = null;
        }
        this.openDropdownAnchor = null;
        if (refresh) this.renderList();
    }

    private openGroupDropdown(anchorEl: HTMLElement, session: Session, mode: 'add' | 'remove'): void {
        const L = i18n.L;
        const wasOpenForThisAnchor = this.openDropdownAnchor === anchorEl;
        if (this.openDropdownEl) this.closeGroupDropdown(false);
        if (wasOpenForThisAnchor) return;

        const sessionGroupIds = (this.plugin.data.sessionGroups || {})[session.id] || [];
        const allGroups = this.plugin.getOrderedGroups();
        const groups =
            mode === 'add'
                ? allGroups.filter((g) => sessionGroupIds.indexOf(g.id) === -1)
                : allGroups.filter((g) => sessionGroupIds.indexOf(g.id) !== -1);

        // Rendered inside the modal's own DOM (not document.body) so it stays
        // within Obsidian's Modal focus/click handling instead of behaving as an
        // unrelated outside element the modal may not interact with reliably.
        const dropdown = this.contentEl.createDiv({ cls: 'wsmgr-manager-group-dropdown' });
        dropdown.createDiv({ cls: 'wsmgr-manager-group-dropdown-header', text: L.groupDropdownHeader });
        const listEl = dropdown.createDiv({ cls: 'wsmgr-manager-group-dropdown-list' });

        if (groups.length === 0) {
            listEl.createDiv({
                cls: 'wsmgr-manager-group-dropdown-empty',
                text: mode === 'add' ? L.groupNoGroupsToJoin : L.groupNoGroupsToLeave,
            });
        }

        for (const group of groups) {
            const row = listEl.createEl('label', { cls: 'wsmgr-manager-group-dropdown-item' });
            const checkbox = row.createEl('input', { type: 'checkbox' });
            checkbox.checked = mode === 'remove';
            row.createSpan({ text: group.name });
            row.addEventListener('click', (e) => e.stopPropagation());
            checkbox.addEventListener('change', () => {
                const action =
                    mode === 'add'
                        ? this.plugin.addSessionToGroup(session.id, group.id)
                        : this.plugin.removeSessionFromGroup(session.id, group.id);
                // Close (and refresh the underlying session list) right after a
                // successful toggle rather than trying to keep this dropdown alive
                // through a re-render — reopen it to act on another group.
                void action.then((changed) => {
                    if (changed) {
                        new Notice(
                            mode === 'add'
                                ? L.groupAddedSession(session.name, group.name)
                                : L.groupRemovedSession(session.name, group.name),
                        );
                    }
                    this.closeGroupDropdown(true);
                });
            });
        }

        const rect = anchorEl.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.left = `${rect.left}px`;

        this.openDropdownEl = dropdown;
        this.openDropdownAnchor = anchorEl;

        const onDocClick = (e: MouseEvent): void => {
            if (dropdown.contains(e.target as Node)) return;
            this.closeGroupDropdown(true);
        };
        const onKeydown = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') this.closeGroupDropdown(true);
        };
        // Deferred so the click that opened the dropdown doesn't immediately close it.
        setTimeout(() => {
            document.addEventListener('click', onDocClick, true);
            document.addEventListener('keydown', onKeydown, true);
        }, 0);
        this.openDropdownCleanup = () => {
            document.removeEventListener('click', onDocClick, true);
            document.removeEventListener('keydown', onKeydown, true);
        };
    }

    private matchesFilter(session: Session): boolean {
        return !this.filter || session.name.toLowerCase().includes(this.filter);
    }

    private sortByName(sessions: Session[]): Session[] {
        return sessions.slice().sort((a, b) => a.name.localeCompare(b.name));
    }

    private getUngroupedSessions(): Session[] {
        const sessionGroups = this.plugin.data.sessionGroups || {};
        return this.plugin.getOrderedSessions().filter((s) => {
            const groups = sessionGroups[s.id];
            return !groups || groups.length === 0;
        });
    }

    private renderSessionRow(container: HTMLElement, session: Session): void {
        const L = i18n.L;
        const row = container.createDiv({ cls: 'wsmgr-manager-item' });
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
        const duplicateBtn = actions.createEl('button', { cls: 'wsmgr-manager-item-icon clickable-icon' });
        setIcon(duplicateBtn, 'copy');
        duplicateBtn.setAttribute('aria-label', L.contextDuplicateSession);
        duplicateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.plugin.duplicateSession(session.id).then(() => this.renderList());
        });
        const deleteBtn = actions.createEl('button', { cls: 'wsmgr-manager-item-icon clickable-icon' });
        setIcon(deleteBtn, 'trash');
        deleteBtn.setAttribute('aria-label', L.contextDeleteSession);
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteSession(session);
        });

        if (this.plugin.isGroupFeatureEnabled() && this.plugin.getOrderedGroups().length > 0) {
            actions.createDiv({ cls: 'wsmgr-manager-item-separator' });

            const addBtn = actions.createEl('button', { cls: 'wsmgr-manager-item-icon clickable-icon' });
            setIcon(addBtn, 'plus');
            addBtn.setAttribute('aria-label', L.groupJoinGroups);
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openGroupDropdown(addBtn, session, 'add');
            });

            const removeBtn = actions.createEl('button', { cls: 'wsmgr-manager-item-icon clickable-icon' });
            setIcon(removeBtn, 'minus');
            removeBtn.setAttribute('aria-label', L.groupLeaveGroups);
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openGroupDropdown(removeBtn, session, 'remove');
            });
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

        this.sessions.push(session);
        this.rowEls.push(row);
    }

    private renderGroupHeader(
        container: HTMLElement,
        collapseKey: string,
        name: string,
        options: { group?: Group } = {},
    ): void {
        const L = i18n.L;
        const header = container.createDiv({ cls: 'wsmgr-manager-group-header' });
        const isCollapsed = this.collapsed.has(collapseKey);

        const toggle = header.createDiv({ cls: 'wsmgr-manager-group-toggle' });
        setIcon(toggle, isCollapsed ? 'chevron-right' : 'chevron-down');
        header.createSpan({ cls: 'wsmgr-manager-group-name', text: name });

        const toggleCollapse = (): void => {
            if (this.collapsed.has(collapseKey)) this.collapsed.delete(collapseKey);
            else this.collapsed.add(collapseKey);
            this.renderList();
        };
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCollapse();
        });
        header.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.wsmgr-manager-group-actions')) return;
            toggleCollapse();
        });

        const group = options.group;
        if (group) {
            const actions = header.createDiv({ cls: 'wsmgr-manager-group-actions' });
            const renameBtn = actions.createEl('button', { cls: 'wsmgr-manager-item-icon clickable-icon' });
            setIcon(renameBtn, 'pencil');
            renameBtn.setAttribute('aria-label', L.groupContextRename);
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                new RenameModal(
                    this.plugin.app,
                    group.name,
                    (newName) => {
                        void this.plugin.renameGroupValidated(group.id, newName).then(() => this.renderList());
                    },
                    { title: L.groupContextRename, placeholder: L.groupCreatePlaceholder, buttonText: L.save, emptyNotice: L.groupEmptyName },
                ).open();
            });

            const duplicateBtn = actions.createEl('button', { cls: 'wsmgr-manager-item-icon clickable-icon' });
            setIcon(duplicateBtn, 'copy');
            duplicateBtn.setAttribute('aria-label', L.groupContextDuplicate);
            duplicateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.plugin.duplicateGroup(group.id).then((newGroupId) => {
                    if (newGroupId) this.collapsed.delete(newGroupId);
                    this.renderList();
                });
            });

            const deleteBtn = actions.createEl('button', { cls: 'wsmgr-manager-item-icon clickable-icon' });
            setIcon(deleteBtn, 'trash');
            deleteBtn.setAttribute('aria-label', L.groupContextDelete);
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                new ConfirmModal(this.plugin.app, L.confirmDeleteGroup(group.name), () => {
                    void this.plugin.deleteGroup(group.id).then(() => {
                        this.collapsed.delete(group.id);
                        this.renderList();
                    });
                }).open();
            });
        }
    }

    private renderList(): void {
        if (!this.listEl) return;
        if (this.openDropdownEl) this.closeGroupDropdown(false);
        const L = i18n.L;
        this.listEl.empty();
        this.sessions = [];
        this.rowEls = [];

        if (!this.plugin.isGroupFeatureEnabled()) {
            const sessions = this.sortByName(this.plugin.getOrderedSessions().filter((s) => this.matchesFilter(s)));
            for (const session of sessions) this.renderSessionRow(this.listEl, session);
            if (sessions.length === 0) this.listEl.createEl('p', { text: L.noSession });
        } else {
            const ungrouped = this.sortByName(this.getUngroupedSessions().filter((s) => this.matchesFilter(s)));
            if (ungrouped.length > 0) {
                const section = this.listEl.createDiv({ cls: 'wsmgr-manager-group-section' });
                this.renderGroupHeader(section, UNGROUPED_KEY, L.ribbonUngrouped);
                if (!this.collapsed.has(UNGROUPED_KEY)) {
                    const body = section.createDiv({ cls: 'wsmgr-manager-group-body' });
                    for (const session of ungrouped) this.renderSessionRow(body, session);
                }
            }

            for (const group of this.plugin.getOrderedGroups()) {
                const section = this.listEl.createDiv({ cls: 'wsmgr-manager-group-section' });
                this.renderGroupHeader(section, group.id, group.name, { group });
                if (!this.collapsed.has(group.id)) {
                    const body = section.createDiv({ cls: 'wsmgr-manager-group-body' });
                    const groupSessions = this.sortByName(
                        this.plugin.getOrderedSessionsForGroup(group.id).filter((s) => this.matchesFilter(s)),
                    );
                    if (groupSessions.length === 0) {
                        body.createEl('p', { cls: 'wsmgr-manager-group-empty', text: L.noGroupSessions });
                    } else {
                        for (const session of groupSessions) this.renderSessionRow(body, session);
                    }
                }
            }

            if (this.sessions.length === 0 && ungrouped.length === 0 && this.plugin.getOrderedGroups().length === 0) {
                this.listEl.createEl('p', { text: L.noSession });
            }
        }

        const activeIdx = this.sessions.findIndex((s) => s.id === this.plugin.data.activeSessionId);
        this.selectedIndex = activeIdx !== -1 ? activeIdx : 0;
        this.updateSelectionHighlight();
    }

    private updateSelectionHighlight(): void {
        if (!this.counterEl) return;
        const L = i18n.L;
        for (let i = 0; i < this.rowEls.length; i++) {
            this.rowEls[i].classList.toggle('is-selected', i === this.selectedIndex);
        }
        this.counterEl.setText(this.sessions.length === 0 ? '0 / 0' : L.managerCounter(this.selectedIndex + 1, this.sessions.length));
    }

    onClose(): void {
        if (this.navKeyHandler) {
            document.removeEventListener('keydown', this.navKeyHandler, true);
            this.navKeyHandler = null;
        }
        this.closeGroupDropdown(false);
        this.contentEl.empty();
    }
}
