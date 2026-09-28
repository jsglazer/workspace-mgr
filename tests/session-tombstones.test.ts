import { describe, test, expect, beforeAll } from 'vitest';
import * as i18n from '../src/i18n';
import { PersistenceService } from '../src/core/persistence-service';
import { SessionService } from '../src/core/session-service';
import {
    buildSyncedSessionPayload,
    mergeSessionTombstones,
    normalizeSessionTombstones,
    SESSION_TOMBSTONE_TTL_MS,
} from '../src/core/sync';
import type { AppLike, FsAdapterLike } from '../src/core/host';
import type { Layout, Session, SessionData } from '../src/core/types';

// Update011: a deleted session kept coming back because the other device's
// data.json still held it and the merge re-added anything "remote has, we
// don't". Deletes now leave a synced tombstone.
beforeAll(() => {
    i18n.resolveLocale('en');
});

const DIR = '.obsidian/plugins/workspace-mgr';

function session(id: string, name: string, modified: number): Session {
    return { id, name, modified, layout: { main: { id: name } } } as Session;
}

function makePersistence(files: Record<string, string> = {}) {
    const svc = new PersistenceService();
    svc.manifest = { id: 'workspace-mgr', dir: DIR };
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
        stat: (p: string) => Promise.resolve(Object.prototype.hasOwnProperty.call(written, p) ? { mtime: 100 } : null),
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

describe('tombstone helpers', () => {
    test('normalize drops junk and expired entries', () => {
        const now = Date.now();
        const out = normalizeSessionTombstones({ a: now, b: 'x', c: -1, d: now - SESSION_TOMBSTONE_TTL_MS - 1 }, now);
        expect(out).toEqual({ a: now });
        expect(normalizeSessionTombstones(null)).toEqual({});
        expect(normalizeSessionTombstones([1, 2])).toEqual({});
    });

    test('merge keeps the later deletion per id', () => {
        const now = Date.now();
        expect(mergeSessionTombstones({ a: now - 10, b: now }, { a: now, c: now - 5 }, now)).toEqual({
            a: now,
            b: now,
            c: now - 5,
        });
    });

    test('tombstones travel in the synced data.json payload', () => {
        const now = Date.now();
        const payload = buildSyncedSessionPayload({ sessions: {}, deletedSessions: { gone: now } } as Partial<SessionData>);
        expect(payload.deletedSessions).toEqual({ gone: now });
    });
});

describe('deleteSession records a tombstone', () => {
    test('the deleted id is tombstoned at deletion time', async () => {
        const svc = new SessionService();
        svc.data = {
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: { a: session('a', 'A', 1), b: session('b', 'B', 1) },
        } as unknown as SessionData;
        svc.updateStatusBar = () => {};
        svc.syncSessionCommands = () => {};
        svc.persistData = () => Promise.resolve(true);
        const before = Date.now();
        expect(await svc.deleteSession('b')).toBe(true);
        expect(svc.data.sessions.b).toBeUndefined();
        expect(svc.data.deletedSessions!.b).toBeGreaterThanOrEqual(before);
    });
});

describe('a deleted session stays deleted across Sync', () => {
    function deletedLocally(svc: PersistenceService, deletedAt: number): void {
        svc.data = {
            activeSessionId: 'a',
            sessions: { a: session('a', 'Alpha', 5) },
            sessionOrder: ['a'],
            sessionGroups: {},
            groups: {},
            groupOrder: [],
            activeGroupId: null,
            deletedSessions: { bob: deletedAt },
        } as unknown as SessionData;
        // The baseline is what we last wrote — already without "bob", which is
        // exactly why the old merge treated the remote copy as new.
        svc.recordSessionStorageState(1, 1, svc.data);
    }

    test('another device still holding the session cannot sync it back', () => {
        const { svc } = makePersistence();
        const now = Date.now();
        deletedLocally(svc, now);
        svc.applyExternalDataJson({
            sessions: { a: session('a', 'Alpha', 5), bob: session('bob', 'DataBob', now - 1000) },
            sessionOrder: ['a', 'bob'],
            activeSessionId: 'a',
        } as Partial<SessionData>);
        expect(svc.data.sessions.bob).toBeUndefined();
        expect(svc.data.sessionOrder).toEqual(['a']);
        expect(svc.data.deletedSessions).toEqual({ bob: now });
    });

    test('the receiving device drops its copy when the tombstone arrives', () => {
        const { svc } = makePersistence();
        const now = Date.now();
        svc.data = {
            activeSessionId: 'a',
            sessions: { a: session('a', 'Alpha', 5), bob: session('bob', 'DataBob', now - 1000) },
            sessionOrder: ['a', 'bob'],
            sessionGroups: { bob: ['g'] },
            groups: { g: { id: 'g', name: 'Classes' } },
            groupOrder: ['g'],
            activeGroupId: null,
        } as unknown as SessionData;
        svc.recordSessionStorageState(1, 1, svc.data);
        svc.applyExternalDataJson({
            sessions: { a: session('a', 'Alpha', 5) },
            sessionOrder: ['a'],
            activeSessionId: 'a',
            deletedSessions: { bob: now },
        } as Partial<SessionData>);
        expect(svc.data.sessions.bob).toBeUndefined();
        expect(svc.data.sessionGroups.bob).toBeUndefined();
    });

    test('an edit made after the delete wins over the tombstone', () => {
        const { svc } = makePersistence();
        const now = Date.now();
        deletedLocally(svc, now - 5000);
        svc.applyExternalDataJson({
            sessions: { a: session('a', 'Alpha', 5), bob: session('bob', 'DataBob', now) },
            sessionOrder: ['a', 'bob'],
            activeSessionId: 'a',
        } as Partial<SessionData>);
        expect(svc.data.sessions.bob.name).toBe('DataBob');
    });

    test('a leftover mirror file is not rediscovered as an orphan', async () => {
        const now = Date.now();
        const index = {
            _wppSavedAt: 10,
            activeSessionId: 'a',
            sessions: { a: session('a', 'Alpha', 5) },
            sessionOrder: ['a'],
            deletedSessions: { bob: now },
        };
        const { svc } = makePersistence({
            [`${DIR}/sessions/index.json`]: JSON.stringify(index),
            [`${DIR}/sessions/a.json`]: JSON.stringify(session('a', 'Alpha', 5)),
            [`${DIR}/sessions/bob.json`]: JSON.stringify(session('bob', 'DataBob', now - 1000)),
        });
        const loaded = await svc.loadSessionDataFromStorage();
        expect(loaded!.sessions.bob).toBeUndefined();
    });
});

describe('save current layout to another session activates it', () => {
    function makeSessions() {
        const svc = new SessionService();
        svc.data = {
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: { a: session('a', 'A', 1), b: session('b', 'B', 1) },
        } as unknown as SessionData;
        let statusBarUpdates = 0;
        svc.getCurrentWorkspaceLayout = () => ({ layout: 'current' }) as Layout;
        svc.layoutsEqualStructural = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
        svc.pushLayoutToHistory = () => {};
        svc.updateStatusBar = () => {
            statusBarUpdates++;
        };
        svc.notify = () => {};
        svc.persistData = () => Promise.resolve(true);
        return { svc, statusBarUpdates: () => statusBarUpdates };
    }

    test('with activate, the target becomes active and the status bar refreshes', async () => {
        const { svc, statusBarUpdates } = makeSessions();
        await svc.overwriteSessionWithCurrentLayout('b', { activate: true });
        expect(svc.data.activeSessionId).toBe('b');
        expect(svc.data.sessions.b.layout).toEqual({ layout: 'current' });
        expect(svc.data.sessions.a.layout).toEqual({ main: { id: 'A' } });
        expect(statusBarUpdates()).toBeGreaterThan(0);
    });

    test('without activate, the active session is unchanged', async () => {
        const { svc } = makeSessions();
        await svc.overwriteSessionWithCurrentLayout('b');
        expect(svc.data.activeSessionId).toBe('a');
    });
});
