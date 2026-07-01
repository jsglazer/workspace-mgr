import { describe, test, expect } from 'vitest';
import {
    mergeOrder,
    reconcileSessionConflict,
    mergeDiscoveredSessions,
    conflictSessionName,
} from '../src/core/sync';
import type { Session, SessionData } from '../src/core/types';

function baseData(): SessionData {
    return {
        activeSessionId: 'a',
        sessions: { a: { id: 'a', name: 'A', modified: 100, layout: { a: 1 } } },
        sessionOrder: ['a'],
        sessionGroups: {},
        groups: {},
        groupOrder: [],
        activeGroupId: null,
    } as SessionData;
}

describe('sync merge helpers', () => {
    test('mergeOrder unions primary, secondary, and valid ids without duplicates', () => {
        expect(mergeOrder(['a', 'b'], ['b', 'c'], { a: 1, b: 1, c: 1, d: 1 })).toEqual(['a', 'b', 'c', 'd']);
        expect(mergeOrder(['a', 'gone'], ['b'], { a: 1, b: 1 })).toEqual(['a', 'b']);
    });

    // §4: given two versions of one session, the newer modified timestamp wins.
    test('reconcile: newer identical-content copy is adopted; older is ignored', () => {
        const local: Session = { id: 's', name: 'S', modified: 100, layout: { x: 1 } };
        const newerSame: Session = { id: 's', name: 'S2', modified: 200, layout: { x: 1 } };
        const olderSame: Session = { id: 's', name: 'S0', modified: 50, layout: { x: 1 } };
        expect(reconcileSessionConflict(local, newerSame, 'ISO').kept.name).toBe('S2');
        expect(reconcileSessionConflict(local, newerSame, 'ISO').duplicate).toBeNull();
        expect(reconcileSessionConflict(local, olderSame, 'ISO').kept.name).toBe('S');
    });

    // §4: a diverging newer session yields a duplicated '(Conflict - <ts>)' session
    // rather than an overwrite, and no session is dropped.
    test('reconcile: diverging newer copy is duplicated, not overwritten', () => {
        const local: Session = { id: 's', name: 'S', modified: 100, layout: { x: 1 } };
        const newerDiverging: Session = { id: 's', name: 'S', modified: 200, layout: { y: 2 } };
        const result = reconcileSessionConflict(local, newerDiverging, '2026-07-01T00:00:00.000Z');
        expect(result.kept.layout).toEqual({ x: 1 }); // local preserved, not overwritten
        expect(result.duplicate).not.toBeNull();
        expect(result.duplicate!.layout).toEqual({ y: 2 });
        expect(result.duplicate!.name).toBe(conflictSessionName('S', '2026-07-01T00:00:00.000Z'));
        expect(result.duplicate!.name).toMatch(/\(Conflict - 2026-07-01T00:00:00\.000Z\)/);
    });

    // §4: the directory scanner auto-merges unregistered session files.
    test('mergeDiscoveredSessions adds orphan files not present in the index', () => {
        const data = baseData();
        const discovered: Session[] = [{ id: 'b', name: 'Orphan B', modified: 5, layout: { b: 1 } }];
        const { merged, addedOrphanIds, conflictIds } = mergeDiscoveredSessions(data, discovered, {
            generateId: () => 'dup',
        });
        expect(addedOrphanIds).toEqual(['b']);
        expect(conflictIds).toEqual([]);
        expect(merged.sessions.b.name).toBe('Orphan B');
        expect(merged.sessionOrder).toContain('b');
        // original data is not mutated
        expect(data.sessions.b).toBeUndefined();
    });

    test('mergeDiscoveredSessions duplicates a diverging newer id collision and never deletes', () => {
        const data = baseData();
        data.sessions.a = { id: 'a', name: 'A', modified: 100, layout: { a: 1 } };
        const discovered: Session[] = [{ id: 'a', name: 'A', modified: 300, layout: { a: 999 } }];
        const { merged, conflictIds } = mergeDiscoveredSessions(data, discovered, {
            now: Date.parse('2026-07-01T00:00:00.000Z'),
            generateId: () => 'conflict-id',
        });
        expect(merged.sessions.a.layout).toEqual({ a: 1 }); // local kept
        expect(conflictIds).toEqual(['conflict-id']);
        expect(merged.sessions['conflict-id'].layout).toEqual({ a: 999 });
        expect(merged.sessions['conflict-id'].name).toMatch(/\(Conflict - /);
        expect(Object.keys(merged.sessions).length).toBe(2);
    });
});
