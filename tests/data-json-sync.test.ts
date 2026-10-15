import { describe, test, expect } from 'vitest';
import { PersistenceService } from '../src/core/persistence-service';
import { buildSyncedSessionPayload, collectSessionHistory, stripSessionHistory } from '../src/core/sync';
import type { AppLike, FsAdapterLike } from '../src/core/host';
import type { Session, SessionData } from '../src/core/types';

const DIR = '.obsidian/plugins/workspace-mgr';

function session(id: string, name: string, modified: number, extra: Partial<Session> = {}): Session {
    return { id, name, modified, layout: { main: { id: name } }, ...extra } as Session;
}

function makeService(files: Record<string, string> = {}) {
    const svc = new PersistenceService();
    svc.manifest = { id: 'workspace-mgr', dir: DIR };
    svc.data = {
        activeSessionId: null,
        sessions: {},
        sessionOrder: [],
        sessionGroups: {},
        groups: {},
        groupOrder: [],
        activeGroupId: null,
    } as unknown as SessionData;
    const written: Record<string, string> = { ...files };
    const adapter: FsAdapterLike = {
        exists: (p: string) => Promise.resolve(Object.prototype.hasOwnProperty.call(written, p)),
        read: (p: string) => Promise.resolve(written[p]),
        write: (p: string, data: string) => {
            written[p] = data;
            return Promise.resolve();
        },
        remove: (p: string) => {
            delete written[p];
            return Promise.resolve();
        },
        stat: (p: string) =>
            Promise.resolve(Object.prototype.hasOwnProperty.call(written, p) ? { mtime: 100 } : null),
        mkdir: () => Promise.resolve(),
        list: (dir: string) => {
            const prefix = dir.endsWith('/') ? dir : dir + '/';
            const inDir = Object.keys(written).filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
            return Promise.resolve({ files: inDir, folders: [] });
        },
    };
    svc.app = { vault: { adapter } } as unknown as AppLike;
    return { svc, written };
}

describe('sync payload: history is excluded', () => {
    // Obsidian Sync only carries data.json out of a plugin folder, and version
    // history is ~70% of the payload — it stays on the device that made it.
    test('stripSessionHistory drops history and keeps the synced fields', () => {
        const s = session('a', 'Alpha', 5, { isDefault: true, history: [{ savedAt: 1, layout: {} }] });
        const stripped = stripSessionHistory(s);
        expect(stripped.history).toBeUndefined();
        expect(stripped).toEqual({ id: 'a', name: 'Alpha', modified: 5, layout: { main: { id: 'Alpha' } }, isDefault: true });
    });

    test('buildSyncedSessionPayload carries the full index minus history', () => {
        const payload = buildSyncedSessionPayload({
            activeSessionId: 'a',
            sessions: { a: session('a', 'Alpha', 5, { history: [{ savedAt: 1, layout: {} }] }) },
            sessionOrder: ['a'],
            groups: { g: { id: 'g', name: 'G' } },
            groupOrder: ['g'],
            sessionGroups: { g: ['a'] },
            activeGroupId: 'g',
        } as Partial<SessionData>);
        expect(payload.activeSessionId).toBe('a');
        expect(payload.sessionOrder).toEqual(['a']);
        expect(payload.groups).toEqual({ g: { id: 'g', name: 'G' } });
        expect((payload.sessions as Record<string, Session>).a.history).toBeUndefined();
    });

    test('collectSessionHistory harvests history by id', () => {
        const history = collectSessionHistory({
            sessions: {
                a: session('a', 'Alpha', 5, { history: [{ savedAt: 1, layout: {} }] }),
                b: session('b', 'Beta', 5),
            },
        } as Partial<SessionData>);
        expect(Object.keys(history)).toEqual(['a']);
    });

    test('buildDataJsonPayload merges settings and the stripped sessions', () => {
        const { svc } = makeService();
        svc.data = {
            ...svc.data,
            autoSaveOnSwitch: true,
            sessions: { a: session('a', 'Alpha', 5, { history: [{ savedAt: 1, layout: {} }] }) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
        } as unknown as SessionData;
        const payload = svc.buildDataJsonPayload();
        expect(payload.autoSaveOnSwitch).toBe(true);
        expect((payload.sessions as Record<string, Session>).a.history).toBeUndefined();
        expect((payload.sessions as Record<string, Session>).a.name).toBe('Alpha');
    });
});

describe('load: data.json is the source of truth', () => {
    test('sessions come from data.json, history from the local mirror', async () => {
        const local = {
            sessions: { a: session('a', 'Alpha (stale)', 1, { history: [{ savedAt: 9, layout: { h: 1 } }] }) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
        };
        const { svc } = makeService({ [`${DIR}/sessions/index.json`]: JSON.stringify(local) });
        const data = await svc.buildInitialData({
            autoSaveOnSwitch: true,
            sessions: { a: session('a', 'Alpha (synced)', 20) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
        } as Partial<SessionData>);

        expect(data.sessions.a.name).toBe('Alpha (synced)');
        expect(data.sessions.a.history).toEqual([{ savedAt: 9, layout: { h: 1 } }]);
        expect(data.autoSaveOnSwitch).toBe(true);
    });

    test('falls back to the multi-file store when data.json has no sessions (migration)', async () => {
        const local = {
            sessions: { a: session('a', 'Alpha', 1) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
        };
        const { svc } = makeService({ [`${DIR}/sessions/index.json`]: JSON.stringify(local) });
        const data = await svc.buildInitialData({ autoSaveOnSwitch: true } as Partial<SessionData>);
        expect(Object.keys(data.sessions)).toEqual(['a']);
        expect(data.sessions.a.name).toBe('Alpha');
    });

    test('a session only present in data.json survives (arrived from the other device)', async () => {
        const { svc } = makeService({
            [`${DIR}/sessions/index.json`]: JSON.stringify({ sessions: {}, sessionOrder: [] }),
        });
        const data = await svc.buildInitialData({
            sessions: { b: session('b', 'Beta', 20) },
            sessionOrder: ['b'],
            activeSessionId: 'b',
        } as Partial<SessionData>);
        expect(data.sessions.b.name).toBe('Beta');
        expect(data.sessions.b.history).toBeUndefined();
    });
});

describe('applyExternalDataJson: absorbing a Sync-delivered write', () => {
    test('adopts a newer remote session and keeps local history', () => {
        const { svc } = makeService();
        svc.data = {
            ...svc.data,
            sessions: { a: session('a', 'Alpha', 5, { history: [{ savedAt: 3, layout: {} }] }) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
        } as unknown as SessionData;
        svc.recordSessionStorageState(1, 1, svc.data);

        const changed = svc.applyExternalDataJson({
            autoSaveOnSwitch: true,
            sessions: { a: session('a', 'Alpha renamed', 50), b: session('b', 'Beta', 50) },
            sessionOrder: ['a', 'b'],
            activeSessionId: 'a',
        } as Partial<SessionData>);

        expect(changed).toBe(true);
        expect(svc.data.sessions.a.name).toBe('Alpha renamed');
        expect(svc.data.sessions.a.history).toEqual([{ savedAt: 3, layout: {} }]);
        expect(svc.data.sessions.b.name).toBe('Beta');
        expect(svc.data.autoSaveOnSwitch).toBe(true);
    });

    test('a local session newer than the incoming copy is kept', () => {
        const { svc } = makeService();
        svc.data = {
            ...svc.data,
            sessions: { a: session('a', 'Local wins', 500) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
        } as unknown as SessionData;
        svc.recordSessionStorageState(1, 1, svc.data);

        svc.applyExternalDataJson({
            sessions: { a: session('a', 'Remote loses', 5) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
        } as Partial<SessionData>);
        expect(svc.data.sessions.a.name).toBe('Local wins');
    });

    test('ignores a re-read of the payload we just wrote', () => {
        const { svc } = makeService();
        svc.data = {
            ...svc.data,
            sessions: { a: session('a', 'Alpha', 5) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
        } as unknown as SessionData;
        const payload = svc.buildDataJsonPayload();
        expect(svc.applyExternalDataJson(payload as Partial<SessionData>)).toBe(false);
    });

    test('ignores a payload with no sessions', () => {
        const { svc } = makeService();
        expect(svc.applyExternalDataJson({ autoSaveOnSwitch: true } as Partial<SessionData>)).toBe(false);
        expect(svc.applyExternalDataJson(undefined)).toBe(false);
    });
});

describe('applyExternalDataJson: reorders survive a Sync merge', () => {
    const groups = { g1: { id: 'g1', name: 'One' }, g2: { id: 'g2', name: 'Two' }, g3: { id: 'g3', name: 'Three' } };
    const sessions = { a: session('a', 'A', 5), b: session('b', 'B', 5) };

    function baseState(svc: PersistenceService) {
        svc.data = {
            ...svc.data,
            sessions: { ...sessions },
            sessionOrder: ['a', 'b'],
            groups: { ...groups },
            groupOrder: ['__all__', 'g1', 'g2', 'g3'],
            activeSessionId: 'a',
        } as unknown as SessionData;
        svc.recordSessionStorageState(1, 1, svc.data);
    }

    test('a stale incoming copy does not undo a local group reorder', () => {
        const { svc } = makeService();
        baseState(svc);
        // The user reorders locally: Three first, Ungrouped last.
        svc.data.groupOrder = ['g3', 'g1', 'g2', '__all__'];
        svc.data.groupOrderModified = 1000;

        // Another device, still on the old order, pushes its data.json (e.g. after a session edit).
        svc.applyExternalDataJson({
            sessions: { a: session('a', 'A edited', 50), b: session('b', 'B', 5) },
            sessionOrder: ['a', 'b'],
            groups: { ...groups },
            groupOrder: ['g1', 'g2', 'g3'],
            activeSessionId: 'a',
        } as Partial<SessionData>);

        expect(svc.data.groupOrder).toEqual(['g3', 'g1', 'g2', '__all__']);
        expect(svc.data.sessions.a.name).toBe('A edited');
    });

    test('a stale incoming copy does not undo a local session reorder', () => {
        const { svc } = makeService();
        baseState(svc);
        svc.data.sessionOrder = ['b', 'a'];
        svc.data.sessionOrderModified = 1000;

        svc.applyExternalDataJson({
            sessions: { a: session('a', 'A edited', 50), b: session('b', 'B', 5) },
            sessionOrder: ['a', 'b'],
            groups: { ...groups },
            groupOrder: ['__all__', 'g1', 'g2', 'g3'],
            activeSessionId: 'a',
        } as Partial<SessionData>);

        expect(svc.data.sessionOrder).toEqual(['b', 'a']);
    });

    test('a remote reorder is adopted when the local order is unchanged', () => {
        const { svc } = makeService();
        baseState(svc);

        svc.applyExternalDataJson({
            sessions: { ...sessions },
            sessionOrder: ['b', 'a'],
            sessionOrderModified: 2000,
            groups: { ...groups },
            groupOrder: ['g2', '__all__', 'g1', 'g3'],
            groupOrderModified: 2000,
            activeSessionId: 'a',
        } as Partial<SessionData>);

        expect(svc.data.groupOrder).toEqual(['g2', '__all__', 'g1', 'g3']);
        expect(svc.data.sessionOrder).toEqual(['b', 'a']);
        expect(svc.data.groupOrderModified).toBe(2000);
    });

    test('when both sides reordered, the later reorder wins', () => {
        const { svc } = makeService();
        baseState(svc);
        svc.data.groupOrder = ['g3', '__all__', 'g1', 'g2'];
        svc.data.groupOrderModified = 1000;

        svc.applyExternalDataJson({
            sessions: { ...sessions },
            sessionOrder: ['a', 'b'],
            groups: { ...groups },
            groupOrder: ['g2', 'g1', 'g3'],
            groupOrderModified: 3000,
            activeSessionId: 'a',
        } as Partial<SessionData>);

        // Remote order wins; Ungrouped keeps the place it had locally instead of being dropped.
        expect(svc.data.groupOrder).toEqual(['g2', '__all__', 'g1', 'g3']);
    });

    test('the Ungrouped block position is written to data.json', () => {
        const { svc } = makeService();
        baseState(svc);
        svc.data.groupOrder = ['g1', 'g2', 'g3', '__all__'];
        const payload = svc.buildDataJsonPayload();
        expect(payload.groupOrder).toEqual(['g1', 'g2', 'g3', '__all__']);
        const reloaded = svc.extractSessionData(payload as Partial<SessionData>);
        expect(reloaded.groupOrder).toEqual(['g1', 'g2', 'g3', '__all__']);
    });
});

describe('local mirror hygiene', () => {
    test('persisting removes mirror files for sessions that no longer exist', async () => {
        const { svc, written } = makeService({
            [`${DIR}/sessions/gone.json`]: JSON.stringify(session('gone', 'Gone', 1)),
        });
        svc.data = {
            ...svc.data,
            sessions: { a: session('a', 'Alpha', 5) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
        } as unknown as SessionData;

        await svc.persistDataImmediate();

        expect(written[`${DIR}/sessions/a.json`]).toBeTruthy();
        expect(written[`${DIR}/sessions/gone.json`]).toBeUndefined();
        expect(written[`${DIR}/sessions/index.json`]).toBeTruthy();
        expect(written[`${DIR}/sessions/index.backup.json`]).toBeTruthy();
    });
});
