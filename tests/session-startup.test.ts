import { describe, test, expect } from 'vitest';
import { SessionService } from '../src/core/session-service';
import type { Layout, SessionData } from '../src/core/types';

// Ported from reference tests/session-startup.test.js.
function createService(initialData: Partial<SessionData> = {}) {
    const svc = new SessionService();
    svc.data = Object.assign(
        {
            activeSessionId: 'a',
            autoSaveOnSwitch: true,
            sessions: { a: { id: 'a', name: 'A', layout: { layout: 'old' }, modified: 1 } },
        },
        initialData,
    ) as SessionData;
    const counters = { historyPushes: 0, persistCalls: 0, flushCalls: 0 };
    svc.isAutoSaveOnSwitchEnabled = () => svc.data.autoSaveOnSwitch !== false;
    svc.getActiveSession = () => svc.data.sessions[svc.data.activeSessionId as string] || null;
    svc.getCurrentWorkspaceLayout = () => ({ layout: 'current' } as Layout);
    svc.pushLayoutToHistory = () => {
        counters.historyPushes += 1;
    };
    svc.persistData = () => {
        counters.persistCalls += 1;
        return Promise.resolve(true);
    };
    return { svc, counters };
}

describe('session-startup', () => {
    test('flush captures the active layout when auto-save is enabled', async () => {
        const { svc, counters } = createService();
        await svc.flushOnStartup();
        expect(counters.historyPushes).toBe(1);
        expect(svc.data.sessions.a.layout).toEqual({ layout: 'current' });
        expect(svc.data.sessions.a.modified).not.toBe(1);
        expect(counters.persistCalls).toBe(1);
    });

    test('flush does nothing when auto-save is disabled', async () => {
        const { svc, counters } = createService({ autoSaveOnSwitch: false });
        const result = await svc.scheduleStartupFlush();
        expect(result).toBe(false);
        expect(counters.historyPushes).toBe(0);
        expect(counters.persistCalls).toBe(0);
    });

    test('layout changes extend the settle deadline', () => {
        const { svc, counters } = createService();
        svc.scheduleStartupFlush = () => {
            counters.flushCalls += 1;
            return Promise.resolve(true);
        };
        svc.startStartupSettleWindow(20);
        const before = svc.startupSettleUntil;
        svc.noteStartupLayoutChange();
        expect(svc.startupSettleUntil >= before).toBe(true);
        expect(counters.flushCalls).toBe(svc.startupSettleUntil > before ? 1 : 0);
        if (svc.startupSettleTimer) clearTimeout(svc.startupSettleTimer);
    });
});
