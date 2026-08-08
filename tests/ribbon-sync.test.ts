import { describe, test, expect, beforeAll } from 'vitest';
import * as i18n from '../src/i18n';
import { SessionService } from '../src/core/session-service';
import type { AppLike } from '../src/core/host';
import type { Layout, SessionData } from '../src/core/types';

beforeAll(() => {
    i18n.resolveLocale('en');
});

function createService(initialData: Partial<SessionData> = {}) {
    const svc = new SessionService();
    svc.data = Object.assign(
        {
            activeSessionId: 'a',
            sessions: {
                a: {
                    id: 'a',
                    name: 'A',
                    layout: { main: { a: true }, 'left-ribbon': { hiddenItems: { 'plugin:One': true, 'plugin:Two': false } } },
                    modified: 1,
                },
                b: { id: 'b', name: 'B', layout: { main: { b: true } }, modified: 1 },
                c: { id: 'c', name: 'C', layout: null, modified: 1 },
            },
            sessionOrder: ['a', 'b', 'c'],
            sessionGroups: {},
            groups: {},
            groupOrder: [],
            activeGroupId: null,
            ribbonSyncToFutureSessions: false,
            syncedRibbonHiddenItems: null,
        },
        initialData,
    ) as SessionData;
    const state = { persistCalls: 0, statusBarUpdates: 0, commandSyncs: 0 };
    svc.getCurrentWorkspaceLayout = () => ({ layout: 'current' } as Layout);
    svc.updateStatusBar = () => {
        state.statusBarUpdates += 1;
    };
    svc.syncSessionCommands = () => {
        state.commandSyncs += 1;
    };
    svc.persistData = () => {
        state.persistCalls += 1;
        return Promise.resolve(true);
    };
    svc.captureActiveSessionLayoutIfAutoSave = () => {};
    svc.app = { workspace: { changeLayout: () => Promise.resolve(true) } } as unknown as AppLike;
    return { svc, state };
}

describe('ribbon sync', () => {
    test('getRibbonHiddenItems returns a copy of the stored map, or null when absent', () => {
        const { svc } = createService();
        expect(svc.getRibbonHiddenItems('a')).toEqual({ 'plugin:One': true, 'plugin:Two': false });
        expect(svc.getRibbonHiddenItems('b')).toBeNull();
        expect(svc.getRibbonHiddenItems('c')).toBeNull();
        expect(svc.getRibbonHiddenItems('missing')).toBeNull();
    });

    test('syncRibbonFromSession replicates hidden-item visibility onto every other session', async () => {
        const { svc, state } = createService();
        const ok = await svc.syncRibbonFromSession('a');
        expect(ok).toBe(true);
        expect(svc.data.sessions.b.layout).toEqual({
            main: { b: true },
            'left-ribbon': { hiddenItems: { 'plugin:One': true, 'plugin:Two': false } },
        });
        expect(svc.data.sessions.c.layout).toEqual({
            'left-ribbon': { hiddenItems: { 'plugin:One': true, 'plugin:Two': false } },
        });
        // Source session itself is left untouched.
        expect(svc.data.sessions.a.layout).toEqual({
            main: { a: true },
            'left-ribbon': { hiddenItems: { 'plugin:One': true, 'plugin:Two': false } },
        });
        expect(svc.data.syncedRibbonHiddenItems).toEqual({ 'plugin:One': true, 'plugin:Two': false });
        expect(state.persistCalls).toBe(1);
    });

    test('syncRibbonFromSession is a no-op when the source has no saved ribbon state', async () => {
        const { svc, state } = createService();
        const ok = await svc.syncRibbonFromSession('b');
        expect(ok).toBe(false);
        expect(svc.data.sessions.c.layout).toBeNull();
        expect(state.persistCalls).toBe(0);
    });

    test('setRibbonSyncToFutureSessions persists the flag', async () => {
        const { svc, state } = createService();
        await svc.setRibbonSyncToFutureSessions(true);
        expect(svc.data.ribbonSyncToFutureSessions).toBe(true);
        expect(state.persistCalls).toBe(1);
    });

    test('new sessions inherit the synced ribbon only when sync-to-future is enabled', async () => {
        const { svc: unsynced } = createService();
        await unsynced.createSession('New');
        const unsyncedLayout = unsynced.data.sessions[unsynced.data.activeSessionId as string].layout;
        expect(unsyncedLayout).toEqual({ layout: 'current' });

        const { svc: synced } = createService({
            ribbonSyncToFutureSessions: true,
            syncedRibbonHiddenItems: { 'plugin:One': true },
        });
        await synced.createSession('New');
        const syncedLayout = synced.data.sessions[synced.data.activeSessionId as string].layout;
        expect(syncedLayout).toEqual({ layout: 'current', 'left-ribbon': { hiddenItems: { 'plugin:One': true } } });
    });
});
