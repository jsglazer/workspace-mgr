import { describe, test, expect } from 'vitest';
import { PersistenceService } from '../src/core/persistence-service';
import { SessionService } from '../src/core/session-service';
import type { AppLike } from '../src/core/host';
import type { SessionData } from '../src/core/types';

// Ported from reference tests/reset-cleanup.test.js. Backup paths are adapted to
// the new plugin storage location (the storage move is a settled constraint);
// the behavior — clearing histories, persisting only when changed, removing
// backups but keeping exports — is preserved exactly. Real version-history
// clearing is exercised via a SessionService sharing the same data object.
const DIR = '.obsidian/plugins/workspace-mgr';

function createService(options: { files?: string[]; data?: Partial<SessionData> } = {}) {
    const svc = new PersistenceService();
    svc.manifest = { id: 'workspace-mgr', dir: DIR };
    const existingFiles = new Set(options.files || []);
    const removedFiles: string[] = [];
    svc.data = Object.assign(
        {
            activeSessionId: 'a',
            sessions: {
                a: { id: 'a', name: 'A', history: [{ savedAt: 1, layout: { a: true } }] },
                b: { id: 'b', name: 'B', history: [] },
                c: { id: 'c', name: 'C' },
            },
        },
        options.data,
    ) as SessionData;
    const state = { persistCalls: 0 };
    svc.app = {
        vault: {
            adapter: {
                exists: (path: string) => Promise.resolve(existingFiles.has(path)),
                remove: (path: string) => {
                    removedFiles.push(path);
                    existingFiles.delete(path);
                    return Promise.resolve();
                },
            },
        },
    } as unknown as AppLike;
    svc.persistData = () => {
        state.persistCalls += 1;
        return Promise.resolve(true);
    };
    // Wire the real version-history clearing via a SessionService over the same data.
    const session = new SessionService();
    session.data = svc.data;
    svc.clearVersionHistoryEntries = () => session.clearVersionHistoryEntries();

    return {
        svc,
        state,
        getRemovedFiles: () => removedFiles.slice(),
        hasFile: (path: string) => existingFiles.has(path),
    };
}

describe('reset-cleanup', () => {
    test('clearBackupsAndVersionHistory removes backup files and session history', async () => {
        const files = [
            `${DIR}/sessions/index.backup.json`,
            `${DIR}/backups/sessions.1.json`,
            `${DIR}/backups/sessions.2.json`,
            `${DIR}/backups/sessions.3.json`,
            `${DIR}/data.backup.json`,
            `${DIR}/exports/sessions-keep.json`,
        ];
        const { svc, state, getRemovedFiles, hasFile } = createService({ files });
        svc._lastRotationBackupAt = 123;

        await svc.clearBackupsAndVersionHistory();

        expect(svc.data.sessions.a.history).toBeUndefined();
        expect(svc.data.sessions.b.history).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(svc.data.sessions.c, 'history')).toBe(false);
        expect(state.persistCalls).toBe(1);
        expect(svc._lastRotationBackupAt).toBe(0);

        expect(getRemovedFiles().sort()).toEqual(
            [
                `${DIR}/backups/sessions.1.json`,
                `${DIR}/backups/sessions.2.json`,
                `${DIR}/backups/sessions.3.json`,
                `${DIR}/data.backup.json`,
                `${DIR}/sessions/index.backup.json`,
            ].sort(),
        );
        expect(hasFile(`${DIR}/exports/sessions-keep.json`)).toBe(true);
    });

    test('clearBackupsAndVersionHistory deletes backups even when no history exists', async () => {
        const { svc, state, getRemovedFiles } = createService({
            files: [`${DIR}/sessions/index.backup.json`],
            data: { sessions: { a: { id: 'a', name: 'A' } } },
        });

        await svc.clearBackupsAndVersionHistory();

        expect(state.persistCalls).toBe(0);
        expect(getRemovedFiles()).toEqual([`${DIR}/sessions/index.backup.json`]);
    });

    test('resetSessionsAndSettingsToDefault also clears backup files', async () => {
        const { svc } = createService();
        let sessionsReset = false;
        let backupsCleared = false;
        svc.resetSessionsToDefault = () => {
            sessionsReset = true;
            return Promise.resolve(true);
        };
        svc.clearBackupFiles = () => {
            backupsCleared = true;
            return Promise.resolve(true);
        };

        await svc.resetSessionsAndSettingsToDefault();

        expect(sessionsReset).toBe(true);
        expect(backupsCleared).toBe(true);
    });
});
