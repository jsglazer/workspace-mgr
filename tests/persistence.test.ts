import { describe, test, expect, vi } from 'vitest';
import { PersistenceService } from '../src/core/persistence-service';
import type { AppLike, FsAdapterLike } from '../src/core/host';
import type { SessionData } from '../src/core/types';

const DIR = '.obsidian/plugins/workspace-mgr';

function makeService(files: Record<string, string> = {}, readLog?: string[]) {
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
        read: (p: string) => {
            if (readLog) readLog.push(p);
            return Promise.resolve(written[p]);
        },
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

describe('persistence: write queue', () => {
    // §4: writes are serialized through a promise queue and never interleave.
    test('serializes overlapping persist calls (max concurrency 1)', async () => {
        const { svc } = makeService();
        let active = 0;
        let maxActive = 0;
        svc.persistDataImmediate = async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await Promise.resolve();
            await Promise.resolve();
            active -= 1;
        };
        await Promise.all([svc.persistData(), svc.persistData(), svc.persistData()]);
        expect(maxActive).toBe(1);
    });

    // §4: rapid save invocations within the debounce window collapse to one write.
    test('debounced requestPersist collapses rapid calls into a single write', () => {
        vi.useFakeTimers();
        try {
            const { svc } = makeService();
            let persistCalls = 0;
            svc.persistData = () => {
                persistCalls += 1;
                return Promise.resolve(true);
            };
            void svc.requestPersist(400);
            void svc.requestPersist(400);
            void svc.requestPersist(400);
            expect(persistCalls).toBe(0);
            vi.advanceTimersByTime(399);
            expect(persistCalls).toBe(0);
            vi.advanceTimersByTime(1);
            expect(persistCalls).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('persistence: multi-file load', () => {
    // §4: the directory scanner auto-merges unregistered session files.
    test('loadSessionDataFromStorage auto-merges orphan {id}.json files not in the index', async () => {
        const indexPath = `${DIR}/sessions/index.json`;
        const orphanPath = `${DIR}/sessions/b.json`;
        const files = {
            [indexPath]: JSON.stringify({
                activeSessionId: 'a',
                sessions: { a: { id: 'a', name: 'A', modified: 1, layout: { a: 1 } } },
                sessionOrder: ['a'],
                _wppSavedAt: 5,
            }),
            [orphanPath]: JSON.stringify({ id: 'b', name: 'Orphan B', modified: 2, layout: { b: 1 } }),
        };
        const { svc } = makeService(files);
        const data = await svc.loadSessionDataFromStorage();
        expect(data).not.toBeNull();
        expect(data!.sessions.a.name).toBe('A');
        expect(data!.sessions.b.name).toBe('Orphan B');
        expect(data!.sessionOrder).toContain('b');
    });

    // §4: startup initializes empty and never reads the legacy path.
    test('empty vault yields no session data and reads only the new location', async () => {
        const readLog: string[] = [];
        const { svc } = makeService({}, readLog);
        const data = await svc.loadSessionDataFromStorage();
        expect(data).toBeNull();
        // No read ever touches the legacy workspace-plus-plus storage.
        for (const path of readLog) expect(path).not.toMatch(/workspace-plus-plus/);
    });
});

describe('persistence: paths', () => {
    // §4: no path references the legacy location or a sessions/manifest.json.
    test('all storage paths live under the plugin dir with no legacy or manifest.json names', () => {
        const { svc } = makeService();
        const paths = [
            svc.getSessionsDirPath(),
            svc.getIndexPath(),
            svc.getSessionsPath(),
            svc.getSessionsBackupPath(),
            svc.getSessionFilePath('abc'),
            svc.getBackupPath(),
            svc.getBackupsDirPath(),
            svc.getRotationBackupPath(1),
            ...svc.getBackupFilePaths(),
        ];
        for (const p of paths) {
            expect(p).not.toMatch(/workspace-plus-plus/);
            expect(p).not.toMatch(/sessions\/manifest\.json/);
            expect(p.startsWith(DIR)).toBe(true);
        }
        expect(svc.getIndexPath()).toBe(`${DIR}/sessions/index.json`);
    });
});
