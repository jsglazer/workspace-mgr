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

    test('duplicate a group creates a new group with the same session membership', async () => {
        const { svc } = createService({
            groups: { g1: { id: 'g1', name: 'One' } },
            sessions: { s1: { id: 's1', name: 'A' }, s2: { id: 's2', name: 'B' } },
            sessionGroups: { s1: ['g1'], s2: ['g1'] },
        });
        const newGroupId = await svc.duplicateGroup('g1');
        expect(typeof newGroupId).toBe('string');
        expect(svc.data.groups[newGroupId as string].name).toBe('One copy');
        expect(svc.data.sessionGroups.s1.sort()).toEqual(['g1', newGroupId].sort());
        expect(svc.data.sessionGroups.s2.sort()).toEqual(['g1', newGroupId].sort());
        // Original group membership is untouched.
        expect(svc.getGroupSessionIds('g1').sort()).toEqual(['s1', 's2']);
    });

    test('duplicate a group avoids name collisions', async () => {
        const { svc } = createService({
            groups: {
                g1: { id: 'g1', name: 'One' },
                g2: { id: 'g2', name: 'One copy' },
            },
        });
        const newGroupId = await svc.duplicateGroup('g1');
        expect(svc.data.groups[newGroupId as string].name).toBe('One copy 2');
    });

    test('duplicate a non-existent group is a no-op', async () => {
        const { svc } = createService();
        const result = await svc.duplicateGroup('missing');
        expect(result).toBe(false);
    });

    test('addSessionToGroup joins a session to a group without evicting existing memberships', async () => {
        const { svc } = createService({
            groups: { g1: { id: 'g1', name: 'One' }, g2: { id: 'g2', name: 'Two' } },
            sessions: { s1: { id: 's1', name: 'Session' } },
            sessionGroups: { s1: ['g1'] },
        });
        const added = await svc.addSessionToGroup('s1', 'g2');
        expect(added).toBe(true);
        expect(svc.data.sessionGroups.s1.sort()).toEqual(['g1', 'g2']);
    });

    test('addSessionToGroup is a no-op when already a member', async () => {
        const { svc } = createService({
            groups: { g1: { id: 'g1', name: 'One' } },
            sessions: { s1: { id: 's1', name: 'Session' } },
            sessionGroups: { s1: ['g1'] },
        });
        const added = await svc.addSessionToGroup('s1', 'g1');
        expect(added).toBe(false);
        expect(svc.data.sessionGroups.s1).toEqual(['g1']);
    });

    test('removeSessionFromGroup leaves a group while keeping other memberships', async () => {
        const { svc } = createService({
            groups: { g1: { id: 'g1', name: 'One' }, g2: { id: 'g2', name: 'Two' } },
            sessions: { s1: { id: 's1', name: 'Session' } },
            sessionGroups: { s1: ['g1', 'g2'] },
        });
        const removed = await svc.removeSessionFromGroup('s1', 'g1');
        expect(removed).toBe(true);
        expect(svc.data.sessionGroups.s1).toEqual(['g2']);
    });

    test('removeSessionFromGroup deletes the entry once the last group is left', async () => {
        const { svc } = createService({
            groups: { g1: { id: 'g1', name: 'One' } },
            sessions: { s1: { id: 's1', name: 'Session' } },
            sessionGroups: { s1: ['g1'] },
        });
        const removed = await svc.removeSessionFromGroup('s1', 'g1');
        expect(removed).toBe(true);
        expect(svc.data.sessionGroups.s1).toBeUndefined();
    });

    test('removeSessionFromGroup is a no-op when not a member', async () => {
        const { svc } = createService({
            groups: { g1: { id: 'g1', name: 'One' } },
            sessions: { s1: { id: 's1', name: 'Session' } },
            sessionGroups: {},
        });
        const removed = await svc.removeSessionFromGroup('s1', 'g1');
        expect(removed).toBe(false);
    });
});
