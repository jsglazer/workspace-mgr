import { describe, test, expect } from 'vitest';
import { SessionService } from '../src/core/session-service';
import type { SessionData } from '../src/core/types';

// Ported from reference tests/settings-state.test.js.
function createService(initialData: Partial<SessionData> = {}) {
    const svc = new SessionService();
    svc.data = Object.assign(
        { statusBarActions: null, numberedSwitchCommands: true, versionHistoryEnabled: true },
        initialData,
    ) as SessionData;
    const counters = { persistCalls: 0, statusBarUpdates: 0, commandSyncs: 0, historyStarts: 0, historyStops: 0 };
    svc.persistData = () => {
        counters.persistCalls += 1;
        return Promise.resolve(true);
    };
    svc.updateStatusBar = () => {
        counters.statusBarUpdates += 1;
    };
    svc.syncSessionCommands = () => {
        counters.commandSyncs += 1;
    };
    svc.startHistorySnapshotTimer = () => {
        counters.historyStarts += 1;
    };
    svc.stopHistorySnapshotTimer = () => {
        counters.historyStops += 1;
    };
    return { svc, counters };
}

describe('settings-state', () => {
    test('initializes status bar actions before setting a slot', async () => {
        const { svc, counters } = createService({ statusBarActions: null });
        await svc.setStatusBarAction('click', 'sessionManager');
        expect(svc.data.statusBarActions!.click).toBe('sessionManager');
        expect(svc.data.statusBarActions!.rightClick).toBe('sessionMenu');
        expect(counters.persistCalls).toBe(1);
    });

    test('can skip persistence for batch callers', async () => {
        const { svc, counters } = createService();
        await svc.setWarnOnUnsavedSwitch(false, { persist: false });
        expect(svc.data.warnOnUnsavedSwitch).toBe(false);
        expect(counters.persistCalls).toBe(0);
    });

    test('keeps status bar highlight side effects together', async () => {
        const { svc, counters } = createService();
        await svc.setUnsavedStatusBarHighlight(false);
        expect(svc.data.highlightUnsavedSessionChanges).toBe(false);
        expect(counters.statusBarUpdates).toBe(1);
        expect(counters.persistCalls).toBe(1);
    });

    test('syncs commands when numbered command setting changes', async () => {
        const { svc, counters } = createService();
        await svc.setNumberedSwitchCommands(false);
        expect(svc.data.numberedSwitchCommands).toBe(false);
        expect(counters.commandSyncs).toBe(1);
        expect(counters.persistCalls).toBe(1);
    });

    test('stores sidebar restore preference', async () => {
        const { svc, counters } = createService({ restoreSidebars: true });
        await svc.setRestoreSidebars(false);
        expect(svc.data.restoreSidebars).toBe(false);
        expect(counters.persistCalls).toBe(1);
    });

    test('stores light/dark status-bar name colours independently', async () => {
        const { svc, counters } = createService();
        await svc.setStatusBarNameColorLight('#ff0000');
        await svc.setStatusBarNameColorDark('#00ff00');
        expect(svc.data.statusBarNameColorLight).toBe('#ff0000');
        expect(svc.data.statusBarNameColorDark).toBe('#00ff00');
        expect(counters.persistCalls).toBe(2);
    });

    test('stores light/dark unsaved-highlight colours independently', async () => {
        const { svc, counters } = createService();
        await svc.setUnsavedHighlightColorLight('#111111');
        await svc.setUnsavedHighlightColorDark('#222222');
        expect(svc.data.unsavedHighlightColorLight).toBe('#111111');
        expect(svc.data.unsavedHighlightColorDark).toBe('#222222');
        expect(counters.persistCalls).toBe(2);
    });

    test('starts and stops version history timer with the setting', async () => {
        const { svc, counters } = createService();
        await svc.setVersionHistoryEnabled(false);
        await svc.setVersionHistoryEnabled(true);
        await svc.setVersionHistorySnapshotInterval('10');
        expect(svc.data.versionHistoryEnabled).toBe(true);
        expect(svc.data.versionHistorySnapshotInterval).toBe(10);
        expect(counters.historyStops).toBe(1);
        expect(counters.historyStarts).toBe(2);
        expect(counters.persistCalls).toBe(3);
    });
});
