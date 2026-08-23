// Plugin shell for workspace-mgr. This is the only layer that touches Obsidian
// directly: it composes the pure core services (SessionService, PersistenceService,
// FrontmatterController), the LayoutAdapter (isolating workspace layout internals),
// the status bar, commands, and the settings tab, then wires the core's collaborator
// seams to real Obsidian behavior. No prototype patching — strict composition.
import { Menu, Notice, Platform, Plugin } from 'obsidian';
import * as i18n from './i18n';
import { SessionService } from './core/session-service';
import { PersistenceService } from './core/persistence-service';
import { FrontmatterController } from './frontmatter';
import {
    statusNameColorValue,
    STATUS_NAME_COLOR_VAR,
    unsavedHighlightColorValue,
    UNSAVED_COLOR_VAR,
    menuBarNameColorValue,
} from './core/css';
import { createLayoutAdapter, type LayoutAdapter } from './adapter/layout-adapter';
import { createMenuBarAdapter, type MenuBarAdapter } from './adapter/menubar-adapter';
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
    menuBarAdapter: MenuBarAdapter | null = null;
    private menuBarRecheckTimers: number[] = [];
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

        // Load: data.json is the source of truth for both settings and sessions —
        // it is the only file Obsidian Sync carries out of a plugin folder. The
        // multi-file store under sessions/ supplies version history (never synced)
        // and acts as the source on a pre-1.0.15 install that has yet to migrate.
        const savedData = ((await this.loadData()) || {}) as Partial<SessionData>;
        this.data = await this.persistence.buildInitialData(savedData);

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
                // The menu-bar text is a pre-rendered image, so a light/dark
                // switch has to redraw it — unlike the DOM, it cannot re-read a
                // CSS variable on its own.
                this.updateMacMenuBar();
            }),
        );
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.session.noteStartupLayoutChange();
                this.updateStatusBar();
            }),
        );
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                if (this.isSwitchingSession) return;
                setTimeout(() => this.updateStatusBar(), 0);
            }),
        );
        // Obsidian's own main process re-applies a per-window native application menu on every
        // window focus event on macOS (unconditionally, ahead of any plugin code), which wipes out
        // our injected menu-bar item. Re-inject right after each focus so it survives.
        this.registerDomEvent(window, 'focus', () => {
            this.refreshMacMenuBar();
        });
        // Backstop for resets that follow no event of ours (Obsidian rebuilds its
        // menu from internal editor state too). Only reaches Electron when the
        // feature is on, and is a no-op once the item is already correct.
        this.registerInterval(
            window.setInterval(() => {
                if (this.data.macMenuBarEnabled) this.updateMacMenuBar();
            }, 2000),
        );

        this.session.syncSessionCommands();
        this.registerCommands();
        this.frontmatterCtl.registerFrontmatterListeners();

        this.addRibbonIcon('panels-top-left', i18n.L.ribbonTooltip, (evt) => {
            this.buildWorkspaceRibbonMenu().showAtMouseEvent(evt as MouseEvent);
        });

        this.addSettingTab(new WorkspaceMgrSettingTab(this.app, this));

        this.session.startStartupSettleWindow();
        this.app.workspace.onLayoutReady(() => {
            this.session.ensureDefaultSession();
            void this.session.scheduleStartupFlush();
            if (this.session.isVersionHistoryEnabled()) this.session.startHistorySnapshotTimer();
        });
    }

    /**
     * Obsidian calls this when data.json changes on disk while we are running —
     * which is exactly what Obsidian Sync does when the other machine pushes a
     * change. Without it the incoming copy would survive only until our next
     * save overwrote it.
     */
    async onExternalSettingsChange(): Promise<void> {
        const savedData = ((await this.loadData()) || {}) as Partial<SessionData>;
        if (!this.persistence.applyExternalDataJson(savedData)) return;
        this.applyStatusNameColor();
        this.applyUnsavedHighlightColor();
        this.updateStatusBar();
        void this.persistence.persistData();
    }

    onunload(): void {
        this.session.stopHistorySnapshotTimer();
        this.persistence.clearSessionStorageSyncTimers();
        this.session.clearSessionSwitchNotice();
        for (const timer of this.menuBarRecheckTimers) window.clearTimeout(timer);
        this.menuBarRecheckTimers = [];
        if (this.menuBarAdapter) {
            this.menuBarAdapter.destroy();
            this.menuBarAdapter = null;
        }
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
        p.saveSettings = () => this.saveData(this.persistence.buildDataJsonPayload());
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
        this.refreshMacMenuBar();
    }

    // ------------------------------------------------------------------
    // macOS menu bar (desktop-only, opt-in; see adapter/menubar-adapter.ts)
    // ------------------------------------------------------------------

    /**
     * Re-assert the menu-bar item shortly after an event, as well as right now.
     *
     * Obsidian's main process re-applies its own cached application menu — which
     * never contains our injected item — in response to internal state changes
     * (active leaf, sidebar toggles, editor mode, even heading/selection state,
     * all funnelled through its `updateMenuItems` IPC). Those resets land
     * asynchronously AFTER the workspace events we can hook, so re-injecting
     * only on the event itself loses the race and the item silently vanishes.
     * There is no event to hook for the reset, so instead re-check a moment
     * later. `setTitle()` is a no-op when the item is already present and
     * unchanged, so the extra passes are cheap.
     */
    private refreshMacMenuBar(): void {
        this.updateMacMenuBar();
        for (const timer of this.menuBarRecheckTimers) window.clearTimeout(timer);
        this.menuBarRecheckTimers = [120, 500].map((delay) =>
            window.setTimeout(() => this.updateMacMenuBar(), delay),
        );
    }

    updateMacMenuBar(): void {
        const shouldShow = !!this.data.macMenuBarEnabled && Platform.isMacOS && Platform.isDesktopApp;
        if (!shouldShow) {
            if (this.menuBarAdapter) {
                this.menuBarAdapter.destroy();
                this.menuBarAdapter = null;
            }
            return;
        }
        // macOS has ONE application menu per process and Obsidian runs every vault
        // window in that one process, so all vaults share this menu. Only the
        // focused window may claim it — otherwise background vaults would fight
        // over the title on every re-check and the name would flip between vaults.
        if (!document.hasFocus()) return;
        if (!this.menuBarAdapter) this.menuBarAdapter = createMenuBarAdapter();
        if (!this.menuBarAdapter) return;
        const session = this.session.getActiveSession();
        const vaultName = this.app.vault.getName();
        const color = menuBarNameColorValue(
            this.data.menuBarNameColorLight as string,
            this.data.menuBarNameColorDark as string,
            this.isDarkTheme(),
        );
        this.menuBarAdapter.setTitle(session ? `${vaultName} - ${session.name}` : vaultName, color);
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
    // Ribbon: Group -> Workspace quick switch menu
    // ------------------------------------------------------------------
    private buildWorkspaceRibbonMenu(): Menu {
        const L = i18n.L;
        const menu = new Menu();
        const byName = (a: Session, b: Session): number => a.name.localeCompare(b.name);
        const addSessionItem = (session: Session): void => {
            menu.addItem((item) =>
                item
                    .setTitle(session.name)
                    .setChecked(session.id === this.data.activeSessionId)
                    .onClick(() => void this.session.switchSession(session.id)),
            );
        };

        const addManageLayoutsItem = (): void => {
            menu.addSeparator();
            menu.addItem((item) =>
                item
                    .setTitle(L.modalTitle)
                    .setIcon('list')
                    .onClick(() => new SessionManagerModal(this.app, this as never).open()),
            );
        };

        const allSessions = this.session.getOrderedSessions();
        if (allSessions.length === 0) {
            menu.addItem((item) => item.setTitle(L.ribbonWorkspacesEmpty).setDisabled(true));
            addManageLayoutsItem();
            return menu;
        }

        if (!this.session.isGroupFeatureEnabled()) {
            for (const session of allSessions.slice().sort(byName)) addSessionItem(session);
            addManageLayoutsItem();
            return menu;
        }

        const sessionGroups = (this.data.sessionGroups || {}) as Record<string, string[]>;
        const ungrouped = allSessions
            .filter((s) => !sessionGroups[s.id] || sessionGroups[s.id].length === 0)
            .sort(byName);
        for (const session of ungrouped) addSessionItem(session);

        let wroteBlock = ungrouped.length > 0;
        const groups = this.session.getOrderedGroups().slice().sort((a, b) => a.name.localeCompare(b.name));
        for (const group of groups) {
            const groupSessions = this.session.getOrderedSessionsForGroup(group.id).slice().sort(byName);
            if (groupSessions.length === 0) continue;
            if (wroteBlock) menu.addSeparator();
            menu.addItem((item) => item.setTitle(group.name).setIcon('folder').setDisabled(true));
            for (const session of groupSessions) addSessionItem(session);
            wroteBlock = true;
        }
        addManageLayoutsItem();
        return menu;
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
    getOrderedSessionsForGroup(groupId: string | null): Session[] {
        return this.session.getOrderedSessionsForGroup(groupId);
    }
    isGroupFeatureEnabled(): boolean {
        return this.session.isGroupFeatureEnabled();
    }
    createGroupValidated(name: string): Promise<string | false> {
        return this.session.createGroupValidated(name);
    }
    renameGroupValidated(groupId: string, newName: string): Promise<boolean> {
        return this.session.renameGroupValidated(groupId, newName);
    }
    deleteGroup(groupId: string): Promise<boolean> {
        return this.session.deleteGroup(groupId);
    }
    duplicateGroup(groupId: string): Promise<string | false> {
        return this.session.duplicateGroup(groupId);
    }
    setStatusBarAction(slotKey: string, actionId: string): Promise<unknown> {
        return this.session.setStatusBarAction(slotKey, actionId);
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
    addSessionToGroup(sessionId: string, groupId: string): Promise<boolean> {
        return this.session.addSessionToGroup(sessionId, groupId);
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
