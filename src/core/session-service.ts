// SessionService: the pure decision core for workspace-mgr. It owns all session,
// group, saving, switching, startup, command-sync, settings-state, validation and
// version-history *data* logic. It imports NO `obsidian` module (only i18n data
// and pure helpers), so the entire class is unit-testable headless.
//
// The reference plugin attached these methods to the Plugin prototype via mixins;
// here they live on one injected, typed class (strict composition). Obsidian-side
// effects (persistence, status bar, commands, notices, modals, overlays) are
// collaborator methods with inert defaults that the shell overrides and tests
// stub — mirroring the reference's `this.*` call shape for a faithful test port.
import * as i18n from '../i18n';
import { generateId } from './utils';
import * as layoutUtils from './layout-utils';
import { DEFAULT_DATA } from './default-data';
import type { AppLike, CommandLike, NamePromptOptions } from './host';
import type { Group, HistoryEntry, Layout, Session, SessionData } from './types';

const SESSION_SWITCH_NOTICE_DURATION_MS = 1200;

const STARTUP_SETTLE_MS = 1200;
const STARTUP_LAYOUT_CHANGE_SETTLE_MS = 400;
const STARTUP_SETTLE_MAX_MS = 5000;

const HOUR = 3600000;
const DAY = 86400000;
const WEEK = 7 * DAY;
const MAX_HISTORY = 45;

export interface CreateSessionOptions {
    modified?: number;
    isDefault?: boolean;
}

export interface SwitchOptions {
    silent?: boolean;
    switchNoticeMode?: 'replace' | string;
    switchNoticeDurationMs?: number;
    skipUnsavedWarning?: boolean;
    touchModified?: boolean;
    [key: string]: unknown;
}

export interface SaveResult {
    saved: boolean;
    created: boolean;
    overwritten: boolean;
    changed?: boolean;
    sessionId: string | null;
    name: string;
}

interface SwitchRequest {
    targetId: string;
    options: SwitchOptions;
    resolve: (ok: boolean) => void;
}

interface RelativeSwitchContext {
    ordered: Session[];
    currentIndex: number;
    targetIndex: number;
    isEmpty: boolean;
}

function findSessionByName(data: SessionData, name: string): Session | null {
    const sessions = (data && data.sessions) || {};
    for (const key of Object.keys(sessions)) {
        if (sessions[key] && sessions[key].name === name) return sessions[key];
    }
    return null;
}

export class SessionService {
    data!: SessionData;
    app!: AppLike;

    // --- Transient switch/startup state ---
    isSwitchingSession = false;
    switchLockAt = 0;
    pendingSwitchRequest: SwitchRequest | null = null;
    startupSettleStartedAt = 0;
    startupSettleUntil = 0;
    startupSettleTimer: ReturnType<typeof setTimeout> | null = null;
    startupFlushTimer: ReturnType<typeof setTimeout> | null = null;
    switchOverlayEl: unknown = null;
    sessionSwitchNotice: { hide(): void } | null = null;
    // Public so the shell and tests can inspect the currently registered dynamic
    // switch-command ids (mirrors the reference plugin's field of the same name).
    _dynamicSessionCommandIds: string[] = [];
    private _historySnapshotTimer: ReturnType<typeof setInterval> | null = null;

    // ========================================================================
    // Collaborators — overridden by the shell, stubbed by tests. Inert here so
    // the core has no hard dependency on Obsidian.
    // ========================================================================
    persistData(): Promise<unknown> {
        return Promise.resolve();
    }
    updateStatusBar(): void {}
    addCommand(_command: CommandLike): void {}
    removeCommand(_id: string): void {}
    /** Show a transient notification (wraps Obsidian's Notice in the shell). */
    notify(_message: string): void {}
    hideSwitchOverlay(): void {}
    hideSearchOverlay(): void {}
    showSwitchPreviewOverlay(_ordered: Session[], _index: number, _viewGroupId?: string | null): void {}
    showSwitchFeedbackOverlay(
        _ordered: Session[],
        _index: number,
        _viewGroupId?: string | null,
        _overlayOptions?: unknown,
    ): void {}
    /** True when a modal/overlay is blocking a switch (DOM check in the shell). */
    hasBlockingSwitchUi(): boolean {
        return false;
    }
    /** Open a name-prompt modal (RenameModal in the shell). Inert by default. */
    promptSessionName(_options: NamePromptOptions): void {}
    /**
     * Open the unsaved-switch confirmation (modal in the shell). The inert
     * default proceeds by discarding, so switch flows never hang in tests.
     */
    openUnsavedSwitchModal(
        _message: string,
        _onSave: () => void,
        onDiscard: () => void,
        _onCancel: () => void,
    ): void {
        onDiscard();
    }

    // ========================================================================
    // sessions.js — ordering, indices, active session, layout access
    // ========================================================================
    syncSessionOrder(): void {
        const sessions = this.data.sessions;
        this.data.sessionOrder = this.data.sessionOrder.filter((id) => !!sessions[id]);
        const inOrder: Record<string, boolean> = {};
        for (const id of this.data.sessionOrder) inOrder[id] = true;
        const missing = Object.keys(sessions).filter((id) => !inOrder[id]);
        missing.sort((a, b) => {
            if (sessions[a].isDefault) return -1;
            if (sessions[b].isDefault) return 1;
            return sessions[a].name.localeCompare(sessions[b].name);
        });
        for (const id of missing) {
            if (sessions[id].isDefault) this.data.sessionOrder.unshift(id);
            else this.data.sessionOrder.push(id);
        }
    }

    getOrderedSessionsUnfiltered(): Session[] {
        const sessions = this.data.sessions;
        return this.data.sessionOrder.map((id) => sessions[id]).filter((s): s is Session => !!s);
    }

    getOrderedSessionsForGroup(groupId: string | null): Session[] {
        const all = this.getOrderedSessionsUnfiltered();
        if (!this.isGroupFeatureEnabled()) return all;
        const targetGroupId = groupId || null;
        if (!targetGroupId) return all;
        const sessionGroups = this.data.sessionGroups || {};
        return all.filter((s) => {
            const groups = sessionGroups[s.id];
            return groups && groups.indexOf(targetGroupId) !== -1;
        });
    }

    getOrderedSessions(): Session[] {
        if (!this.isGroupFeatureEnabled()) return this.getOrderedSessionsUnfiltered();
        return this.getOrderedSessionsForGroup(this.data.activeGroupId);
    }

    mergeVisibleSessionOrder(visibleOrder: string[]): string[] {
        const fullOrder = Array.isArray(this.data.sessionOrder) ? this.data.sessionOrder : [];
        const visible = Array.isArray(visibleOrder) ? visibleOrder : [];
        const visibleSet: Record<string, boolean> = {};
        for (const id of visible) visibleSet[id] = true;

        let visibleIdx = 0;
        const merged: string[] = [];
        for (const id of fullOrder) {
            if (visibleSet[id]) merged.push(visible[visibleIdx++]);
            else merged.push(id);
        }
        while (visibleIdx < visible.length) merged.push(visible[visibleIdx++]);
        return merged;
    }

    setSessionOrderFromVisible(
        visibleOrder: string[],
        options?: { syncCommands?: boolean; persist?: boolean },
    ): Promise<boolean> {
        const prev = Array.isArray(this.data.sessionOrder) ? this.data.sessionOrder : [];
        const merged = this.mergeVisibleSessionOrder(visibleOrder);
        let changed = prev.length !== merged.length;
        if (!changed) {
            for (let i = 0; i < prev.length; i++) {
                if (prev[i] !== merged[i]) {
                    changed = true;
                    break;
                }
            }
        }
        this.data.sessionOrder = merged;
        if (!(options && options.syncCommands === false)) this.syncSessionCommands();
        if (options && options.persist === false) return Promise.resolve(changed);
        if (!changed) return Promise.resolve(false);
        return this.persistData().then(() => true);
    }

    getSessionIndex(sessions: Session[], sessionId: string | null): number {
        const idx = this.findSessionIndex(sessions, sessionId);
        return idx === -1 ? 0 : idx;
    }

    findSessionIndex(sessions: Session[], sessionId: string | null): number {
        if (!sessions || sessions.length === 0) return -1;
        for (let i = 0; i < sessions.length; i++) {
            if (sessions[i] && sessions[i].id === sessionId) return i;
        }
        return -1;
    }

    findActiveSessionIndex(sessions: Session[]): number {
        return this.findSessionIndex(sessions, this.data.activeSessionId);
    }

    getActiveSessionIndex(sessions: Session[]): number {
        return this.getSessionIndex(sessions, this.data.activeSessionId);
    }

    getActiveSession(): Session | null {
        if (!this.data.activeSessionId) return null;
        return this.data.sessions[this.data.activeSessionId] || null;
    }

    getCurrentWorkspaceLayout(): Layout {
        return (this.app.workspace.getLayout as () => Layout)();
    }

    serializeLayout(layout: unknown): string {
        return layoutUtils.serializeLayout(layout);
    }

    layoutsEqual(a: unknown, b: unknown): boolean {
        return layoutUtils.layoutsEqual(a, b);
    }

    layoutsEqualStructural(a: unknown, b: unknown): boolean {
        const restoreScope = this.getWorkspaceRestoreScope();
        return layoutUtils.layoutsEqualStructural(a, b, { restoreScope });
    }

    // ========================================================================
    // layout-restore.js
    // ========================================================================
    isSidebarRestoreEnabled(): boolean {
        return this.data.restoreSidebars !== false;
    }

    getWorkspaceRestoreScope(): 'full' | 'main-only' {
        return this.isSidebarRestoreEnabled() ? 'full' : 'main-only';
    }

    buildLayoutForRestore(layout: Layout | null | undefined): Layout | null | undefined {
        if (!layout) return layout;
        if (this.isSidebarRestoreEnabled()) return layoutUtils.cloneLayout(layout);
        let currentLayout: Layout | null = null;
        try {
            currentLayout = this.getCurrentWorkspaceLayout();
        } catch {
            currentLayout = null;
        }
        return layoutUtils.mergeMainLayoutIntoCurrent(layout, currentLayout);
    }

    applyWorkspaceLayout(layout: Layout | null | undefined, options?: { catchErrors?: boolean }): Promise<void> {
        const opts = options || {};
        if (!layout) return Promise.resolve();
        const nextLayout = this.buildLayoutForRestore(layout);
        const apply = Promise.resolve(this.app.workspace.changeLayout(nextLayout));
        if (opts.catchErrors === false) return apply as Promise<void>;
        return (apply as Promise<void>).catch(() => {});
    }

    // ========================================================================
    // sessions-validation.js
    // ========================================================================
    isSessionNameTaken(name: string, excludeSessionId?: string): boolean {
        const sessions = this.data.sessions || {};
        for (const id of Object.keys(sessions)) {
            if (excludeSessionId && id === excludeSessionId) continue;
            if (!sessions[id]) continue;
            if (sessions[id].name === name) return true;
        }
        return false;
    }

    isGroupNameTaken(name: string, excludeGroupId?: string): boolean {
        const groups = this.data.groups || {};
        for (const id of Object.keys(groups)) {
            if (excludeGroupId && id === excludeGroupId) continue;
            if (!groups[id]) continue;
            if (groups[id].name === name) return true;
        }
        return false;
    }

    createSessionValidated(
        name: string,
        options?: { notify?: boolean },
    ): Promise<{ created: boolean; reason: string; name: string; sessionId: string | null }> {
        const L = i18n.L;
        const opts = options || {};
        const rawName = typeof name === 'string' ? name : '';
        let finalName = rawName.trim();
        if (!finalName) {
            if (rawName.length > 0) {
                if (opts.notify !== false) this.notify(L.emptyName);
                return Promise.resolve({ created: false, reason: 'empty', name: '', sessionId: null });
            }
            finalName = this.getNextSessionName();
        }
        if (this.isSessionNameTaken(finalName)) {
            if (opts.notify !== false) this.notify(L.duplicateName);
            return Promise.resolve({ created: false, reason: 'duplicate', name: finalName, sessionId: null });
        }
        return this.createSession(finalName).then(() => ({
            created: true,
            reason: '',
            name: finalName,
            sessionId: this.data.activeSessionId,
        }));
    }

    createSessionForViewedGroup(
        name: string,
        viewedGroupId: string | null,
        options?: { notify?: boolean },
    ): Promise<Record<string, unknown>> {
        const groupsEnabled = this.isGroupFeatureEnabled();
        const targetGroupId = groupsEnabled ? viewedGroupId || null : null;
        const beforeActiveGroupId = groupsEnabled ? this.data.activeGroupId || null : null;

        return this.createSessionValidated(name, options).then((result): Promise<Record<string, unknown>> | Record<string, unknown> => {
            const res = result as Record<string, unknown>;
            if (!res || !res.created) return res;
            if (!groupsEnabled) {
                res.viewGroupId = null;
                return res;
            }
            const createdSessionId = res.sessionId as string;
            if (targetGroupId && targetGroupId !== beforeActiveGroupId) {
                return this.moveSessionToGroupExclusive(createdSessionId, targetGroupId).then(() =>
                    this.resolveGroupSelection(targetGroupId).then((selection) => {
                        res.viewGroupId = selection.resolvedGroupId || null;
                        return res;
                    }),
                );
            }
            res.viewGroupId = this.data.activeGroupId || null;
            return res;
        });
    }

    renameSessionById(sessionId: string, newName: string, options?: { notify?: boolean }): Promise<boolean> {
        const L = i18n.L;
        const opts = options || {};
        const session = this.data.sessions[sessionId];
        if (!session) return Promise.resolve(false);
        const normalized = typeof newName === 'string' ? newName.trim() : '';
        if (!normalized) {
            if (opts.notify !== false) this.notify(L.emptyName);
            return Promise.resolve(false);
        }
        if (normalized === session.name) return Promise.resolve(false);
        if (this.isSessionNameTaken(normalized, sessionId)) {
            if (opts.notify !== false) this.notify(L.duplicateName);
            return Promise.resolve(false);
        }
        const oldName = session.name;
        session.name = normalized;
        session.modified = Date.now();
        this.updateStatusBar();
        this.syncSessionCommands();
        return this.persistData().then(() => {
            if (opts.notify !== false) this.notify(L.renamed(oldName, normalized));
            return true;
        });
    }

    createGroupValidated(name: string, options?: { notify?: boolean }): Promise<string | false> {
        const L = i18n.L;
        const opts = options || {};
        const normalized = typeof name === 'string' ? name.trim() : '';
        if (!normalized) {
            if (opts.notify !== false) this.notify(L.groupEmptyName);
            return Promise.resolve(false);
        }
        if (this.isGroupNameTaken(normalized)) {
            if (opts.notify !== false) this.notify(L.groupDuplicateName);
            return Promise.resolve(false);
        }
        return this.createGroup(normalized);
    }

    renameGroupValidated(groupId: string, newName: string, options?: { notify?: boolean }): Promise<boolean> {
        const L = i18n.L;
        const opts = options || {};
        const groups = this.data.groups || {};
        const group = groups[groupId];
        if (!group) return Promise.resolve(false);
        const normalized = typeof newName === 'string' ? newName.trim() : '';
        if (!normalized) {
            if (opts.notify !== false) this.notify(L.groupEmptyName);
            return Promise.resolve(false);
        }
        if (normalized === group.name) return Promise.resolve(false);
        if (this.isGroupNameTaken(normalized, groupId)) {
            if (opts.notify !== false) this.notify(L.groupDuplicateName);
            return Promise.resolve(false);
        }
        return this.renameGroup(groupId, normalized);
    }

    // ========================================================================
    // session-crud.js
    // ========================================================================
    getDefaultSessionName(): string {
        return i18n.L.defaultSessionName;
    }

    getAutoSessionName(n: number): string {
        return i18n.L.sessionAutoName(n);
    }

    insertSessionAndActivate(session: Session): void {
        this.data.sessions[session.id] = session;
        this.data.sessionOrder.push(session.id);
        this.data.activeSessionId = session.id;
        this.attachSessionToActiveGroup(session.id);
    }

    createSessionRecord(
        id: string,
        name: string,
        layout: Layout | null | undefined,
        options?: CreateSessionOptions,
    ): Session {
        const opts = options || {};
        const record: Session = {
            id,
            name,
            modified: typeof opts.modified === 'number' ? opts.modified : Date.now(),
            layout: layout ?? undefined,
        };
        if (opts.isDefault) record.isDefault = true;
        return record;
    }

    createSession(name: string): Promise<unknown> {
        const id = generateId();
        const layout = this.getCurrentWorkspaceLayout();
        this.insertSessionAndActivate(this.createSessionRecord(id, name, layout));
        this.updateStatusBar();
        this.syncSessionCommands();
        return this.persistData();
    }

    deleteSession(sessionId: string): Promise<boolean> {
        const session = this.data.sessions[sessionId];
        if (!session || Object.keys(this.data.sessions).length <= 1) return Promise.resolve(false);

        const wasActive = this.data.activeSessionId === sessionId;
        let nextActiveId: string | null = null;

        delete this.data.sessions[sessionId];
        const orderIdx = this.data.sessionOrder.indexOf(sessionId);
        if (orderIdx !== -1) this.data.sessionOrder.splice(orderIdx, 1);

        if (this.data.sessionGroups && this.data.sessionGroups[sessionId]) {
            delete this.data.sessionGroups[sessionId];
        }
        if (wasActive) {
            const fallbackIdx = Math.min(orderIdx, this.data.sessionOrder.length - 1);
            const remaining = this.data.sessionOrder[fallbackIdx] || Object.keys(this.data.sessions)[0];
            nextActiveId = remaining || null;
            this.data.activeSessionId = nextActiveId;
        }

        let applyNextLayout: Promise<void> = Promise.resolve();
        if (wasActive && nextActiveId) {
            const nextSession = this.data.sessions[nextActiveId];
            applyNextLayout = nextSession && nextSession.layout
                ? this.applyWorkspaceLayout(nextSession.layout)
                : Promise.resolve();
        }

        this.updateStatusBar();
        this.syncSessionCommands();
        return applyNextLayout.then(() => this.persistData()).then(() => true);
    }

    deleteAllInactiveSessions(): Promise<number> {
        const activeId = this.data.activeSessionId;
        const ids = Object.keys(this.data.sessions || {}).filter((id) => id !== activeId);
        return Promise.all(ids.map((id) => this.deleteSession(id))).then((results) => {
            let deletedCount = 0;
            for (const r of results) if (r) deletedCount++;
            return deletedCount;
        });
    }

    getNextSessionName(): string {
        const sessions = this.data.sessions;
        const existing: Record<string, boolean> = {};
        for (const key of Object.keys(sessions)) existing[sessions[key].name] = true;
        let n = 1;
        while (existing[this.getAutoSessionName(n)]) n++;
        return this.getAutoSessionName(n);
    }

    resetSessionsToDefault(): Promise<unknown> {
        const id = generateId();
        this.hideSwitchOverlay();
        this.data.sessions = {};
        this.data.sessionOrder = [];
        this.data.activeSessionId = null;
        this.data.groups = {};
        this.data.groupOrder = [];
        this.data.sessionGroups = {};
        this.data.activeGroupId = null;
        this.data.sessions[id] = this.createSessionRecord(
            id,
            this.getDefaultSessionName(),
            this.getCurrentWorkspaceLayout(),
            { isDefault: true },
        );
        this.data.sessionOrder.push(id);
        this.data.activeSessionId = id;
        this.updateStatusBar();
        this.syncSessionCommands();
        return this.persistData();
    }

    createEmptySession(): Promise<unknown> {
        const L = i18n.L;
        const name = this.getNextSessionName();
        this.captureActiveSessionLayoutIfAutoSave();

        const id = generateId();
        const session = this.createSessionRecord(id, name, null);
        this.insertSessionAndActivate(session);

        const leaves: { detach(): void }[] = [];
        this.app.workspace.iterateRootLeaves?.((leaf) => leaves.push(leaf));
        for (const leaf of leaves) leaf.detach();

        session.layout = this.getCurrentWorkspaceLayout();
        this.updateStatusBar();
        this.syncSessionCommands();
        this.notify(L.created(name));
        return this.persistData();
    }

    duplicateCurrentSession(): Promise<unknown> {
        const L = i18n.L;
        const name = this.getNextSessionName();
        this.captureActiveSessionLayoutIfAutoSave();
        const id = generateId();
        this.insertSessionAndActivate(this.createSessionRecord(id, name, this.getCurrentWorkspaceLayout()));
        this.updateStatusBar();
        this.syncSessionCommands();
        this.notify(L.duplicated(name));
        return this.persistData();
    }

    /** Duplicate an arbitrary session by ID (does NOT switch to the copy). */
    duplicateSession(sessionId: string): Promise<unknown> {
        const L = i18n.L;
        const source = this.data.sessions[sessionId];
        if (!source) return Promise.resolve(undefined);
        const name = this.getNextSessionName();
        const newId = generateId();
        this.data.sessions[newId] = this.createSessionRecord(newId, name, layoutUtils.cloneLayout(source.layout));
        this.data.sessionOrder.push(newId);
        const groups = (this.data.sessionGroups || {})[sessionId];
        if (groups && groups.length > 0) {
            if (!this.data.sessionGroups) this.data.sessionGroups = {};
            this.data.sessionGroups[newId] = groups.slice();
        }
        this.syncSessionCommands();
        this.notify(L.duplicated(name));
        return this.persistData();
    }

    ensureDefaultSession(): void {
        const hasDefault = Object.values(this.data.sessions).some((s) => s.isDefault);
        if (hasDefault) return;
        const id = generateId();
        this.data.sessions[id] = this.createSessionRecord(
            id,
            this.getDefaultSessionName(),
            this.getCurrentWorkspaceLayout(),
            { isDefault: true },
        );
        this.data.sessionOrder.unshift(id);
        this.data.activeSessionId = id;
        this.updateStatusBar();
        this.syncSessionCommands();
        void this.persistData();
    }

    // ========================================================================
    // session-saving.js
    // ========================================================================
    isAutoSaveOnSwitchEnabled(): boolean {
        return this.data.autoSaveOnSwitch !== false;
    }

    isWarnOnUnsavedSwitchEnabled(): boolean {
        return this.data.warnOnUnsavedSwitch !== false;
    }

    isUnsavedStatusBarHighlightEnabled(): boolean {
        return this.data.highlightUnsavedSessionChanges !== false;
    }

    isActiveSessionDirty(): boolean {
        const session = this.getActiveSession();
        if (!session) return false;
        let currentLayout: Layout;
        try {
            currentLayout = this.getCurrentWorkspaceLayout();
        } catch {
            return false;
        }
        return !this.layoutsEqualStructural(session.layout, currentLayout);
    }

    shouldShowUnsavedStatusBarHighlight(): boolean {
        return (
            this.isUnsavedStatusBarHighlightEnabled() &&
            !this.isAutoSaveOnSwitchEnabled() &&
            this.isActiveSessionDirty()
        );
    }

    setAutoSaveOnSwitch(enabled: boolean, options?: { notify?: boolean }): Promise<boolean> {
        const L = i18n.L;
        const opts = options || {};
        this.data.autoSaveOnSwitch = !!enabled;
        const isOn = this.isAutoSaveOnSwitchEnabled();
        if (isOn) this.startHistorySnapshotTimer();
        else this.stopHistorySnapshotTimer();
        this.updateStatusBar();
        return this.persistData().then(() => {
            if (opts.notify) this.notify(isOn ? L.autoSaveEnabled : L.autoSaveDisabled);
            return isOn;
        });
    }

    toggleAutoSaveOnSwitch(options?: { notify?: boolean }): Promise<boolean> {
        return this.setAutoSaveOnSwitch(!this.isAutoSaveOnSwitchEnabled(), options || {});
    }

    saveActiveSession(options?: { silent?: boolean; touchModified?: boolean }): Promise<boolean> {
        const L = i18n.L;
        const opts = options || {};
        const session = this.getActiveSession();
        if (!session) {
            if (!opts.silent) this.notify(L.noSession);
            return Promise.resolve(false);
        }

        if (!opts.silent && session.isDefault && session.name === this.getDefaultSessionName()) {
            const doSave = (name: string, resolve: (v: boolean) => void): void => {
                session.name = name;
                this.pushLayoutToHistory(session);
                session.layout = this.getCurrentWorkspaceLayout();
                session.modified = Date.now();
                this.updateStatusBar();
                this.syncSessionCommands();
                void this.persistData().then(() => {
                    this.notify(L.savedSession(name));
                    resolve(true);
                });
            };
            return new Promise((resolve) => {
                this.promptSessionName({
                    title: L.nameSessionTitle,
                    placeholder: L.nameSessionPlaceholder,
                    buttonText: L.saveInline,
                    skipButtonText: L.saveWithoutNaming,
                    onSubmit: (newName) => doSave(newName, resolve),
                    onSkip: () => doSave(session.name, resolve),
                });
            });
        }

        const currentLayout = this.getCurrentWorkspaceLayout();
        const changed = !this.layoutsEqualStructural(session.layout, currentLayout);
        this.pushLayoutToHistory(session);
        session.layout = currentLayout;
        if (changed || opts.touchModified) session.modified = Date.now();
        this.updateStatusBar();
        const name = session.name;
        return this.persistData().then(() => {
            if (!opts.silent) this.notify(changed ? L.savedSession(name) : L.noChanges);
            return changed;
        });
    }

    overwriteSessionWithCurrentLayout(
        sessionId: string,
        options?: { silent?: boolean; touchModified?: boolean },
    ): Promise<boolean> {
        const L = i18n.L;
        const opts = options || {};
        const session = this.data.sessions[sessionId];
        if (!session) {
            if (!opts.silent) this.notify(L.noSession);
            return Promise.resolve(false);
        }
        const currentLayout = this.getCurrentWorkspaceLayout();
        const changed = !this.layoutsEqualStructural(session.layout, currentLayout);
        this.pushLayoutToHistory(session);
        session.layout = currentLayout;
        if (changed || opts.touchModified) session.modified = Date.now();
        this.updateStatusBar();
        return this.persistData().then(() => {
            if (!opts.silent) {
                this.notify(changed ? L.savedCurrentLayoutToSession(session.name) : L.noChanges);
            }
            return changed;
        });
    }

    saveCurrentLayoutAsSessionName(name: string, options?: { silent?: boolean }): Promise<SaveResult> {
        const L = i18n.L;
        const opts = options || {};
        const sessionName = typeof name === 'string' ? name.trim() : '';
        if (!sessionName) {
            if (!opts.silent) this.notify(L.emptyName);
            return Promise.resolve({ saved: false, created: false, overwritten: false, sessionId: null, name: sessionName });
        }

        const previousActiveId = this.data.activeSessionId || null;
        if (this.isAutoSaveOnSwitchEnabled()) this.captureActiveSessionLayoutIfAutoSave();

        const currentLayout = this.getCurrentWorkspaceLayout();
        const existing = findSessionByName(this.data, sessionName);
        let session: Session;
        let created = false;
        let overwritten = false;
        let changed = true;

        if (existing) {
            session = existing;
            changed = !this.layoutsEqualStructural(session.layout, currentLayout);
            if (!(this.isAutoSaveOnSwitchEnabled() && session.id === previousActiveId)) {
                this.pushLayoutToHistory(session);
            }
            session.layout = currentLayout;
            session.modified = Date.now();
            this.data.activeSessionId = session.id;
            const preferredGroupId = this.chooseSessionGroupForView(session.id);
            if (typeof preferredGroupId !== 'undefined') this.data.activeGroupId = preferredGroupId;
            overwritten = true;
        } else {
            const id = generateId();
            session = this.createSessionRecord(id, sessionName, currentLayout);
            this.insertSessionAndActivate(session);
            created = true;
        }

        this.updateStatusBar();
        this.syncSessionCommands();
        return this.persistData().then(() => {
            if (!opts.silent) this.notify(L.savedAs(sessionName));
            return { saved: true, created, overwritten, changed, sessionId: session.id, name: sessionName };
        });
    }

    private chooseSessionGroupForView(sessionId: string): string | null | undefined {
        if (!this.isGroupFeatureEnabled()) return undefined;
        const data = this.data;
        const groups = data.groups || {};
        const sessionGroups = data.sessionGroups || {};
        const groupIds = Array.isArray(sessionGroups[sessionId]) ? sessionGroups[sessionId] : [];
        const validGroupIds = groupIds.filter((groupId) => !!groups[groupId]);
        if (validGroupIds.length === 0) return null;
        if (validGroupIds.indexOf(data.activeGroupId as string) !== -1) return data.activeGroupId;
        const ordered = this.getOrderedGroupTabIds();
        for (const gid of ordered) {
            if (gid === '__all__') continue;
            if (validGroupIds.indexOf(gid) !== -1) return gid;
        }
        return validGroupIds[0];
    }

    reloadCurrentSessionWithoutSaving(options?: { silent?: boolean }): Promise<boolean> {
        const L = i18n.L;
        const opts = options || {};
        const session = this.getActiveSession();
        if (!session) {
            if (!opts.silent) this.notify(L.noSession);
            return Promise.resolve(false);
        }
        const applyLayout = session.layout ? this.applyWorkspaceLayout(session.layout) : Promise.resolve();
        const name = session.name;
        return applyLayout
            .then(() => {
                if (!opts.silent) this.notify(L.reloadedSession(name));
                return true;
            })
            .catch(() => false);
    }

    captureActiveSessionLayoutIfAutoSave(): void {
        const current = this.getActiveSession();
        if (!current || !this.isAutoSaveOnSwitchEnabled()) return;
        this.pushLayoutToHistory(current);
        current.layout = this.getCurrentWorkspaceLayout();
        current.modified = Date.now();
    }

    // ========================================================================
    // session-switching.js
    // ========================================================================
    clearSessionSwitchNotice(): void {
        if (!this.sessionSwitchNotice) return;
        this.sessionSwitchNotice.hide();
        this.sessionSwitchNotice = null;
    }

    showSessionSwitchNotice(sessionName: string, options?: { durationMs?: number }): void {
        const opts = options || {};
        const durationMs =
            typeof opts.durationMs === 'number' ? opts.durationMs : SESSION_SWITCH_NOTICE_DURATION_MS;
        this.clearSessionSwitchNotice();
        // The shell wires an actual replaceable Notice; the base emits a plain one.
        this.notify(i18n.L.loaded(sessionName));
        void durationMs;
    }

    getRelativeSwitchContext(offset: number): RelativeSwitchContext | null {
        const ordered = this.getOrderedSessions();
        if (ordered.length === 0) {
            return { ordered, currentIndex: -1, targetIndex: 0, isEmpty: true };
        }
        const currentIndex = this.findActiveSessionIndex(ordered);
        if (currentIndex === -1) return null;
        return {
            ordered,
            currentIndex,
            targetIndex: (currentIndex + offset + ordered.length) % ordered.length,
            isEmpty: false,
        };
    }

    switchSessionAtOrderedIndex(
        ordered: Session[],
        index: number,
        options?: {
            overlayMode?: 'preview' | 'feedback' | 'none';
            viewGroupId?: string | null;
            overlayOptions?: unknown;
            silent?: boolean;
            noticeMode?: 'replace' | string;
            switchNoticeDurationMs?: number;
        },
    ): Promise<boolean> {
        const opts = options || {};
        if (!ordered || index < 0 || index >= ordered.length) return Promise.resolve(false);

        if (opts.overlayMode === 'preview') {
            this.showSwitchPreviewOverlay(ordered, index, opts.viewGroupId);
        } else if (opts.overlayMode === 'feedback') {
            this.showSwitchFeedbackOverlay(ordered, index, opts.viewGroupId, opts.overlayOptions);
        }

        if (!ordered[index]) return Promise.resolve(false);

        if (ordered[index].id === this.data.activeSessionId) {
            if (opts.noticeMode === 'replace') {
                this.showSessionSwitchNotice(ordered[index].name, { durationMs: opts.switchNoticeDurationMs });
            }
            return Promise.resolve(false);
        }

        return this.switchSession(ordered[index].id, {
            silent: opts.silent !== false,
            switchNoticeMode: opts.noticeMode,
            switchNoticeDurationMs: opts.switchNoticeDurationMs,
        });
    }

    switchToIndex(index: number): Promise<boolean> {
        const ordered = this.getOrderedSessions();
        return this.switchSessionAtOrderedIndex(ordered, index, { overlayMode: 'feedback', silent: true });
    }

    switchSessionByIdFromCommand(sessionId: string): Promise<boolean> {
        const ordered = this.getOrderedSessions();
        const index = this.findSessionIndex(ordered, sessionId);
        return this.switchSessionAtOrderedIndex(ordered, index, { overlayMode: 'feedback', silent: true });
    }

    switchRelativeDirect(
        offset: number,
        options?: {
            overlayMode?: 'preview' | 'feedback' | 'none';
            viewGroupId?: string | null;
            overlayOptions?: unknown;
            noticeMode?: string;
            silent?: boolean;
        },
    ): Promise<boolean> {
        const opts = options || {};
        const context = this.getRelativeSwitchContext(offset);
        if (!context) return Promise.resolve(false);
        if (context.isEmpty) {
            if (opts.overlayMode === 'preview') {
                this.showSwitchPreviewOverlay(context.ordered, 0, opts.viewGroupId);
            } else if (opts.overlayMode === 'feedback') {
                this.showSwitchFeedbackOverlay(context.ordered, 0, opts.viewGroupId, opts.overlayOptions);
            }
            return Promise.resolve(false);
        }
        return this.switchSessionAtOrderedIndex(context.ordered, context.targetIndex, opts);
    }

    switchRelativeFromCommand(offset: number): Promise<boolean> {
        const context = this.getRelativeSwitchContext(offset);
        if (!context) return Promise.resolve(false);
        if (context.isEmpty) {
            this.showSwitchPreviewOverlay(context.ordered, 0);
            return Promise.resolve(false);
        }
        const previewEnabled = offset > 0 ? this.data.previewNext : this.data.previewPrevious;
        if (previewEnabled && !this.switchOverlayEl) {
            this.showSwitchPreviewOverlay(context.ordered, context.currentIndex);
            return Promise.resolve(false);
        }
        return this.switchSessionAtOrderedIndex(context.ordered, context.targetIndex, {
            overlayMode: 'preview',
            silent: true,
        });
    }

    switchRelativeFromStatusBar(offset: number): Promise<boolean> {
        return this.switchRelativeDirect(offset, { overlayMode: 'none', noticeMode: 'replace', silent: true });
    }

    switchRelativeFromScroll(offset: number): Promise<boolean> {
        return this.switchRelativeDirect(offset, { overlayMode: 'none', noticeMode: 'replace', silent: true });
    }

    switchRelative(offset: number): Promise<boolean> {
        return this.switchRelativeFromCommand(offset);
    }

    switchRelativeImmediate(offset: number, options?: { showOverlay?: boolean; overlayOptions?: unknown }): Promise<boolean> {
        const opts = options || {};
        return this.switchRelativeDirect(offset, {
            overlayMode: opts.showOverlay === false ? 'none' : 'feedback',
            overlayOptions: opts.overlayOptions,
            silent: true,
        });
    }

    runSwitchRequest(request: SwitchRequest): void {
        this.isSwitchingSession = true;
        this.switchLockAt = Date.now();
        this.performSessionSwitch(request.targetId, request.options || {})
            .then((ok) => request.resolve(ok))
            .catch(() => request.resolve(false))
            .then(() => {
                this.isSwitchingSession = false;
                this.switchLockAt = 0;
                if (!this.pendingSwitchRequest) return;
                const next = this.pendingSwitchRequest;
                this.pendingSwitchRequest = null;
                this.runSwitchRequest(next);
            });
    }

    switchSession(targetId: string, options?: SwitchOptions): Promise<boolean> {
        const opts = options || {};
        const startupDelayMs = this.getStartupSettleRemainingMs();
        if (startupDelayMs > 0) {
            return new Promise((resolve) => {
                setTimeout(() => {
                    this.switchSession(targetId, opts).then(resolve);
                }, startupDelayMs);
            });
        }

        if (this.isSwitchingSession) {
            const lockAt = this.switchLockAt || 0;
            const elapsed = lockAt ? Date.now() - lockAt : Number.MAX_SAFE_INTEGER;
            const hasBlockingUi = this.hasBlockingSwitchUi();
            if (!hasBlockingUi && elapsed > 5000) {
                this.isSwitchingSession = false;
                this.switchLockAt = 0;
                if (this.pendingSwitchRequest) {
                    this.pendingSwitchRequest.resolve(false);
                    this.pendingSwitchRequest = null;
                }
            }
        }

        if (!this.data.sessions[targetId]) return Promise.resolve(false);
        if (targetId === this.data.activeSessionId && !this.isSwitchingSession) return Promise.resolve(false);

        return new Promise((resolve) => {
            const request: SwitchRequest = { targetId, options: opts, resolve };
            if (this.isSwitchingSession) {
                if (this.pendingSwitchRequest) this.pendingSwitchRequest.resolve(false);
                this.pendingSwitchRequest = request;
                return;
            }
            this.runSwitchRequest(request);
        });
    }

    performSessionSwitch(targetId: string, options?: SwitchOptions): Promise<boolean> {
        const L = i18n.L;
        const opts = options || {};
        const target = this.data.sessions[targetId];
        if (!target) return Promise.resolve(false);
        if (target.id === this.data.activeSessionId) return Promise.resolve(false);

        const performSwitch = (skipCurrentSave: boolean): Promise<boolean> => {
            const current = this.getActiveSession();
            if (current && !skipCurrentSave) {
                this.pushLayoutToHistory(current);
                current.layout = this.getCurrentWorkspaceLayout();
                current.modified = Date.now();
            }
            this.data.activeSessionId = targetId;
            const applyLayout = target.layout ? this.applyWorkspaceLayout(target.layout) : Promise.resolve();
            return applyLayout
                .then(() => {
                    this.updateStatusBar();
                    return this.persistData();
                })
                .then(() => {
                    if (opts.switchNoticeMode === 'replace') {
                        this.showSessionSwitchNotice(target.name, { durationMs: opts.switchNoticeDurationMs });
                    } else if (!opts.silent) {
                        this.notify(L.loaded(target.name));
                    }
                    return true;
                });
        };

        const autoSaveOnSwitch = this.isAutoSaveOnSwitchEnabled();
        const shouldWarn =
            !autoSaveOnSwitch &&
            !opts.skipUnsavedWarning &&
            this.isWarnOnUnsavedSwitchEnabled() &&
            this.isActiveSessionDirty();

        if (shouldWarn) {
            return new Promise((resolve) => {
                this.openUnsavedSwitchModal(
                    L.confirmUnsavedSwitch(target.name),
                    () => {
                        this.saveActiveSession({ silent: true, touchModified: true })
                            .then(() => performSwitch(true))
                            .then((ok) => resolve(ok))
                            .catch(() => resolve(false));
                    },
                    () => {
                        performSwitch(true)
                            .then((ok) => resolve(ok))
                            .catch(() => resolve(false));
                    },
                    () => resolve(false),
                );
            });
        }

        return performSwitch(!autoSaveOnSwitch);
    }

    // ========================================================================
    // session-startup.js
    // ========================================================================
    setStartupSettleDeadline(deadlineMs: number): number {
        const nextDeadline = typeof deadlineMs === 'number' ? deadlineMs : 0;
        if (this.startupSettleTimer) {
            clearTimeout(this.startupSettleTimer);
            this.startupSettleTimer = null;
        }
        if (nextDeadline <= Date.now()) {
            this.startupSettleStartedAt = 0;
            this.startupSettleUntil = 0;
            return 0;
        }
        this.startupSettleUntil = nextDeadline;
        this.startupSettleTimer = setTimeout(() => {
            this.startupSettleStartedAt = 0;
            this.startupSettleUntil = 0;
            this.startupSettleTimer = null;
        }, nextDeadline - Date.now());
        return this.startupSettleUntil;
    }

    startStartupSettleWindow(durationMs?: number): number {
        const startedAt = Date.now();
        const duration = typeof durationMs === 'number' && durationMs > 0 ? durationMs : STARTUP_SETTLE_MS;
        this.startupSettleStartedAt = startedAt;
        return this.setStartupSettleDeadline(startedAt + duration);
    }

    getStartupSettleRemainingMs(): number {
        const remaining = (this.startupSettleUntil || 0) - Date.now();
        return remaining > 0 ? remaining : 0;
    }

    isStartupSettling(): boolean {
        return this.getStartupSettleRemainingMs() > 0;
    }

    noteStartupLayoutChange(): void {
        if (!this.isStartupSettling()) return;
        const startedAt = this.startupSettleStartedAt || Date.now();
        const maxDeadline = startedAt + STARTUP_SETTLE_MAX_MS;
        const nextDeadline = Math.min(maxDeadline, Date.now() + STARTUP_LAYOUT_CHANGE_SETTLE_MS);
        if (nextDeadline <= (this.startupSettleUntil || 0)) return;
        this.setStartupSettleDeadline(nextDeadline);
        void this.scheduleStartupFlush();
    }

    scheduleStartupFlush(): Promise<boolean> {
        if (this.startupFlushTimer) {
            clearTimeout(this.startupFlushTimer);
            this.startupFlushTimer = null;
        }
        if (!this.isAutoSaveOnSwitchEnabled()) return Promise.resolve(false);
        const delayMs = this.getStartupSettleRemainingMs();
        if (delayMs <= 0) return Promise.resolve(this.flushOnStartup()).then(() => true);
        return new Promise((resolve) => {
            this.startupFlushTimer = setTimeout(() => {
                this.startupFlushTimer = null;
                resolve(Promise.resolve(this.flushOnStartup()).then(() => true));
            }, delayMs);
        });
    }

    flushOnStartup(): Promise<unknown> | void {
        if (!this.isAutoSaveOnSwitchEnabled()) return;
        const session = this.getActiveSession();
        if (!session) return;
        this.pushLayoutToHistory(session);
        session.layout = this.getCurrentWorkspaceLayout();
        session.modified = Date.now();
        return this.persistData();
    }

    // ========================================================================
    // groups.js
    // ========================================================================
    isGroupFeatureEnabled(): boolean {
        return this.data.groupFeatureEnabled !== false;
    }

    normalizeGroupFeatureState(): void {
        if (this.isGroupFeatureEnabled()) return;
        this.data.activeGroupId = null;
    }

    setGroupFeatureEnabled(enabled: boolean): Promise<boolean> {
        const nextEnabled = enabled !== false;
        let changed = this.isGroupFeatureEnabled() !== nextEnabled;
        this.data.groupFeatureEnabled = nextEnabled;
        if (!nextEnabled && this.data.activeGroupId) {
            this.data.activeGroupId = null;
            changed = true;
        }
        if (!nextEnabled) {
            this.hideSwitchOverlay();
            this.hideSearchOverlay();
        }
        this.syncSessionCommands();
        this.updateStatusBar();
        if (!changed) return Promise.resolve(false);
        return this.persistData().then(() => true);
    }

    attachSessionToActiveGroup(sessionId: string): void {
        if (!this.isGroupFeatureEnabled()) return;
        const activeGroupId = this.data.activeGroupId;
        if (!activeGroupId) return;
        if (!this.data.sessionGroups) this.data.sessionGroups = {};
        if (!Array.isArray(this.data.sessionGroups[sessionId])) this.data.sessionGroups[sessionId] = [];
        if (this.data.sessionGroups[sessionId].indexOf(activeGroupId) === -1) {
            this.data.sessionGroups[sessionId].push(activeGroupId);
        }
    }

    getOrderedGroups(): Group[] {
        if (!this.isGroupFeatureEnabled()) return [];
        const groups = this.data.groups || {};
        return (this.data.groupOrder || []).map((id) => groups[id]).filter((g): g is Group => !!g);
    }

    normalizeGroupTabOrder(order: string[]): string[] {
        const groups = this.data.groups || {};
        const input = Array.isArray(order) ? order : [];
        const seen: Record<string, boolean> = {};
        const out: string[] = [];

        for (const gid of input) {
            if (gid !== '__all__' && !groups[gid]) continue;
            if (seen[gid]) continue;
            seen[gid] = true;
            out.push(gid);
        }
        if (!seen.__all__) {
            out.unshift('__all__');
            seen.__all__ = true;
        }
        for (const gid of Object.keys(groups)) {
            if (seen[gid]) continue;
            seen[gid] = true;
            out.push(gid);
        }
        return out;
    }

    getOrderedGroupTabIds(): string[] {
        if (!this.isGroupFeatureEnabled()) return [];
        this.data.groupOrder = this.normalizeGroupTabOrder(this.data.groupOrder);
        return this.data.groupOrder.slice();
    }

    setGroupTabOrder(order: string[], options?: { persist?: boolean }): Promise<boolean> {
        if (!this.isGroupFeatureEnabled()) return Promise.resolve(false);
        const prev = Array.isArray(this.data.groupOrder) ? this.data.groupOrder : [];
        const normalized = this.normalizeGroupTabOrder(order);
        let changed = prev.length !== normalized.length;
        if (!changed) {
            for (let i = 0; i < prev.length; i++) {
                if (prev[i] !== normalized[i]) {
                    changed = true;
                    break;
                }
            }
        }
        this.data.groupOrder = normalized;
        if (options && options.persist === false) return Promise.resolve(changed);
        if (!changed) return Promise.resolve(false);
        return this.persistData().then(() => true);
    }

    getActiveGroup(): Group | null {
        if (!this.isGroupFeatureEnabled()) return null;
        if (!this.data.activeGroupId) return null;
        return (this.data.groups || {})[this.data.activeGroupId] || null;
    }

    createGroup(name: string): Promise<string> {
        const L = i18n.L;
        const id = generateId();
        if (!this.data.groups) this.data.groups = {};
        this.data.groups[id] = { id, name };
        const nextOrder = Array.isArray(this.data.groupOrder) ? this.data.groupOrder.slice() : [];
        nextOrder.push(id);
        this.data.groupOrder = this.normalizeGroupTabOrder(nextOrder);
        this.notify(L.groupCreated(name));
        return this.persistData().then(() => id);
    }

    deleteGroup(groupId: string): Promise<boolean> {
        const L = i18n.L;
        if (!this.data.groups || !this.data.groups[groupId]) return Promise.resolve(false);
        const name = this.data.groups[groupId].name;
        delete this.data.groups[groupId];
        const nextOrder = (this.data.groupOrder || []).filter((gid) => gid !== groupId);
        this.data.groupOrder = this.normalizeGroupTabOrder(nextOrder);
        void this.removeGroupMembershipFromAllSessions(groupId, { persist: false });
        if (this.data.activeGroupId === groupId) this.data.activeGroupId = null;
        this.updateStatusBar();
        this.syncSessionCommands();
        this.notify(L.groupDeleted(name));
        return this.persistData().then(() => true);
    }

    renameGroup(groupId: string, newName: string): Promise<boolean> {
        const L = i18n.L;
        if (!this.data.groups || !this.data.groups[groupId]) return Promise.resolve(false);
        const oldName = this.data.groups[groupId].name;
        this.data.groups[groupId].name = newName;
        this.updateStatusBar();
        this.notify(L.groupRenamed(oldName, newName));
        return this.persistData().then(() => true);
    }

    setActiveGroup(groupId: string | null): Promise<boolean> {
        if (!this.isGroupFeatureEnabled()) return Promise.resolve(false);
        const nextGroupId = groupId || null;
        if (nextGroupId && (!this.data.groups || !this.data.groups[nextGroupId])) return Promise.resolve(false);

        const commitGroup = (): Promise<boolean> => {
            this.data.activeGroupId = nextGroupId;
            this.syncSessionCommands();
            this.updateStatusBar();
            return this.persistData().then(() => true);
        };

        if (!nextGroupId) return commitGroup();

        const sessionGroups = this.data.sessionGroups || {};
        const targetSessions = this.getOrderedSessionsUnfiltered().filter((s) => {
            const groups = sessionGroups[s.id];
            return groups && groups.indexOf(nextGroupId) !== -1;
        });
        if (targetSessions.length === 0) return Promise.resolve(false);

        const activeId = this.data.activeSessionId;
        const isInTarget = targetSessions.some((s) => s.id === activeId);
        if (isInTarget) return commitGroup();

        return this.switchSession(targetSessions[0].id).then((switched) => {
            if (!switched) return false;
            return commitGroup();
        });
    }

    exitGroup(): Promise<boolean> {
        return this.setActiveGroup(null);
    }

    getRelativeGroupId(baseGroupId: string | null, offset: number): string | null | undefined {
        if (!this.isGroupFeatureEnabled()) return undefined;
        const ordered = this.getOrderedGroups();
        if (ordered.length === 0) return undefined;
        const currentId = baseGroupId || null;
        if (!currentId) {
            const edgeIdx = offset > 0 ? 0 : ordered.length - 1;
            return ordered[edgeIdx].id;
        }
        let currentIdx = -1;
        for (let i = 0; i < ordered.length; i++) {
            if (ordered[i].id === currentId) {
                currentIdx = i;
                break;
            }
        }
        if (currentIdx === -1) return ordered[0].id;
        const nextIdx = currentIdx + offset;
        if (nextIdx < 0 || nextIdx >= ordered.length) return null;
        return ordered[nextIdx].id;
    }

    resolveGroupSelection(
        groupId: string | null,
    ): Promise<{ switched: boolean; targetGroupId: string | null; resolvedGroupId: string | null; sessions: Session[] }> {
        if (!this.isGroupFeatureEnabled()) {
            return Promise.resolve({
                switched: false,
                targetGroupId: null,
                resolvedGroupId: null,
                sessions: this.getOrderedSessionsUnfiltered(),
            });
        }
        const targetGroupId = groupId || null;
        const targetSessions = this.getOrderedSessionsForGroup(targetGroupId);
        return this.setActiveGroup(targetGroupId).then((switched) => {
            let resolvedGroupId: string | null;
            if (switched) resolvedGroupId = this.data.activeGroupId || null;
            else if (targetSessions.length === 0) resolvedGroupId = targetGroupId;
            else resolvedGroupId = this.data.activeGroupId || null;
            return {
                switched,
                targetGroupId,
                resolvedGroupId,
                sessions: this.getOrderedSessionsForGroup(resolvedGroupId),
            };
        });
    }

    switchGroupRelative(offset: number): Promise<boolean> {
        if (!this.isGroupFeatureEnabled()) return Promise.resolve(false);
        const targetGroupId = this.getRelativeGroupId(this.data.activeGroupId, offset);
        if (typeof targetGroupId === 'undefined') return Promise.resolve(false);
        return this.setActiveGroup(targetGroupId);
    }

    removeGroupMembershipFromAllSessions(groupId: string, options?: { persist?: boolean }): Promise<boolean> {
        if (!groupId) return Promise.resolve(false);
        const sg = this.data.sessionGroups || {};
        let changed = false;
        for (const key of Object.keys(sg)) {
            const arr = sg[key];
            const idx = arr.indexOf(groupId);
            if (idx !== -1) {
                arr.splice(idx, 1);
                changed = true;
                if (arr.length === 0) delete sg[key];
            }
        }
        if (!changed) return Promise.resolve(false);
        this.syncSessionCommands();
        if (options && options.persist === false) return Promise.resolve(true);
        return this.persistData().then(() => true);
    }

    removeAllSessionsFromGroup(groupId: string, options?: { persist?: boolean }): Promise<boolean> {
        if (!groupId) return Promise.resolve(false);
        const groups = this.data.groups || {};
        if (!groups[groupId]) return Promise.resolve(false);
        return this.removeGroupMembershipFromAllSessions(groupId, options);
    }

    moveSessionToGroupExclusive(sessionId: string, groupId: string, options?: { persist?: boolean }): Promise<boolean> {
        if (!this.data.sessions[sessionId]) return Promise.resolve(false);
        if (!this.data.groups || !this.data.groups[groupId]) return Promise.resolve(false);
        if (!this.data.sessionGroups) this.data.sessionGroups = {};
        const prev = this.data.sessionGroups[sessionId] || [];
        const changed = prev.length !== 1 || prev[0] !== groupId;
        if (!changed) return Promise.resolve(false);
        this.data.sessionGroups[sessionId] = [groupId];
        this.syncSessionCommands();
        if (options && options.persist === false) return Promise.resolve(true);
        return this.persistData().then(() => true);
    }

    clearAllGroups(options?: { persist?: boolean }): Promise<boolean> {
        const groupCount = Object.keys(this.data.groups || {}).length;
        const sessionGroupCount = Object.keys(this.data.sessionGroups || {}).length;
        const hasActiveGroup = !!this.data.activeGroupId;
        const hadCustomOrder = Array.isArray(this.data.groupOrder)
            ? this.data.groupOrder.some((id) => id !== '__all__')
            : false;
        const changed = groupCount > 0 || sessionGroupCount > 0 || hasActiveGroup || hadCustomOrder;

        this.data.sessionGroups = {};
        this.data.groups = {};
        this.data.groupOrder = this.normalizeGroupTabOrder([]);
        this.data.activeGroupId = null;
        this.syncSessionCommands();
        this.updateStatusBar();
        if (!changed) return Promise.resolve(false);
        if (options && options.persist === false) return Promise.resolve(true);
        return this.persistData().then(() => true);
    }

    addSessionToGroup(sessionId: string, groupId: string): Promise<boolean> {
        if (!this.data.sessions[sessionId]) return Promise.resolve(false);
        if (!this.data.groups || !this.data.groups[groupId]) return Promise.resolve(false);
        if (!this.data.sessionGroups) this.data.sessionGroups = {};
        if (!this.data.sessionGroups[sessionId]) this.data.sessionGroups[sessionId] = [];
        if (this.data.sessionGroups[sessionId].indexOf(groupId) !== -1) return Promise.resolve(false);
        this.data.sessionGroups[sessionId].push(groupId);
        this.syncSessionCommands();
        return this.persistData().then(() => true);
    }

    removeSessionFromGroup(sessionId: string, groupId: string): Promise<boolean> {
        if (!this.data.sessionGroups || !this.data.sessionGroups[sessionId]) return Promise.resolve(false);
        const arr = this.data.sessionGroups[sessionId];
        const idx = arr.indexOf(groupId);
        if (idx === -1) return Promise.resolve(false);
        arr.splice(idx, 1);
        if (arr.length === 0) delete this.data.sessionGroups[sessionId];
        this.syncSessionCommands();
        return this.persistData().then(() => true);
    }

    getGroupSessionIds(groupId: string): string[] {
        const sg = this.data.sessionGroups || {};
        const result: string[] = [];
        for (const key of Object.keys(sg)) {
            if (sg[key].indexOf(groupId) !== -1) result.push(key);
        }
        return result;
    }

    // ========================================================================
    // session-commands.js
    // ========================================================================
    syncSessionCommands(): void {
        const L = i18n.L;
        const ordered = this.getOrderedSessions();

        const oldIds = this._dynamicSessionCommandIds || [];
        for (const id of oldIds) this.removeCommand(id);
        this._dynamicSessionCommandIds = [];

        let dynamicStart: number;
        if (this.data.numberedSwitchCommands) {
            for (let n = 1; n <= 9; n++) {
                const num = n;
                this.removeCommand('switch-to-' + num);
                const session = ordered[num - 1];
                this.addCommand({
                    id: 'switch-to-' + num,
                    name: L.cmdSwitchTo(num, session ? session.name : undefined),
                    checkCallback: (checking: boolean): boolean => {
                        if (!this.data.showActiveSwitchCommand) {
                            const currentOrdered = this.getOrderedSessions();
                            const targetSession = currentOrdered[num - 1];
                            if (targetSession && targetSession.id === this.data.activeSessionId) return false;
                        }
                        if (!checking) void this.switchToIndex(num - 1);
                        return true;
                    },
                });
            }
            dynamicStart = 9;
        } else {
            for (let n = 1; n <= 9; n++) this.removeCommand('switch-to-' + n);
            dynamicStart = 0;
        }

        for (let j = dynamicStart; j < ordered.length; j++) {
            const session = ordered[j];
            const cmdId = 'switch-to-named-' + session.id;
            this.addCommand({
                id: cmdId,
                name: L.cmdSwitchToNamed(session.name),
                checkCallback: (checking: boolean): boolean => {
                    if (!this.data.showActiveSwitchCommand) {
                        if (session.id === this.data.activeSessionId) return false;
                    }
                    if (!checking) void this.switchSessionByIdFromCommand(session.id);
                    return true;
                },
            });
            this._dynamicSessionCommandIds.push(cmdId);
        }
    }

    // ========================================================================
    // settings-state.js
    // ========================================================================
    private persistIfNeeded(options?: { persist?: boolean }): Promise<unknown> {
        if (options && options.persist === false) return Promise.resolve(true);
        return this.persistData();
    }

    setLanguageSetting(value: string, options?: { persist?: boolean }): Promise<unknown> {
        this.data.language = value || 'auto';
        i18n.resolveLocale(this.data.language as string);
        return this.persistIfNeeded(options);
    }

    setStatusBarAction(slotKey: string, actionId: string, options?: { persist?: boolean }): Promise<unknown> {
        if (!this.data.statusBarActions) {
            this.data.statusBarActions = Object.assign({}, DEFAULT_DATA.statusBarActions);
        }
        this.data.statusBarActions[slotKey] = actionId;
        return this.persistIfNeeded(options);
    }

    setWarnOnUnsavedSwitch(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.warnOnUnsavedSwitch = !!enabled;
        return this.persistIfNeeded(options);
    }

    setUnsavedStatusBarHighlight(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.highlightUnsavedSessionChanges = !!enabled;
        this.updateStatusBar();
        return this.persistIfNeeded(options);
    }

    setConfirmQuickActions(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.confirmQuickActions = !!enabled;
        return this.persistIfNeeded(options);
    }

    setRestoreSidebars(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.restoreSidebars = !!enabled;
        return this.persistIfNeeded(options);
    }

    setStatusBarModScrollSwitch(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.statusBarModScrollSwitch = !!enabled;
        return this.persistIfNeeded(options);
    }

    setStatusBarScrollPreset(value: string, options?: { persist?: boolean }): Promise<unknown> {
        this.data.statusBarScrollPreset = value || 'trackpad';
        return this.persistIfNeeded(options);
    }

    setStatusBarScrollModifierMode(value: string, options?: { persist?: boolean }): Promise<unknown> {
        this.data.statusBarScrollModifierMode = value || 'none';
        return this.persistIfNeeded(options);
    }

    setStatusBarScrollThreshold(value: string | number, options?: { persist?: boolean }): Promise<unknown> {
        this.data.statusBarScrollThreshold = Number(value) || 30;
        return this.persistIfNeeded(options);
    }

    setStatusBarScrollCooldownMs(value: string | number, options?: { persist?: boolean }): Promise<unknown> {
        this.data.statusBarScrollCooldownMs = Number(value) || 500;
        return this.persistIfNeeded(options);
    }

    setStatusBarScrollResetMs(value: string | number, options?: { persist?: boolean }): Promise<unknown> {
        this.data.statusBarScrollResetMs = Number(value) || 250;
        return this.persistIfNeeded(options);
    }

    setStatusBarScrollInvert(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.statusBarScrollInvert = !!enabled;
        return this.persistIfNeeded(options);
    }

    setShowActiveSwitchCommand(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.showActiveSwitchCommand = !!enabled;
        return this.persistIfNeeded(options);
    }

    setNumberedSwitchCommands(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.numberedSwitchCommands = !!enabled;
        this.syncSessionCommands();
        return this.persistIfNeeded(options);
    }

    setSwitchPreviewEnabled(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.previewNext = !!enabled;
        this.data.previewPrevious = !!enabled;
        return this.persistIfNeeded(options);
    }

    setPreviewNext(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.previewNext = !!enabled;
        return this.persistIfNeeded(options);
    }

    setPreviewPrevious(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.previewPrevious = !!enabled;
        return this.persistIfNeeded(options);
    }

    setShowFilterInput(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.showFilterInput = !!enabled;
        return this.persistIfNeeded(options);
    }

    setOverlayDefaultFocus(value: string, options?: { persist?: boolean }): Promise<unknown> {
        this.data.overlayDefaultFocus = value || 'current-session';
        return this.persistIfNeeded(options);
    }

    setConfirmDeleteByHotkey(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.confirmDeleteByHotkey = !!enabled;
        return this.persistIfNeeded(options);
    }

    setVersionHistoryEnabled(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.versionHistoryEnabled = !!enabled;
        if (this.data.versionHistoryEnabled) this.startHistorySnapshotTimer();
        else this.stopHistorySnapshotTimer();
        return this.persistIfNeeded(options);
    }

    setVersionHistorySnapshotInterval(value: string | number, options?: { persist?: boolean }): Promise<unknown> {
        this.data.versionHistorySnapshotInterval = parseInt(String(value), 10);
        this.startHistorySnapshotTimer();
        return this.persistIfNeeded(options);
    }

    setVersionHistoryConfirmRestore(enabled: boolean, options?: { persist?: boolean }): Promise<unknown> {
        this.data.versionHistoryConfirmRestore = !!enabled;
        return this.persistIfNeeded(options);
    }

    /** Status-bar session-name colour setting; drives the CSS custom property. */
    setStatusBarNameColor(value: string, options?: { persist?: boolean }): Promise<unknown> {
        this.data.statusBarNameColor = typeof value === 'string' ? value : '';
        this.updateStatusBar();
        return this.persistIfNeeded(options);
    }

    // ========================================================================
    // history.js — version-history data logic
    // ========================================================================
    isVersionHistoryEnabled(): boolean {
        return !!this.data.versionHistoryEnabled;
    }

    getVersionHistorySnapshotInterval(): number {
        const val = this.data.versionHistorySnapshotInterval;
        if (typeof val !== 'number' || val < 1) return 5;
        return val;
    }

    isVersionHistoryCtrlRmbEnabled(): boolean {
        return this.data.versionHistoryCtrlRmbRestore !== false;
    }

    isVersionHistoryConfirmRestoreEnabled(): boolean {
        return this.data.versionHistoryConfirmRestore !== false;
    }

    extractFilePathsFromLayout(layout: unknown): string[] {
        const paths: string[] = [];
        const walk = (node: unknown): void => {
            if (!node || typeof node !== 'object') return;
            const n = node as Record<string, unknown>;
            const state = n.state as Record<string, unknown> | undefined;
            const innerState = state?.state as Record<string, unknown> | undefined;
            if (n.type === 'leaf' && innerState && innerState.file) paths.push(innerState.file as string);
            if (Array.isArray(n.children)) for (const child of n.children) walk(child);
            if (n.main) walk(n.main);
            if (n.left) walk(n.left);
            if (n.right) walk(n.right);
        };
        walk(layout);
        return paths;
    }

    countPanesInLayout(layout: unknown): number {
        let count = 0;
        const walk = (node: unknown): void => {
            if (!node || typeof node !== 'object') return;
            const n = node as Record<string, unknown>;
            if (n.type === 'leaf') {
                count++;
                return;
            }
            if (Array.isArray(n.children)) for (const child of n.children) walk(child);
            if (n.main) walk(n.main);
        };
        const root = layout as Record<string, unknown> | null;
        if (root && root.main) walk(root.main);
        return count;
    }

    compactHistory(history: HistoryEntry[]): HistoryEntry[] {
        if (!history || history.length === 0) return [];
        const now = Date.now();
        history.sort((a, b) => b.savedAt - a.savedAt);
        const result: HistoryEntry[] = [];
        const buckets: Record<string, boolean> = {};

        for (const entry of history) {
            const age = now - entry.savedAt;
            let key: string;
            if (age <= HOUR) {
                result.push(entry);
            } else if (age <= DAY) {
                key = 'h' + Math.floor(age / HOUR);
                if (!buckets[key]) {
                    buckets[key] = true;
                    result.push(entry);
                }
            } else if (age <= WEEK) {
                key = 'd' + Math.floor(age / DAY);
                if (!buckets[key]) {
                    buckets[key] = true;
                    result.push(entry);
                }
            } else if (age <= 30 * DAY) {
                key = 'w' + Math.floor(age / WEEK);
                if (!buckets[key]) {
                    buckets[key] = true;
                    result.push(entry);
                }
            }
        }
        if (result.length > MAX_HISTORY) result.length = MAX_HISTORY;
        return result;
    }

    pushLayoutToHistory(session: Session | null): void {
        if (!this.isVersionHistoryEnabled()) return;
        if (!session || !session.layout) return;
        if (!session.history) session.history = [];
        const lastEntry = session.history.length > 0 ? session.history[0] : null;
        if (lastEntry && this.layoutsEqualStructural(session.layout, lastEntry.layout)) return;
        session.history.unshift({ layout: layoutUtils.cloneLayout(session.layout), savedAt: Date.now() });
        session.history = this.compactHistory(session.history);
    }

    restoreFromHistoryEntry(sessionId: string, entryIndex: number): Promise<boolean> {
        const session = this.data.sessions[sessionId];
        if (!session || !session.history || !session.history[entryIndex]) return Promise.resolve(false);
        const entry = session.history[entryIndex];
        this.pushLayoutToHistory(session);
        session.layout = layoutUtils.cloneLayout(entry.layout);
        session.modified = Date.now();
        const isActive = session.id === this.data.activeSessionId;
        const applyLayout = isActive && session.layout ? this.applyWorkspaceLayout(session.layout) : Promise.resolve();
        return applyLayout
            .then(() => {
                this.updateStatusBar();
                return this.persistData();
            })
            .then(() => true);
    }

    quickRestoreLatestHistory(): Promise<boolean> {
        const L = i18n.L;
        const session = this.getActiveSession();
        if (!session || !session.history || session.history.length === 0) {
            this.notify(L.historyNoEntries);
            return Promise.resolve(false);
        }
        return this.restoreFromHistoryEntry(session.id, 0).then((ok) => {
            if (ok) this.notify(L.historyQuickRestored(session.name));
            return ok;
        });
    }

    clearVersionHistoryEntries(): boolean {
        const sessions = (this.data && this.data.sessions) || {};
        let changed = false;
        for (const id of Object.keys(sessions)) {
            const session = sessions[id];
            if (!session || !Object.prototype.hasOwnProperty.call(session, 'history')) continue;
            delete session.history;
            changed = true;
        }
        return changed;
    }

    startHistorySnapshotTimer(): void {
        this.stopHistorySnapshotTimer();
        if (!this.isVersionHistoryEnabled()) return;
        if (!this.isAutoSaveOnSwitchEnabled()) return;
        const intervalMs = this.getVersionHistorySnapshotInterval() * 60000;
        this._historySnapshotTimer = setInterval(() => {
            if (!this.isVersionHistoryEnabled() || !this.isAutoSaveOnSwitchEnabled()) {
                this.stopHistorySnapshotTimer();
                return;
            }
            const session = this.getActiveSession();
            if (!session) return;
            const currentLayout = this.getCurrentWorkspaceLayout();
            if (this.layoutsEqualStructural(session.layout, currentLayout)) return;
            this.pushLayoutToHistory(session);
            session.layout = currentLayout;
            session.modified = Date.now();
            void this.persistData();
        }, intervalMs);
    }

    stopHistorySnapshotTimer(): void {
        if (this._historySnapshotTimer) {
            clearInterval(this._historySnapshotTimer);
            this._historySnapshotTimer = null;
        }
    }
}
