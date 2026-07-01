import { describe, test, expect } from 'vitest';
import { SessionService } from '../src/core/session-service';
import type { SessionData } from '../src/core/types';

// Ported from reference tests/groups.test.js.
function createService(initialData: Partial<SessionData> = {}) {
    const svc = new SessionService();
    svc.data = Object.assign(
        {
            activeGroupId: null,
            groupFeatureEnabled: true,
            groups: {},
            groupOrder: [],
            sessionGroups: {},
            sessions: {},
            sessionOrder: [],
        },
        initialData,
    ) as SessionData;
    const counters = {
        persistCalls: 0,
        commandSyncs: 0,
        statusBarUpdates: 0,
        switchOverlayHides: 0,
        searchOverlayHides: 0,
    };
    svc.persistData = () => {
        counters.persistCalls += 1;
        return Promise.resolve(true);
    };
    svc.syncSessionCommands = () => {
        counters.commandSyncs += 1;
    };
    svc.updateStatusBar = () => {
        counters.statusBarUpdates += 1;
    };
    svc.hideSwitchOverlay = () => {
        counters.switchOverlayHides += 1;
    };
    svc.hideSearchOverlay = () => {
        counters.searchOverlayHides += 1;
    };
    svc.switchSession = () => Promise.resolve(false);
    return { svc, counters };
}

describe('groups', () => {
    test('normalize tab order around existing groups', () => {
        const { svc } = createService({
            groups: { g1: { id: 'g1', name: 'One' }, g2: { id: 'g2', name: 'Two' } },
        });
        expect(svc.normalizeGroupTabOrder(['g2', 'missing', '__all__', 'g2'])).toEqual(['g2', '__all__', 'g1']);
    });

    test('disabling feature clears active group and hides open views', async () => {
        const { svc, counters } = createService({
            activeGroupId: 'g1',
            groups: { g1: { id: 'g1', name: 'One' } },
        });
        const changed = await svc.setGroupFeatureEnabled(false);
        expect(changed).toBe(true);
        expect(svc.data.groupFeatureEnabled).toBe(false);
        expect(svc.data.activeGroupId).toBe(null);
        expect(counters.switchOverlayHides).toBe(1);
        expect(counters.searchOverlayHides).toBe(1);
        expect(counters.commandSyncs).toBe(1);
        expect(counters.statusBarUpdates).toBe(1);
        expect(counters.persistCalls).toBe(1);
    });

    test('attach new sessions to active group without duplicates', () => {
        const { svc } = createService({
            activeGroupId: 'g1',
            groups: { g1: { id: 'g1', name: 'One' } },
            sessionGroups: { s1: ['g1'] },
        });
        svc.attachSessionToActiveGroup('s1');
        svc.attachSessionToActiveGroup('s2');
        expect(svc.data.sessionGroups.s1).toEqual(['g1']);
        expect(svc.data.sessionGroups.s2).toEqual(['g1']);
    });

    test('move a session to one group exclusively', async () => {
        const { svc, counters } = createService({
            groups: { g1: { id: 'g1', name: 'One' }, g2: { id: 'g2', name: 'Two' } },
            sessions: { s1: { id: 's1', name: 'Session' } },
            sessionGroups: { s1: ['g1'] },
        });
        const moved = await svc.moveSessionToGroupExclusive('s1', 'g2', { persist: false });
        expect(moved).toBe(true);
        expect(svc.data.sessionGroups.s1).toEqual(['g2']);
        expect(counters.commandSyncs).toBe(1);
        expect(counters.persistCalls).toBe(0);
    });
});
