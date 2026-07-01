import { describe, test, expect } from 'vitest';
import { PersistenceService } from '../src/core/persistence-service';
import type { AppLike } from '../src/core/host';
import type { SessionData } from '../src/core/types';

// Ported from reference tests/session-sync.test.js. Targets PersistenceService's
// merge/sync methods; the reload test is adapted to the multi-file storage seam
// (index.json) while preserving the exact merge assertions.
function createService(initialData: Partial<SessionData> = {}) {
    const svc = new PersistenceService();
    svc.manifest = { id: 'workspace-mgr', dir: '.obsidian/plugins/workspace-mgr' };
    svc.platform = { isDesktop: true, isDesktopApp: true, isMacOS: true };
    svc.data = Object.assign(
        {
            activeSessionId: 'local',
            sessionOrder: ['local'],
            sessions: { local: { id: 'local', name: 'Local', modified: 100, layout: { local: true } } },
            groups: { g1: { id: 'g1', name: 'Local group' } },
            groupOrder: ['__all__', 'g1'],
            sessionGroups: { local: ['g1'] },
            activeGroupId: 'g1',
        },
        initialData,
    ) as SessionData;
    const counters = { statusBarUpdates: 0, commandSyncs: 0, overlayRefreshes: 0 };
    svc.app = { vault: { adapter: { stat: () => Promise.resolve({ mtime: 1000 }) } } } as unknown as AppLike;
    svc.updateStatusBar = () => {
        counters.statusBarUpdates += 1;
    };
    svc.syncSessionCommands = () => {
        counters.commandSyncs += 1;
    };
    svc._refreshOverlaySessions = () => {
        counters.overlayRefreshes += 1;
    };
    svc.syncSessionOrder = () => {
        const sessions = svc.data.sessions || {};
        svc.data.sessionOrder = (svc.data.sessionOrder || []).filter((id) => !!sessions[id]);
        for (const id of Object.keys(sessions)) {
            if (!svc.data.sessionOrder.includes(id)) svc.data.sessionOrder.push(id);
        }
    };
    svc.normalizeGroupFeatureState = () => {};
    return { svc, counters };
}

describe('session-sync', () => {
    test('applies external data without changing the local active session', () => {
        const { svc, counters } = createService();
        const external: Partial<SessionData> = {
            activeSessionId: 'remote',
            sessionOrder: ['remote', 'local'],
            sessions: {
                remote: { id: 'remote', name: 'Remote', modified: 200, layout: { remote: true } },
                local: { id: 'local', name: 'Local from disk', modified: 150, layout: { disk: true } },
            },
            groups: {},
            groupOrder: [],
            sessionGroups: {},
            activeGroupId: null,
        };
        const applied = svc.applySessionDataFromStorage(external);
        expect(applied).toBe(true);
        expect(svc.data.activeSessionId).toBe('local');
        expect(svc.data.sessions.local.name).toBe('Local from disk');
        expect(svc.data.sessions.remote.name).toBe('Remote');
        expect(svc.data.sessionOrder).toEqual(['remote', 'local']);
        expect(counters.statusBarUpdates).toBe(1);
        expect(counters.commandSyncs).toBe(1);
        expect(counters.overlayRefreshes).toBe(1);
    });

    test('falls back when the local active session was deleted externally', () => {
        const { svc } = createService();
        const external: Partial<SessionData> = {
            activeSessionId: 'remote',
            sessionOrder: ['remote'],
            sessions: { remote: { id: 'remote', name: 'Remote', modified: 200, layout: { remote: true } } },
        };
        svc.applySessionDataFromStorage(external);
        expect(svc.data.activeSessionId).toBe('remote');
        expect(svc.data.sessionOrder).toEqual(['remote']);
    });

    test('save merge keeps both local and external additions', () => {
        const { svc } = createService({
            activeSessionId: 'base',
            sessionOrder: ['base'],
            sessions: { base: { id: 'base', name: 'Base', modified: 100, layout: { base: true } } },
            groups: {},
            groupOrder: [],
            sessionGroups: {},
            activeGroupId: null,
        });
        svc.recordSessionStorageState(1, 1000, svc.data);

        svc.data.sessions.localNew = { id: 'localNew', name: 'Local new', modified: 300, layout: { local: true } };
        svc.data.sessionOrder.push('localNew');

        const external: Partial<SessionData> = {
            activeSessionId: 'base',
            sessionOrder: ['base', 'remoteNew'],
            sessions: {
                base: { id: 'base', name: 'Base from disk', modified: 150, layout: { disk: true } },
                remoteNew: { id: 'remoteNew', name: 'Remote new', modified: 250, layout: { remote: true } },
            },
        };
        const merged = svc.mergeExternalSessionDataForWrite(external);
        expect(merged.sessions.base.name).toBe('Base from disk');
        expect(merged.sessions.remoteNew.name).toBe('Remote new');
        expect(merged.sessions.localNew.name).toBe('Local new');
        expect(merged.sessionOrder).toEqual(['base', 'remoteNew', 'localNew']);
    });

    test('save merge preserves local session deletion when external copy is unchanged', () => {
        const { svc } = createService({
            activeSessionId: 'base',
            sessionOrder: ['base', 'deleted'],
            sessions: {
                base: { id: 'base', name: 'Base', modified: 100, layout: { base: true } },
                deleted: { id: 'deleted', name: 'Delete me', modified: 100, layout: { old: true } },
            },
        });
        svc.recordSessionStorageState(1, 1000, svc.data);

        delete svc.data.sessions.deleted;
        svc.data.sessionOrder = ['base'];

        const external: Partial<SessionData> = {
            activeSessionId: 'base',
            sessionOrder: ['base', 'deleted', 'remoteNew'],
            sessions: {
                base: { id: 'base', name: 'Base', modified: 100, layout: { base: true } },
                deleted: { id: 'deleted', name: 'Delete me', modified: 100, layout: { old: true } },
                remoteNew: { id: 'remoteNew', name: 'Remote new', modified: 250, layout: { remote: true } },
            },
        };
        const merged = svc.mergeExternalSessionDataForWrite(external);
        expect(merged.sessions.deleted).toBeUndefined();
        expect(merged.sessions.remoteNew.name).toBe('Remote new');
        expect(merged.sessionOrder).toEqual(['base', 'remoteNew']);
    });

    test('save reload merge uses the previous baseline while reading external data', async () => {
        const { svc } = createService({
            activeSessionId: 'base',
            sessionOrder: ['base'],
            sessions: { base: { id: 'base', name: 'Base', modified: 100, layout: { base: true } } },
            groups: {},
            groupOrder: [],
            sessionGroups: {},
            activeGroupId: null,
        });
        svc.recordSessionStorageState(1, 1000, svc.data);

        svc.data.sessions.localNew = { id: 'localNew', name: 'Local new', modified: 300, layout: { local: true } };
        svc.data.sessionOrder.push('localNew');

        const external = {
            _wppSavedAt: 2,
            activeSessionId: 'base',
            sessionOrder: ['base', 'remoteNew'],
            sessions: {
                base: { id: 'base', name: 'Base from disk', modified: 150, layout: { disk: true } },
                remoteNew: { id: 'remoteNew', name: 'Remote new', modified: 250, layout: { remote: true } },
            },
        };
        svc.readJsonIfExists = () => Promise.resolve({ exists: true, data: external, error: null });
        svc.getFileMtime = () => Promise.resolve(2000);

        const reloaded = await svc.reloadExternalSessionStorageIfChanged({ mergeLocal: true });
        expect(reloaded).toBe(true);
        expect(svc.data.sessions.base.name).toBe('Base from disk');
        expect(svc.data.sessions.remoteNew.name).toBe('Remote new');
        expect(svc.data.sessions.localNew.name).toBe('Local new');
        expect(svc.data.sessionOrder).toEqual(['base', 'remoteNew', 'localNew']);
    });

    test('rotation backup data records the current platform label', () => {
        const { svc } = createService();
        const sessionData = svc.extractSessionData(svc.data) as unknown as Record<string, unknown>;
        sessionData._wppSavedAt = 123;
        const backupData = svc.prepareRotationBackupData(sessionData);
        expect(svc.getBackupPlatformLabel()).toBe('macOS');
        expect(backupData._wppBackupPlatform).toBe('macOS');
        expect(sessionData._wppBackupPlatform).toBeUndefined();
    });

    test('rotation backup info includes saved platform labels', async () => {
        const { svc } = createService();
        svc.getRotationBackupPath = (generation: number) => 'sessions.' + generation + '.json';
        svc.readJsonIfExists = (path: string) => {
            if (path === 'sessions.1.json') {
                return Promise.resolve({
                    exists: true,
                    data: {
                        _wppSavedAt: 123,
                        _wppBackupPlatform: 'Windows',
                        sessions: { a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } },
                    },
                    error: null,
                });
            }
            return Promise.resolve({ exists: false, data: null, error: null });
        };
        const backups = await svc.getRotationBackupInfo();
        expect(backups).toEqual([{ generation: 1, savedAt: 123, sessionCount: 2, backupPlatform: 'Windows' }]);
    });
});
