import { describe, test, expect, beforeAll } from 'vitest';
import * as i18n from '../src/i18n';
import { SessionService } from '../src/core/session-service';
import type { AppLike } from '../src/core/host';
import type { Layout, Session, SessionData } from '../src/core/types';

// Ported from reference tests/session-saving.test.js.
beforeAll(() => {
    i18n.resolveLocale('en');
});

function createService(initialData: Partial<SessionData> = {}) {
    const svc = new SessionService();
    svc.data = Object.assign(
        {
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            autoSaveOnSwitch: true,
            warnOnUnsavedSwitch: true,
            highlightUnsavedSessionChanges: true,
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'old' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'target' }, modified: 1 },
            },
        },
        initialData,
    ) as SessionData;

    const state = {
        persistCalls: 0,
        statusBarUpdates: 0,
        commandSyncs: 0,
        historyPushes: [] as (string | null)[],
        historyStarts: 0,
        historyStops: 0,
        changeLayoutCalls: [] as unknown[],
    };

    svc.getActiveSession = () => svc.data.sessions[svc.data.activeSessionId as string] || null;
    svc.getCurrentWorkspaceLayout = () => ({ layout: 'current' } as Layout);
    svc.layoutsEqualStructural = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    svc.getDefaultSessionName = () => 'Default';
    svc.pushLayoutToHistory = (session: Session | null) => {
        state.historyPushes.push(session ? session.id : null);
    };
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
    svc.createSessionRecord = (id, name, layout, options) => ({
        id,
        name,
        layout: layout ?? undefined,
        modified: typeof options?.modified === 'number' ? options.modified : Date.now(),
    });
    svc.insertSessionAndActivate = (session: Session) => {
        svc.data.sessions[session.id] = session;
        svc.data.sessionOrder.push(session.id);
        svc.data.activeSessionId = session.id;
    };
    svc.startHistorySnapshotTimer = () => {
        state.historyStarts += 1;
    };
    svc.stopHistorySnapshotTimer = () => {
        state.historyStops += 1;
    };
    svc.app = {
        workspace: {
            changeLayout: (layout: unknown) => {
                state.changeLayoutCalls.push(layout);
                return Promise.resolve(true);
            },
        },
    } as unknown as AppLike;
    return { svc, state };
}

describe('session-saving', () => {
    test('toggles auto-save side effects together', async () => {
        const { svc, state } = createService();
        const off = await svc.setAutoSaveOnSwitch(false);
        const on = await svc.setAutoSaveOnSwitch(true);
        expect(off).toBe(false);
        expect(on).toBe(true);
        expect(state.historyStops).toBe(1);
        expect(state.historyStarts).toBe(1);
        expect(state.statusBarUpdates).toBe(2);
        expect(state.persistCalls).toBe(2);
    });

    test('captures active layout only when auto-save is enabled', () => {
        const { svc, state } = createService();
        svc.captureActiveSessionLayoutIfAutoSave();
        svc.data.autoSaveOnSwitch = false;
        svc.captureActiveSessionLayoutIfAutoSave();
        expect(state.historyPushes).toEqual(['a']);
        expect(svc.data.sessions.a.layout).toEqual({ layout: 'current' });
        expect(svc.data.sessions.a.modified).not.toBe(1);
    });

    test('dirty check tolerates layout being unavailable during startup', () => {
        const { svc } = createService();
        svc.getCurrentWorkspaceLayout = () => {
            throw new Error('layout not ready');
        };
        expect(svc.isActiveSessionDirty()).toBe(false);
        expect(svc.shouldShowUnsavedStatusBarHighlight()).toBe(false);
    });

    test('saves active session and reports whether layout changed', async () => {
        const { svc, state } = createService();
        const changed = await svc.saveActiveSession({ silent: true });
        const unchanged = await svc.saveActiveSession({ silent: true });
        expect(changed).toBe(true);
        expect(unchanged).toBe(false);
        expect(state.historyPushes).toEqual(['a', 'a']);
        expect(state.statusBarUpdates).toBe(2);
        expect(state.persistCalls).toBe(2);
    });

    test('saves current layout as a new named session', async () => {
        const { svc, state } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a'],
            sessions: { a: { id: 'a', name: 'A', layout: { layout: 'old' }, modified: 1 } },
        });
        const result = await svc.saveCurrentLayoutAsSessionName('Project Note', { silent: true });
        const created = svc.data.sessions[result.sessionId as string];
        expect(result.saved).toBe(true);
        expect(result.created).toBe(true);
        expect(result.overwritten).toBe(false);
        expect(created.name).toBe('Project Note');
        expect(created.layout).toEqual({ layout: 'current' });
        expect(svc.data.activeSessionId).toBe(result.sessionId);
        expect(state.persistCalls).toBe(1);
    });

    test('overwrites an existing named session from current layout', async () => {
        const { svc, state } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'old-a' }, modified: 1 },
                b: { id: 'b', name: 'Project Note', layout: { layout: 'old-b' }, modified: 1 },
            },
            autoSaveOnSwitch: true,
        });
        const result = await svc.saveCurrentLayoutAsSessionName('Project Note', { silent: true });
        expect(result.saved).toBe(true);
        expect(result.created).toBe(false);
        expect(result.overwritten).toBe(true);
        expect(result.sessionId).toBe('b');
        expect(svc.data.activeSessionId).toBe('b');
        expect(svc.data.sessions.a.layout).toEqual({ layout: 'current' });
        expect(svc.data.sessions.b.layout).toEqual({ layout: 'current' });
        expect(state.historyPushes).toEqual(['a', 'b']);
        expect(state.persistCalls).toBe(1);
    });

    test('preserves existing session group membership and switches view to that group', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            activeGroupId: 'g1',
            groupOrder: ['__all__', 'g1', 'g2'],
            groups: { g1: { id: 'g1', name: 'One' }, g2: { id: 'g2', name: 'Two' } },
            sessionGroups: { b: ['g2'] },
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'old-a' }, modified: 1 },
                b: { id: 'b', name: 'Project Note', layout: { layout: 'old-b' }, modified: 1 },
            },
        });
        const result = await svc.saveCurrentLayoutAsSessionName('Project Note', { silent: true });
        expect(result.sessionId).toBe('b');
        expect(svc.data.activeGroupId).toBe('g2');
        expect(svc.data.sessionGroups.b).toEqual(['g2']);
    });

    test('switches to all sessions view when overwriting an ungrouped session', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            activeGroupId: 'g1',
            groupOrder: ['__all__', 'g1'],
            groups: { g1: { id: 'g1', name: 'One' } },
            sessionGroups: { a: ['g1'] },
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'old-a' }, modified: 1 },
                b: { id: 'b', name: 'Project Note', layout: { layout: 'old-b' }, modified: 1 },
            },
        });
        const result = await svc.saveCurrentLayoutAsSessionName('Project Note', { silent: true });
        expect(result.sessionId).toBe('b');
        expect(svc.data.activeGroupId).toBe(null);
        expect(svc.data.sessionGroups.b).toBeUndefined();
    });

    test('reloads current session layout without persisting', async () => {
        const { svc, state } = createService({ activeSessionId: 'b' });
        const reloaded = await svc.reloadCurrentSessionWithoutSaving({ silent: true });
        expect(reloaded).toBe(true);
        expect(state.changeLayoutCalls).toEqual([{ layout: 'target' }]);
        expect(state.persistCalls).toBe(0);
    });
});
