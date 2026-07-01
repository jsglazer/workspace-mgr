// Plugin shell for workspace-mgr. This is the only layer that touches Obsidian
// directly: it composes the pure core services (SessionService, PersistenceService,
// FrontmatterController), the LayoutAdapter (isolating workspace layout internals),
// the status bar, commands, and the settings tab, then wires the core's collaborator
// seams to real Obsidian behavior. No prototype patching — strict composition.
import { Notice, Platform, Plugin } from 'obsidian';
import * as i18n from './i18n';
import { SessionService } from './core/session-service';
import { PersistenceService } from './core/persistence-service';
import { FrontmatterController } from './frontmatter';
import { DEFAULT_DATA } from './core/default-data';
import { statusNameColorValue, STATUS_NAME_COLOR_VAR, unsavedHighlightColorValue, UNSAVED_COLOR_VAR } from './core/css';
import { createLayoutAdapter, type LayoutAdapter } from './adapter/layout-adapter';
import { renderStatusBar } from './session-statusbar';
import { setupStatusBar } from './statusbar-controller';
import { WorkspaceMgrSettingTab, type SettingsHost } from './settings-tab';
import { RenameModal, UnsavedSwitchModal, ConfirmModal, SessionManagerModal } from './modals';
import { renameSessionWithPrompt, deleteSessionWithPrompt } from './session-list-actions';
import type { Group, Session, SessionData } from './core/types';

export default class WorkspaceMgrPlugin extends Plugin implements SettingsHost {
    data!: SessionData;
    session!: SessionService;
    persistence!: PersistenceService;
    frontmatterCtl!: FrontmatterController;
    layoutAdapter!: LayoutAdapter;
    statusBarEl?: HTMLElement;

    // Status-bar scroll state (consumed by statusbar-controller).
    statusBarScrollDelta = 0;
    statusBarScrollEventAt = 0;
    statusBarScrollSwitchAt = 0;

    get isSwitchingSession(): boolean {
        return this.session.isSwitchingSession;
    }

    async onload(): Promise<void> {
        this.layoutAdapter = createLayoutAdapter(this.app);
        this.session = new SessionService();
        this.persistence = new PersistenceService();
        this.frontmatterCtl = new FrontmatterController();

        this.persistence.app = this.app as never;
        this.persistence.manifest = { id: this.manifest.id, dir: this.manifest.dir || '' };
        this.persistence.platform = Platform;

        // Load: settings from Obsidian data.json, sessions from the multi-file store.
        const savedSettings = ((await this.loadData()) || {}) as Partial<SessionData>;
        const loadedSessions = (await this.persistence.loadSessionDataFromStorage()) || {};
        this.data = Object.assign({}, DEFAULT_DATA, loadedSessions, this.persistence.extractSettingsData(savedSettings)) as SessionData;

        this.session.app = this.app as never;
        this.session.data = this.data;
        this.persistence.data = this.data;
        this.frontmatterCtl.app = this.app as never;
        this.frontmatterCtl.data = this.data;

        this.wireServices();
        i18n.resolveLocale((this.data.language as string) || 'auto');

        setupStatusBar(this as never);
        this.applyStatusNameColor();
        this.applyUnsavedHighlightColor();
        this.registerEvent(
            this.app.workspace.on('css-change', () => {
                this.applyStatusNameColor();
                this.applyUnsavedHighlightColor();
            }),
        );

        this.session.syncSessionCommands();
        this.registerCommands();
        this.frontmatterCtl.registerFrontmatterListeners();

        this.addSettingTab(new WorkspaceMgrSettingTab(this.app, this));

        this.session.startStartupSettleWindow();
        this.app.workspace.onLayoutReady(() => {
            this.session.ensureDefaultSession();
            void this.session.scheduleStartupFlush();
            if (this.session.isVersionHistoryEnabled()) this.session.startHistorySnapshotTimer();
        });
    }

    onunload(): void {
        this.session.stopHistorySnapshotTimer();
        this.persistence.clearSessionStorageSyncTimers();
        this.session.clearSessionSwitchNotice();
    }

    // ------------------------------------------------------------------
    // Wiring: route core collaborator seams to Obsidian behavior
    // ------------------------------------------------------------------
    private wireServices(): void {
        const s = this.session;
        const p = this.persistence;

        // SessionService -> persistence / shell
        s.persistData = () => p.persistData();
        s.updateStatusBar = () => this.updateStatusBar();
        s.addCommand = (cmd) => this.addCommand(cmd as never);
        s.removeCommand = (id) => (this as unknown as { removeCommand(id: string): void }).removeCommand(id);
        s.notify = (m) => {
            new Notice(m);
        };
        // Confine layout internals to the adapter.
        s.getCurrentWorkspaceLayout = () => this.layoutAdapter.getLayout();
        s.changeWorkspaceLayout = (layout) => this.layoutAdapter.changeLayout(layout as never);
        s.hasBlockingSwitchUi = () => !!document.querySelector('.wsmgr-confirm-buttons');
        s.promptSessionName = (opts) => {
            new RenameModal(this.app, '', opts.onSubmit, {
                title: opts.title,
                placeholder: opts.placeholder,
                buttonText: opts.buttonText,
                skipButtonText: opts.skipButtonText,
                emptyNotice: opts.emptyNotice,
                onSkip: opts.onSkip,
            }).open();
        };
        s.openUnsavedSwitchModal = (message, onSave, onDiscard, onCancel) => {
            new UnsavedSwitchModal(this.app, message, onSave, onDiscard, onCancel).open();
        };

        // PersistenceService -> SessionService / shell
        p.syncSessionOrder = () => s.syncSessionOrder();
        p.normalizeGroupFeatureState = () => s.normalizeGroupFeatureState();
        p.updateStatusBar = () => this.updateStatusBar();
        p.syncSessionCommands = () => s.syncSessionCommands();
        p.normalizeGroupTabOrder = (order) => s.normalizeGroupTabOrder(order);
        p.clearVersionHistoryEntries = () => s.clearVersionHistoryEntries();
        p.resetSessionsToDefault = () => s.resetSessionsToDefault();
        p.notify = (m) => {
            new Notice(m);
        };
        p.saveSettings = () => this.saveData(this.persistence.extractSettingsData(this.data));
    }

    // ------------------------------------------------------------------
    // Status bar
    // ------------------------------------------------------------------
    updateStatusBar(): void {
        renderStatusBar({
            statusBarEl: this.statusBarEl as never,
            getActiveSession: () => this.session.getActiveSession(),
            getActiveGroup: () => this.session.getActiveGroup(),
            shouldShowUnsavedStatusBarHighlight: () => this.session.shouldShowUnsavedStatusBarHighlight(),
        });
    }

    private isDarkTheme(): boolean {
        return document.body.classList.contains('theme-dark');
    }

    applyStatusNameColor(): void {
        const value = statusNameColorValue(
            this.data.statusBarNameColorLight as string,
            this.data.statusBarNameColorDark as string,
            this.isDarkTheme(),
        );
        document.documentElement.style.setProperty(STATUS_NAME_COLOR_VAR, value);
    }

    applyUnsavedHighlightColor(): void {
        const value = unsavedHighlightColorValue(
            this.data.unsavedHighlightColorLight as string,
            this.data.unsavedHighlightColorDark as string,
            this.isDarkTheme(),
        );
        document.documentElement.style.setProperty(UNSAVED_COLOR_VAR, value);
    }

    // ------------------------------------------------------------------
    // Commands
    // ------------------------------------------------------------------
    private registerCommands(): void {
        const L = i18n.L;
        this.addCommand({ id: 'next-session', name: L.cmdNext, callback: () => void this.session.switchRelative(1) });
        this.addCommand({ id: 'previous-session', name: L.cmdPrevious, callback: () => void this.session.switchRelative(-1) });
        this.addCommand({ id: 'save-session', name: L.cmdSaveCurrent, callback: () => void this.session.saveActiveSession() });
        this.addCommand({ id: 'save-as', name: L.cmdSaveAs, callback: () => void this.saveAsSession() });
        this.addCommand({ id: 'new-empty-session', name: L.cmdNewEmpty, callback: () => void this.session.createEmptySession() });
        this.addCommand({ id: 'open-session-manager', name: L.modalTitle, callback: () => new SessionManagerModal(this.app, this as never).open() });
        this.addCommand({
            id: 'save-note-name-as-session',
            name: L.cmdSaveCurrentNoteNameAsSession,
            callback: () => void this.saveCurrentNoteNameAsSession(),
        });
        this.addCommand({ id: 'reload-session', name: L.cmdReloadCurrentWithoutSaving, callback: () => void this.session.reloadCurrentSessionWithoutSaving() });
        this.addCommand({ id: 'quick-restore-history', name: L.historyRestore, callback: () => void this.session.quickRestoreLatestHistory() });
        this.addCommand({ id: 'toggle-auto-save', name: L.cmdToggleAutoSave, callback: () => void this.session.toggleAutoSaveOnSwitch({ notify: true }) });
    }

    // ------------------------------------------------------------------
    // UI-orchestration methods used by the status bar / menus / modals
    // (delegate the data logic to the services).
    // ------------------------------------------------------------------
    getActiveSession(): Session | null {
        return this.session.getActiveSession();
    }
    getActiveGroup(): Group | null {
        return this.session.getActiveGroup();
    }
    getOrderedSessions(): Session[] {
        return this.session.getOrderedSessions();
    }
    getOrderedGroups(): Group[] {
        return this.session.getOrderedGroups();
    }
    isGroupFeatureEnabled(): boolean {
        return this.session.isGroupFeatureEnabled();
    }
    shouldShowUnsavedStatusBarHighlight(): boolean {
        return this.session.shouldShowUnsavedStatusBarHighlight();
    }
    isVersionHistoryEnabled(): boolean {
        return this.session.isVersionHistoryEnabled();
    }
    isVersionHistoryConfirmRestoreEnabled(): boolean {
        return this.session.isVersionHistoryConfirmRestoreEnabled();
    }
    isAutoSaveOnSwitchEnabled(): boolean {
        return this.session.isAutoSaveOnSwitchEnabled();
    }
    saveActiveSession(): Promise<boolean> {
        return this.session.saveActiveSession();
    }
    reloadCurrentSessionWithoutSaving(): Promise<boolean> {
        return this.session.reloadCurrentSessionWithoutSaving();
    }
    duplicateCurrentSession(): Promise<unknown> {
        return this.session.duplicateCurrentSession();
    }
    duplicateSession(sessionId: string): Promise<unknown> {
        return this.session.duplicateSession(sessionId);
    }
    createEmptySession(): Promise<unknown> {
        return this.session.createEmptySession();
    }
    toggleAutoSaveOnSwitch(options?: { notify?: boolean }): Promise<boolean> {
        return this.session.toggleAutoSaveOnSwitch(options);
    }
    setVersionHistoryEnabled(enabled: boolean): Promise<unknown> {
        return this.session.setVersionHistoryEnabled(enabled);
    }
    switchRelativeFromStatusBar(offset: number): Promise<boolean> {
        return this.session.switchRelativeFromStatusBar(offset);
    }
    switchRelativeFromScroll(offset: number): Promise<boolean> {
        return this.session.switchRelativeFromScroll(offset);
    }
    switchSession(sessionId: string): Promise<boolean> {
        return this.session.switchSession(sessionId);
    }
    createSessionValidated(name: string): Promise<{ created: boolean }> {
        return this.session.createSessionValidated(name);
    }
    removeSessionFromGroup(sessionId: string, groupId: string): Promise<boolean> {
        return this.session.removeSessionFromGroup(sessionId, groupId);
    }
    moveSessionToGroupExclusive(sessionId: string, groupId: string): Promise<boolean> {
        return this.session.moveSessionToGroupExclusive(sessionId, groupId);
    }
    renameSessionById(sessionId: string, newName: string): Promise<boolean> {
        return this.session.renameSessionById(sessionId, newName);
    }
    deleteSession(sessionId: string): Promise<boolean> {
        return this.session.deleteSession(sessionId);
    }
    restoreFromHistoryEntry(sessionId: string, entryIndex: number): Promise<boolean> {
        return this.session.restoreFromHistoryEntry(sessionId, entryIndex);
    }
    countPanesInLayout(layout: unknown): number {
        return this.session.countPanesInLayout(layout);
    }
    quickRestoreLatestHistory(): Promise<boolean> {
        return this.session.quickRestoreLatestHistory();
    }

    saveCurrentNoteNameAsSession(): Promise<unknown> {
        return this.frontmatterCtl.saveCurrentNoteNameAsSession();
    }

    /** Rename the active session via a prompt modal. */
    renameCurrentSession(): void {
        const session = this.session.getActiveSession();
        if (!session) {
            new Notice(i18n.L.noSession);
            return;
        }
        renameSessionWithPrompt({ app: this.app, plugin: this as never, session });
    }

    /** Save the current layout under a new name via a prompt modal. */
    saveAsSession(): Promise<boolean> {
        return new Promise((resolve) => {
            new RenameModal(
                this.app,
                '',
                (name) => {
                    void this.session.saveCurrentLayoutAsSessionName(name).then((r) => resolve(!!r.saved));
                },
                {
                    title: i18n.L.nameSessionTitle,
                    placeholder: i18n.L.nameSessionPlaceholder,
                    buttonText: i18n.L.saveInline,
                    emptyNotice: i18n.L.emptyName,
                },
            ).open();
        });
    }

    /** Confirm overwriting a session with the current layout. */
    confirmOverwriteSessionWithCurrentLayout(sessionId: string, options?: { onSaved?: (s: Session) => void }): boolean {
        const session = this.data.sessions[sessionId];
        if (!session) return false;
        new ConfirmModal(
            this.app,
            i18n.L.confirmOverwriteSessionWithCurrentLayout(session.name),
            () => {
                void this.session.overwriteSessionWithCurrentLayout(sessionId).then((saved) => {
                    if (saved && options && options.onSaved) options.onSaved(session);
                });
            },
            { confirmText: i18n.L.saveInline, confirmClass: 'mod-cta' },
        ).open();
        return true;
    }

    /** Delete the active session via a prompt modal. */
    deleteCurrentSession(): void {
        const session = this.session.getActiveSession();
        if (!session) {
            new Notice(i18n.L.noSession);
            return;
        }
        void deleteSessionWithPrompt({ app: this.app, plugin: this as never, session, isActive: true, forceConfirm: true });
    }
}
