// PersistenceService: multi-file, sync-friendly storage + the conflict-free merge
// orchestration. No `obsidian` import — file I/O goes through an injected vault
// adapter (AppLike), platform info is injected, and Obsidian-side effects are
// collaborator methods. This keeps all merge business logic headless-testable.
//
// Storage layout (settled constraint):
//   {vault}/.obsidian/plugins/workspace-mgr/sessions/{session_id}.json  (per session)
//   {vault}/.obsidian/plugins/workspace-mgr/sessions/index.json          (the index)
// The legacy workspace-plus-plus location is never read or written.
import * as i18n from '../i18n';
import { generateId } from './utils';
import { DEFAULT_DATA } from './default-data';
import {
    cloneJson,
    getPersistStamp,
    getSessionModified,
    isSessionDataShape,
    mergeDiscoveredSessions,
    mergeObjectWithLocalDeletes,
    mergeOrder,
} from './sync';
import type { AppLike } from './host';
import type { Session, SessionData } from './types';

const EXTERNAL_SESSION_RELOAD_DEBOUNCE_MS = 500;
const SESSION_FILE_MTIME_EPSILON_MS = 25;
const BACKUP_ROTATION_INTERVAL = 3600000; // 1 hour

const SESSION_KEYS = [
    'activeSessionId',
    'sessions',
    'sessionOrder',
    'groups',
    'groupOrder',
    'sessionGroups',
    'activeGroupId',
] as const;

const SETTINGS_KEYS = [
    'language', 'previewNext', 'previewPrevious', 'confirmDeleteByHotkey', 'autoSaveOnSwitch',
    'warnOnUnsavedSwitch', 'highlightUnsavedSessionChanges', 'restoreSidebars', 'statusBarQuickSwitcher',
    'statusBarModScrollSwitch', 'groupFeatureEnabled', 'overlayDefaultFocus', 'searchOverlayPosition',
    'searchOverlaySize', 'versionHistoryEnabled', 'versionHistorySnapshotInterval', 'versionHistoryCtrlRmbRestore',
    'versionHistoryConfirmRestore', 'statusBarScrollPreset', 'statusBarScrollModifierMode', 'statusBarScrollThreshold',
    'statusBarScrollCooldownMs', 'statusBarScrollResetMs', 'statusBarScrollInvert', 'statusBarActions',
    'confirmQuickActions', 'showFilterInput', 'showActiveSwitchCommand', 'numberedSwitchCommands',
    'statusBarNameColorLight', 'statusBarNameColorDark', 'unsavedHighlightColorLight', 'unsavedHighlightColorDark',
];

export interface PlatformLike {
    isAndroidApp?: boolean;
    isIosApp?: boolean;
    isMacOS?: boolean;
    isWin?: boolean;
    isLinux?: boolean;
    isMobileApp?: boolean;
    isMobile?: boolean;
    isDesktopApp?: boolean;
    isDesktop?: boolean;
}

export interface ManifestLike {
    id: string;
    dir: string;
}

interface JsonReadResult {
    exists: boolean;
    data: unknown;
    error: unknown;
}

interface NormalizedSessionData {
    activeSessionId: string | null;
    sessions: Record<string, Session>;
    sessionOrder: string[];
    groups: Record<string, { id: string; name: string }>;
    groupOrder: string[];
    sessionGroups: Record<string, string[]>;
    activeGroupId: string | null;
}

function pickKeys<T extends Record<string, unknown>>(data: T | undefined, keys: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!data) return out;
    for (const key of keys) {
        if (data[key] !== undefined) out[key] = data[key];
    }
    return out;
}

function hasNonEmptySessions(data: unknown): boolean {
    const d = data as SessionData | undefined;
    return !!(d && d.sessions && typeof d.sessions === 'object' && Object.keys(d.sessions).length > 0);
}

export class PersistenceService {
    data!: SessionData;
    app!: AppLike;
    manifest!: ManifestLike;
    platform: PlatformLike = {};
    globalSettings: Record<string, unknown> | null = null;
    useLocalSettings = false;

    _sessionStorageStamp = 0;
    _sessionStorageMtime = 0;
    _sessionStorageComparableData: NormalizedSessionData | null = null;
    _sessionStorageDataJson = '';
    _lastPersistStamp = 0;
    _lastRotationBackupAt = 0;
    private _persistQueue: Promise<unknown> | null = null;
    private _persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private _externalReloadTimer: ReturnType<typeof setTimeout> | null = null;

    // --- Collaborators (wired by the shell to SessionService; stubbed by tests) ---
    syncSessionOrder(): void {}
    normalizeGroupFeatureState(): void {}
    updateStatusBar(): void {}
    syncSessionCommands(): void {}
    _refreshOverlaySessions?: () => void;
    normalizeGroupTabOrder(order: string[]): string[] {
        return order;
    }
    clearVersionHistoryEntries(): boolean {
        return false;
    }
    resetSessionsToDefault(): Promise<unknown> {
        return Promise.resolve();
    }
    notify(_message: string): void {}
    /** Persist the settings subset (wired by the shell to Obsidian's saveData). */
    saveSettings(): Promise<unknown> {
        return Promise.resolve();
    }

    // ========================================================================
    // Paths (multi-file layout under the plugin directory)
    // ========================================================================
    getSessionsDirPath(): string {
        return this.manifest.dir + '/sessions';
    }
    getIndexPath(): string {
        return this.getSessionsDirPath() + '/index.json';
    }
    /** Primary "sessions storage" path used by the sync methods = the index. */
    getSessionsPath(): string {
        return this.getIndexPath();
    }
    getSessionsBackupPath(): string {
        return this.getSessionsDirPath() + '/index.backup.json';
    }
    getSessionFilePath(sessionId: string): string {
        return this.getSessionsDirPath() + '/' + sessionId + '.json';
    }
    getBackupPath(): string {
        return this.manifest.dir + '/data.backup.json';
    }
    getBackupsDirPath(): string {
        return this.manifest.dir + '/backups';
    }
    getRotationBackupPath(generation: number): string {
        return this.getBackupsDirPath() + '/sessions.' + generation + '.json';
    }
    getBackupFilePaths(): string[] {
        return [
            this.getSessionsBackupPath(),
            this.getBackupPath(),
            this.getRotationBackupPath(1),
            this.getRotationBackupPath(2),
            this.getRotationBackupPath(3),
        ];
    }

    // ========================================================================
    // Normalization / extraction
    // ========================================================================
    normalizeSessionData(raw: Partial<SessionData> | undefined): NormalizedSessionData {
        const sessions = raw && raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {};
        const rawOrder = Array.isArray(raw && raw.sessionOrder) ? (raw!.sessionOrder as string[]) : Object.keys(sessions);
        const seen: Record<string, boolean> = {};
        const order: string[] = [];
        for (const id of rawOrder) {
            if (!sessions[id] || seen[id]) continue;
            seen[id] = true;
            order.push(id);
        }
        for (const id of Object.keys(sessions)) {
            if (seen[id]) continue;
            seen[id] = true;
            order.push(id);
        }

        let active = raw && typeof raw.activeSessionId === 'string' ? raw.activeSessionId : null;
        if (active && !sessions[active]) active = null;
        if (!active && order.length > 0) active = order[0];

        const groups = raw && raw.groups && typeof raw.groups === 'object' ? raw.groups : {};
        const rawGroupOrder = Array.isArray(raw && raw.groupOrder) ? (raw!.groupOrder as string[]) : Object.keys(groups);
        const seenGroups: Record<string, boolean> = {};
        const groupOrder: string[] = [];
        for (const gid of rawGroupOrder) {
            if (gid !== '__all__' && !groups[gid]) continue;
            if (seenGroups[gid]) continue;
            seenGroups[gid] = true;
            groupOrder.push(gid);
        }
        for (const gid of Object.keys(groups)) {
            if (seenGroups[gid]) continue;
            seenGroups[gid] = true;
            groupOrder.push(gid);
        }

        const sessionGroups = raw && raw.sessionGroups && typeof raw.sessionGroups === 'object' ? raw.sessionGroups : {};
        const sessionGroupsCleaned: Record<string, string[]> = {};
        for (const sid of Object.keys(sessionGroups)) {
            if (!sessions[sid]) continue;
            const gids = Array.isArray(sessionGroups[sid]) ? sessionGroups[sid] : [];
            const validGids = gids.filter((g) => !!groups[g]);
            if (validGids.length > 0) sessionGroupsCleaned[sid] = validGids;
        }

        const activeGroupId =
            raw && typeof raw.activeGroupId === 'string' && groups[raw.activeGroupId] ? raw.activeGroupId : null;

        return {
            activeSessionId: active,
            sessions,
            sessionOrder: order,
            groups,
            groupOrder,
            sessionGroups: sessionGroupsCleaned,
            activeGroupId,
        };
    }

    extractSessionData(data: Partial<SessionData> | undefined): NormalizedSessionData {
        return this.normalizeSessionData(pickKeys(data as Record<string, unknown>, SESSION_KEYS) as Partial<SessionData>);
    }

    extractSettingsData(data: Partial<SessionData> | undefined): Record<string, unknown> {
        return pickKeys(data as Record<string, unknown>, SETTINGS_KEYS);
    }

    getDefaultSettingsData(): Record<string, unknown> {
        return pickKeys(DEFAULT_DATA as unknown as Record<string, unknown>, SETTINGS_KEYS);
    }

    getDefaultSessionData(): Record<string, unknown> {
        return pickKeys(DEFAULT_DATA as unknown as Record<string, unknown>, SESSION_KEYS);
    }

    // ========================================================================
    // Comparable-state tracking (baseline for merges)
    // ========================================================================
    getComparableSessionData(data: Partial<SessionData> | undefined): Pick<
        NormalizedSessionData,
        'sessions' | 'sessionOrder' | 'groups' | 'groupOrder' | 'sessionGroups'
    > {
        const n = this.normalizeSessionData(data || {});
        return {
            sessions: n.sessions || {},
            sessionOrder: n.sessionOrder || [],
            groups: n.groups || {},
            groupOrder: n.groupOrder || [],
            sessionGroups: n.sessionGroups || {},
        };
    }

    getComparableSessionDataJson(data: Partial<SessionData> | undefined): string {
        return JSON.stringify(this.getComparableSessionData(data));
    }

    recordSessionStorageState(stamp: number, mtime: number, data?: Partial<SessionData>): void {
        this._sessionStorageStamp = typeof stamp === 'number' && isFinite(stamp) ? stamp : 0;
        this._sessionStorageMtime = typeof mtime === 'number' && isFinite(mtime) ? mtime : 0;
        if (data) {
            const comparable = this.getComparableSessionData(data);
            this._sessionStorageComparableData = cloneJson(comparable) as unknown as NormalizedSessionData;
            this._sessionStorageDataJson = JSON.stringify(comparable);
        }
    }

    recordSessionDataStored(sessionData: Partial<SessionData>): Promise<boolean> {
        const stamp = getPersistStamp(sessionData);
        this.recordSessionStorageState(stamp, Date.now(), sessionData);
        return this.getFileMtime(this.getSessionsPath())
            .then((mtime) => {
                this.recordSessionStorageState(stamp, mtime || this._sessionStorageMtime || 0, sessionData);
                return true;
            })
            .catch(() => true);
    }

    getSessionStorageInfo(): Promise<{ exists: boolean; valid: boolean; data: unknown; stamp: number; mtime: number; path: string }> {
        const path = this.getSessionsPath();
        return Promise.all([this.readJsonIfExists(path), this.getFileMtime(path)]).then(([res, mtime]) => {
            const valid = !!(res.exists && !res.error && isSessionDataShape(res.data));
            return {
                exists: !!res.exists,
                valid,
                data: valid ? res.data : null,
                stamp: valid ? getPersistStamp(res.data) : 0,
                mtime: mtime || 0,
                path,
            };
        });
    }

    isSessionStorageInfoNewer(info: { valid: boolean; stamp: number; mtime: number } | null): boolean {
        if (!info || !info.valid) return false;
        const currentStamp = this._sessionStorageStamp || 0;
        const currentMtime = this._sessionStorageMtime || 0;
        const nextStamp = info.stamp || 0;
        const nextMtime = info.mtime || 0;
        if (nextStamp && currentStamp) {
            if (nextStamp > currentStamp) return true;
            if (nextStamp < currentStamp) return false;
        } else if (nextStamp && !currentStamp) {
            return true;
        }
        return nextMtime > currentMtime + SESSION_FILE_MTIME_EPSILON_MS;
    }

    hasLocalSessionChangesSinceStorage(): boolean {
        if (!this._sessionStorageDataJson) return false;
        return this.getComparableSessionDataJson(this.data || {}) !== this._sessionStorageDataJson;
    }

    // ========================================================================
    // Merge (union-merge index, last-writer-wins by modified, local deletes)
    // ========================================================================
    mergeExternalSessionDataForWrite(externalData: Partial<SessionData>): NormalizedSessionData {
        const local = this.extractSessionData(this.data || {});
        const external = this.normalizeSessionData(externalData || {});
        const baseline = this._sessionStorageComparableData || ({} as Partial<NormalizedSessionData>);
        const baselineSessions = baseline.sessions || {};
        const localSessions = local.sessions || {};
        const externalSessions = external.sessions || {};
        const mergedSessions: Record<string, Session> = {};

        for (const id of Object.keys(externalSessions)) {
            if (
                baselineSessions[id] &&
                !localSessions[id] &&
                getSessionModified(externalSessions[id]) <= getSessionModified(baselineSessions[id])
            ) {
                continue;
            }
            mergedSessions[id] = cloneJson(externalSessions[id]);
        }
        for (const id of Object.keys(localSessions)) {
            if (!mergedSessions[id]) {
                mergedSessions[id] = cloneJson(localSessions[id]);
                continue;
            }
            if (getSessionModified(localSessions[id]) >= getSessionModified(mergedSessions[id])) {
                mergedSessions[id] = cloneJson(localSessions[id]);
            }
        }

        const groups = mergeObjectWithLocalDeletes(external.groups, local.groups, baseline.groups);
        const sessionGroups = mergeObjectWithLocalDeletes(external.sessionGroups, local.sessionGroups, baseline.sessionGroups);

        return this.normalizeSessionData({
            activeSessionId: local.activeSessionId || external.activeSessionId,
            sessions: mergedSessions,
            sessionOrder: mergeOrder(external.sessionOrder, local.sessionOrder, mergedSessions),
            groups,
            groupOrder: mergeOrder(external.groupOrder, local.groupOrder, groups),
            sessionGroups,
            activeGroupId: local.activeGroupId || external.activeGroupId,
        } as Partial<SessionData>);
    }

    applySessionDataFromStorage(sessionData: Partial<SessionData> | null, options?: { mergeLocal?: boolean }): boolean {
        const opts = options || {};
        if (!sessionData) return false;

        const localActiveSessionId = this.data && this.data.activeSessionId;
        const localActiveGroupId = this.data && this.data.activeGroupId;
        const next = opts.mergeLocal
            ? this.mergeExternalSessionDataForWrite(sessionData)
            : this.normalizeSessionData(sessionData);

        this.data.sessions = next.sessions || {};
        this.data.sessionOrder = next.sessionOrder || [];
        this.data.groups = next.groups || {};
        this.data.groupOrder = next.groupOrder || [];
        this.data.sessionGroups = next.sessionGroups || {};

        if (localActiveSessionId && this.data.sessions[localActiveSessionId]) {
            this.data.activeSessionId = localActiveSessionId;
        } else if (next.activeSessionId && this.data.sessions[next.activeSessionId]) {
            this.data.activeSessionId = next.activeSessionId;
        } else {
            this.data.activeSessionId = this.data.sessionOrder[0] || Object.keys(this.data.sessions)[0] || null;
        }

        if (localActiveGroupId && this.data.groups[localActiveGroupId]) {
            this.data.activeGroupId = localActiveGroupId;
        } else if (next.activeGroupId && this.data.groups[next.activeGroupId]) {
            this.data.activeGroupId = next.activeGroupId;
        } else {
            this.data.activeGroupId = null;
        }

        this.syncSessionOrder();
        this.normalizeGroupFeatureState();
        this.updateStatusBar();
        this.syncSessionCommands();
        if (typeof this._refreshOverlaySessions === 'function') this._refreshOverlaySessions();
        return true;
    }

    reloadExternalSessionStorageIfChanged(options?: { force?: boolean; mergeLocal?: boolean }): Promise<boolean> {
        const opts = options || {};
        return this.getSessionStorageInfo()
            .then((info) => {
                if (!opts.force && !this.isSessionStorageInfoNewer(info)) return false;
                const mergeLocal = !!opts.mergeLocal && this.hasLocalSessionChangesSinceStorage();
                const previousComparable = this._sessionStorageComparableData
                    ? (cloneJson(this._sessionStorageComparableData) as NormalizedSessionData)
                    : null;
                const previousComparableJson = this._sessionStorageDataJson || '';
                return this.loadSessionDataFromStorage().then((sessionData) => {
                    if (!sessionData) return false;
                    const externalComparable = this._sessionStorageComparableData
                        ? (cloneJson(this._sessionStorageComparableData) as NormalizedSessionData)
                        : null;
                    const externalComparableJson = this._sessionStorageDataJson || '';
                    if (mergeLocal && previousComparable) {
                        this._sessionStorageComparableData = previousComparable;
                        this._sessionStorageDataJson = previousComparableJson;
                    }
                    const applied = this.applySessionDataFromStorage(sessionData, { mergeLocal });
                    if (mergeLocal && externalComparable) {
                        this._sessionStorageComparableData = externalComparable;
                        this._sessionStorageDataJson = externalComparableJson;
                    }
                    return applied;
                });
            })
            .catch(() => false);
    }

    scheduleExternalSessionStorageReload(): void {
        if (this._externalReloadTimer) clearTimeout(this._externalReloadTimer);
        this._externalReloadTimer = setTimeout(() => {
            this._externalReloadTimer = null;
            void this.reloadExternalSessionStorageIfChanged({ mergeLocal: false });
        }, EXTERNAL_SESSION_RELOAD_DEBOUNCE_MS);
    }

    clearSessionStorageSyncTimers(): void {
        if (this._externalReloadTimer) {
            clearTimeout(this._externalReloadTimer);
            this._externalReloadTimer = null;
        }
    }

    // ========================================================================
    // Adapter helpers
    // ========================================================================
    private adapter() {
        if (!this.app.vault) throw new Error('vault adapter unavailable');
        return this.app.vault.adapter;
    }

    ensureDir(path: string): Promise<void> {
        const adapter = this.adapter();
        return adapter.exists(path).then((exists) => {
            if (exists) return;
            return (adapter.mkdir ? adapter.mkdir(path) : Promise.resolve()).catch(() =>
                adapter.exists(path).then((existsAfter) => {
                    if (!existsAfter) throw new Error('Failed to create directory: ' + path);
                }),
            );
        });
    }

    getFileMtime(path: string): Promise<number> {
        const adapter = this.adapter();
        if (!adapter.stat) return Promise.resolve(0);
        return adapter
            .stat(path)
            .then((stat) => (stat && typeof stat.mtime === 'number' ? stat.mtime : 0))
            .catch(() => 0);
    }

    readJsonIfExists(path: string): Promise<JsonReadResult> {
        const adapter = this.adapter();
        return adapter.exists(path).then((exists) => {
            if (!exists) return { exists: false, data: null, error: null };
            return adapter
                .read!(path)
                .then((raw) => {
                    try {
                        return { exists: true, data: JSON.parse(raw), error: null };
                    } catch (e) {
                        return { exists: true, data: null, error: e };
                    }
                })
                .catch((e) => ({ exists: true, data: null, error: e }));
        });
    }

    writeJson(path: string, data: unknown, pretty?: boolean): Promise<void> {
        const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
        return this.adapter().write!(path, json);
    }

    writeJsonWithBackup(path: string, backupPath: string, data: unknown, pretty?: boolean): Promise<void> {
        return this.writeJson(backupPath, data, pretty).then(() => this.writeJson(path, data, pretty));
    }

    removeIfExists(path: string): Promise<void> {
        const adapter = this.adapter();
        return adapter.exists(path).then((exists) => {
            if (!exists) return;
            return adapter.remove(path).catch(() => undefined);
        });
    }

    // ========================================================================
    // Multi-file load: index.json + orphan discovery
    // ========================================================================
    /**
     * Scan the sessions directory for {id}.json files not present in `intoData`
     * and union-merge them (reconciling id collisions by modified-time with
     * duplicate-on-conflict). Never deletes a session.
     */
    scanAndMergeOrphanSessions(intoData: SessionData): Promise<SessionData> {
        const adapter = this.adapter();
        if (!adapter.list) return Promise.resolve(intoData);
        const dir = this.getSessionsDirPath();
        return adapter
            .list(dir)
            .then((listed) => {
                const files = (listed && listed.files) || [];
                const sessionFiles = files.filter((p) => /\/[^/]+\.json$/i.test(p) && p !== this.getIndexPath() && p !== this.getSessionsBackupPath());
                return Promise.all(
                    sessionFiles.map((p) =>
                        this.readJsonIfExists(p).then((res) => (res.exists && !res.error ? (res.data as Session) : null)),
                    ),
                );
            })
            .then((sessions) => {
                const discovered = sessions.filter((s): s is Session => !!s && typeof s.id === 'string');
                if (discovered.length === 0) return intoData;
                const { merged } = mergeDiscoveredSessions(intoData, discovered, { generateId });
                return merged;
            })
            .catch(() => intoData);
    }

    loadSessionDataFromStorage(): Promise<SessionData | null> {
        const indexPath = this.getSessionsPath();
        const backupPath = this.getSessionsBackupPath();
        return Promise.all([
            this.readJsonIfExists(indexPath),
            this.readJsonIfExists(backupPath),
            this.getFileMtime(indexPath),
            this.getFileMtime(backupPath),
        ]).then(([mainRes, backupRes, mainMtime, backupMtime]) => {
            const mainValid = mainRes.exists && !mainRes.error && isSessionDataShape(mainRes.data);
            const backupValid = backupRes.exists && !backupRes.error && isSessionDataShape(backupRes.data);
            const mainStamp = mainValid ? getPersistStamp(mainRes.data) : 0;
            const backupStamp = backupValid ? getPersistStamp(backupRes.data) : 0;
            if (!mainValid && !backupValid) return null;

            let useBackup = false;
            if (!mainValid && backupValid) useBackup = true;
            else if (mainValid && backupValid) {
                if (backupStamp > mainStamp) useBackup = true;
                else if (backupStamp === mainStamp && (backupMtime || 0) > (mainMtime || 0)) useBackup = true;
            }

            const chosenRaw = useBackup ? backupRes.data : mainRes.data;
            const chosenStamp = useBackup ? backupStamp : mainStamp;
            const chosenMtime = useBackup ? backupMtime : mainMtime;
            const normalized = this.normalizeSessionData(chosenRaw as Partial<SessionData>) as unknown as SessionData;
            return this.scanAndMergeOrphanSessions(normalized).then((withOrphans) => {
                this.recordSessionStorageState(chosenStamp, chosenMtime || 0, withOrphans);
                return withOrphans;
            });
        });
    }

    // ========================================================================
    // Multi-file write + serialization queue + debounce
    // ========================================================================
    persistDataImmediate(): Promise<unknown> {
        const syncBeforeWrite = this.reloadExternalSessionStorageIfChanged({ mergeLocal: true });
        return syncBeforeWrite.then(() => {
            const sessionData = this.extractSessionData(this.data) as unknown as SessionData;
            let now = Date.now();
            if (typeof this._lastPersistStamp === 'number' && now <= this._lastPersistStamp) {
                now = this._lastPersistStamp + 1;
            }
            this._lastPersistStamp = now;
            (sessionData as unknown as Record<string, unknown>)._wppSavedAt = now;

            return this.ensureDir(this.getSessionsDirPath())
                .then(() => this.writeJsonWithBackup(this.getIndexPath(), this.getSessionsBackupPath(), sessionData))
                .then(() => this.writeIndividualSessionFiles(sessionData))
                .then(() => this.recordSessionDataStored(sessionData))
                .then(() => this.rotateBackupIfNeeded(sessionData))
                .then(() => this.saveSettings());
        });
    }

    /** Write each session to its own {id}.json file (per-session sync granularity). */
    private writeIndividualSessionFiles(sessionData: SessionData): Promise<void> {
        const sessions = sessionData.sessions || {};
        const ids = Object.keys(sessions);
        return ids
            .reduce(
                (chain, id) => chain.then(() => this.writeJson(this.getSessionFilePath(id), sessions[id])),
                Promise.resolve(),
            )
            .catch(() => undefined);
    }

    /** Serialize all writes through a promise queue so they never interleave. */
    persistData(): Promise<unknown> {
        if (!this._persistQueue) this._persistQueue = Promise.resolve();
        const next = this._persistQueue.catch(() => undefined).then(() => this.persistDataImmediate());
        this._persistQueue = next;
        return next;
    }

    flushPendingPersistence(): Promise<unknown> {
        if (!this._persistQueue) return Promise.resolve();
        return this._persistQueue.catch(() => undefined);
    }

    /**
     * Debounced persist: rapid calls within `debounceMs` collapse into a single
     * queued write. Used to avoid disk I/O thrash on frequent layout auto-saves.
     */
    requestPersist(debounceMs = 400): Promise<unknown> {
        if (this._persistDebounceTimer) clearTimeout(this._persistDebounceTimer);
        return new Promise((resolve) => {
            this._persistDebounceTimer = setTimeout(() => {
                this._persistDebounceTimer = null;
                resolve(this.persistData());
            }, debounceMs);
        });
    }

    cancelPendingPersistRequest(): void {
        if (this._persistDebounceTimer) {
            clearTimeout(this._persistDebounceTimer);
            this._persistDebounceTimer = null;
        }
    }

    // ========================================================================
    // Backups / rotation / reset
    // ========================================================================
    getBackupPlatformLabel(): string {
        const p = this.platform || {};
        if (p.isAndroidApp) return 'Android';
        if (p.isIosApp) return 'iOS';
        if (p.isMacOS) return 'macOS';
        if (p.isWin) return 'Windows';
        if (p.isLinux) return 'Linux';
        if (p.isMobileApp || p.isMobile) return 'Mobile';
        if (p.isDesktopApp || p.isDesktop) return 'Desktop';
        return '';
    }

    prepareRotationBackupData(sessionData: Record<string, unknown>): Record<string, unknown> {
        const backupData = Object.assign({}, sessionData);
        const platform = this.getBackupPlatformLabel();
        if (platform) backupData._wppBackupPlatform = platform;
        return backupData;
    }

    copyFileIfExists(srcPath: string, dstPath: string): Promise<void> {
        const adapter = this.adapter();
        return adapter.exists(srcPath).then((exists) => {
            if (!exists) return;
            return adapter.read!(srcPath).then((raw) => adapter.write!(dstPath, raw));
        });
    }

    rotateBackupIfNeeded(sessionData: Record<string, unknown>): Promise<void> {
        const now = Date.now();
        const last = this._lastRotationBackupAt || 0;
        if (now - last < BACKUP_ROTATION_INTERVAL) return Promise.resolve();
        this._lastRotationBackupAt = now;
        return this.ensureDir(this.getBackupsDirPath())
            .then(() => this.copyFileIfExists(this.getRotationBackupPath(2), this.getRotationBackupPath(3)))
            .then(() => this.copyFileIfExists(this.getRotationBackupPath(1), this.getRotationBackupPath(2)))
            .then(() => this.writeJson(this.getRotationBackupPath(1), this.prepareRotationBackupData(sessionData)))
            .catch(() => undefined);
    }

    getRotationBackupInfo(): Promise<
        { generation: number; savedAt: number; sessionCount: number; backupPlatform: string }[]
    > {
        const readGeneration = (n: number) =>
            this.readJsonIfExists(this.getRotationBackupPath(n))
                .then((res) => {
                    if (!res.exists || !res.data) return null;
                    const data = res.data as Record<string, unknown>;
                    const stamp = getPersistStamp(data);
                    const sessions = data.sessions;
                    const count = sessions && typeof sessions === 'object' ? Object.keys(sessions).length : 0;
                    const platform = typeof data._wppBackupPlatform === 'string' ? data._wppBackupPlatform : '';
                    return { generation: n, savedAt: stamp, sessionCount: count, backupPlatform: platform };
                })
                .catch(() => null);
        return Promise.all([readGeneration(1), readGeneration(2), readGeneration(3)]).then((items) =>
            items.filter((i): i is { generation: number; savedAt: number; sessionCount: number; backupPlatform: string } => !!i),
        );
    }

    clearBackupFiles(): Promise<boolean> {
        return Promise.all(this.getBackupFilePaths().map((path) => this.removeIfExists(path))).then(() => {
            this._lastRotationBackupAt = 0;
            return true;
        });
    }

    clearBackupsAndVersionHistory(): Promise<boolean> {
        const changed = this.clearVersionHistoryEntries();
        const save = changed ? this.persistData() : Promise.resolve(undefined);
        return save.then(() => this.clearBackupFiles());
    }

    applyDefaultSettingsToCurrentScope(): void {
        const defaults = this.getDefaultSettingsData();
        for (const key of SETTINGS_KEYS) {
            this.data[key] = defaults[key];
        }
        i18n.resolveLocale((this.data.language as string) || 'auto');
    }

    resetSettingsToDefault(): Promise<unknown> {
        this.applyDefaultSettingsToCurrentScope();
        return this.persistData();
    }

    resetSessionsAndSettingsToDefault(): Promise<boolean> {
        this.applyDefaultSettingsToCurrentScope();
        return this.resetSessionsToDefault().then(() => this.clearBackupFiles());
    }

    /** True if imported data contains at least one session (used on load). */
    static hasSessions(data: unknown): boolean {
        return hasNonEmptySessions(data);
    }
}
