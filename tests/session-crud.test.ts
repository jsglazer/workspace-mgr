import { describe, test, expect, beforeAll } from 'vitest';
import * as i18n from '../src/i18n';
import { SessionService } from '../src/core/session-service';
import type { AppLike } from '../src/core/host';
import type { Layout, SessionData } from '../src/core/types';

// Ported from reference tests/session-crud.test.js.
beforeAll(() => {
    i18n.resolveLocale('en');
});

function createService(initialData: Partial<SessionData> = {}) {
    const svc = new SessionService();
    svc.data = Object.assign(
        {
            activeSessionId: 'a',
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
            },
            sessionOrder: ['a', 'b'],
            sessionGroups: {},
            groups: {},
            groupOrder: [],
            activeGroupId: null,
        },
        initialData,
    ) as SessionData;
    const state = {
        persistCalls: 0,
        statusBarUpdates: 0,
        commandSyncs: 0,
        attachedSessions: [] as string[],
        detachedLeaves: 0,
    };
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
    svc.attachSessionToActiveGroup = (sessionId: string) => {
        state.attachedSessions.push(sessionId);
    };
    svc.captureActiveSessionLayoutIfAutoSave = () => {};
    svc.hideSwitchOverlay = () => {};
    svc.app = {
        workspace: {
            changeLayout: () => Promise.resolve(true),
            iterateRootLeaves: (callback: (leaf: { detach(): void }) => void) => {
                callback({ detach: () => (state.detachedLeaves += 1) });
                callback({ detach: () => (state.detachedLeaves += 1) });
            },
        },
    } as unknown as AppLike;
    return { svc, state };
}

describe('session-crud', () => {
    test('creates and activates a new session', async () => {
        const { svc, state } = createService();
        await svc.createSession('New');
        expect(Object.keys(svc.data.sessions).length).toBe(3);
        expect(svc.data.sessions[svc.data.activeSessionId as string].name).toBe('New');
        expect(svc.data.sessionOrder[2]).toBe(svc.data.activeSessionId);
        expect(state.attachedSessions).toEqual([svc.data.activeSessionId]);
        expect(state.statusBarUpdates).toBe(1);
        expect(state.commandSyncs).toBe(1);
        expect(state.persistCalls).toBe(1);
    });

    test('duplicates an arbitrary session without switching', async () => {
        const { svc, state } = createService({ sessionGroups: { b: ['g1', 'g2'] } });
        await svc.duplicateSession('b');
        expect(svc.data.activeSessionId).toBe('a');
        expect(svc.data.sessionOrder.length).toBe(3);
        const newId = svc.data.sessionOrder[2];
        expect(newId).not.toBe('b');
        expect(svc.data.sessions[newId].layout).toEqual({ layout: 'b' });
        expect(svc.data.sessions[newId].layout).not.toBe(svc.data.sessions.b.layout);
        expect(svc.data.sessionGroups[newId]).toEqual(['g1', 'g2']);
        expect(state.commandSyncs).toBe(1);
        expect(state.persistCalls).toBe(1);
    });

    test('resets sessions and group state to default', async () => {
        const { svc, state } = createService({
            sessionGroups: { a: ['g1'] },
            groups: { g1: { id: 'g1', name: 'Group' } },
            groupOrder: ['__all__', 'g1'],
            activeGroupId: 'g1',
        });
        await svc.resetSessionsToDefault();
        expect(Object.keys(svc.data.sessions).length).toBe(1);
        expect(svc.data.sessionOrder.length).toBe(1);
        expect(svc.data.activeSessionId).toBe(svc.data.sessionOrder[0]);
        expect(svc.data.sessions[svc.data.activeSessionId as string].isDefault).toBe(true);
        expect(svc.data.groups).toEqual({});
        expect(svc.data.groupOrder).toEqual([]);
        expect(svc.data.sessionGroups).toEqual({});
        expect(svc.data.activeGroupId).toBe(null);
        expect(state.statusBarUpdates).toBe(1);
        expect(state.commandSyncs).toBe(1);
        expect(state.persistCalls).toBe(1);
    });

    test('creates an empty session by detaching root leaves', async () => {
        const { svc, state } = createService();
        await svc.createEmptySession();
        expect(state.detachedLeaves).toBe(2);
        expect(svc.data.sessions[svc.data.activeSessionId as string].name).toBe('New session 1');
        expect(svc.data.sessions[svc.data.activeSessionId as string].layout).toEqual({ layout: 'current' });
        expect(state.persistCalls).toBe(1);
    });
});
