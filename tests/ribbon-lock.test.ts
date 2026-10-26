import { describe, test, expect, beforeAll } from 'vitest';
import * as i18n from '../src/i18n';
import { SessionService } from '../src/core/session-service';
import { PersistenceService } from '../src/core/persistence-service';
import { buildSyncedSessionPayload } from '../src/core/sync';
import {
    buildLockedRibbon,
    mergeRibbonLock,
    normalizeRibbonLock,
    ribbonMatches,
    stampRibbonIntoLayout,
    type RibbonHiddenItems,
} from '../src/core/ribbon-lock';
import { RibbonLockController } from '../src/ribbon-lock-controller';
import type { RibbonAdapter } from '../src/adapter/ribbon-adapter';
import type { AppLike } from '../src/core/host';
import type { Layout, SessionData } from '../src/core/types';

beforeAll(() => {
    i18n.resolveLocale('en');
});

describe('ribbon lock: pure helpers', () => {
    test('pinned entries keep their order; unknown live items are appended hidden by default', () => {
        const pin = { 'p:B': false, 'p:A': true };
        const locked = buildLockedRibbon(pin, ['p:A', 'p:New', 'p:B'], true);
        expect(Object.keys(locked.hiddenItems)).toEqual(['p:B', 'p:A', 'p:New']);
        expect(locked.hiddenItems).toEqual({ 'p:B': false, 'p:A': true, 'p:New': true });
        expect(locked.unknownIds).toEqual(['p:New']);
    });

    test('unknown items can be appended shown', () => {
        const locked = buildLockedRibbon({ 'p:A': false }, ['p:New', 'p:A'], false);
        expect(locked.hiddenItems).toEqual({ 'p:A': false, 'p:New': false });
    });

    test('pinned entries for a missing plugin are kept but never force a re-apply', () => {
        const locked = buildLockedRibbon({ 'p:Gone': false, 'p:A': false, 'p:B': true }, ['p:A', 'p:B'], true);
        expect(Object.keys(locked.hiddenItems)).toEqual(['p:Gone', 'p:A', 'p:B']);
        expect(ribbonMatches({ 'p:A': false, 'p:B': true }, locked.hiddenItems)).toBe(true);
    });

    test('ribbonMatches notices a reorder and a visibility change', () => {
        const expected = { 'p:A': false, 'p:B': true };
        expect(ribbonMatches({ 'p:B': true, 'p:A': false }, expected)).toBe(false);
        expect(ribbonMatches({ 'p:A': false, 'p:B': false }, expected)).toBe(false);
        expect(ribbonMatches({ 'p:A': false, 'p:B': true, 'p:C': false }, expected)).toBe(false);
    });

    test('stamping replaces only the left ribbon', () => {
        const layout = { main: { x: 1 }, 'left-ribbon': { hiddenItems: { old: true } } } as Layout;
        expect(stampRibbonIntoLayout(layout, { 'p:A': false })).toEqual({
            main: { x: 1 },
            'left-ribbon': { hiddenItems: { 'p:A': false } },
        });
        expect(layout['left-ribbon']).toEqual({ hiddenItems: { old: true } });
    });

    test('the later lock wins a merge, and an unlock is a lock change like any other', () => {
        const locked = { enabled: true, hiddenItems: { 'p:A': false }, modified: 10 };
        const unlocked = { enabled: false, hiddenItems: { 'p:A': false }, modified: 20 };
        expect(mergeRibbonLock(locked, unlocked)).toEqual(unlocked);
        expect(mergeRibbonLock(unlocked, locked)).toEqual(unlocked);
        expect(mergeRibbonLock(null, locked)).toEqual(locked);
        expect(normalizeRibbonLock({ enabled: true, hiddenItems: {} })).toBeNull();
    });
});

function createService(lock: unknown = null) {
    const svc = new SessionService();
    svc.data = {
        activeSessionId: 'a',
        sessions: {
            a: { id: 'a', name: 'A', layout: { main: { a: true }, 'left-ribbon': { hiddenItems: { 'p:A': false } } }, modified: 1 },
        },
        sessionOrder: ['a'],
        sessionGroups: {},
        groups: {},
        groupOrder: [],
        activeGroupId: null,
        ribbonLock: lock,
        ribbonLockUnknownItems: 'hidden',
        ribbonLockAnnouncedIds: [],
    } as unknown as SessionData;
    const state = { persistCalls: 0 };
    svc.updateStatusBar = () => {};
    svc.syncSessionCommands = () => {};
    svc.persistData = () => {
        state.persistCalls += 1;
        return Promise.resolve(true);
    };
    svc.app = { workspace: { changeLayout: () => Promise.resolve() } } as unknown as AppLike;
    return { svc, state };
}

describe('ribbon lock: session service', () => {
    test('lock, update and unlock', async () => {
        const { svc } = createService();
        expect(svc.isRibbonLocked()).toBe(false);
        expect(await svc.lockRibbon({ 'p:B': true, 'p:A': false })).toBe(true);
        expect(svc.isRibbonLocked()).toBe(true);
        expect(Object.keys(svc.getRibbonLock()!.hiddenItems)).toEqual(['p:B', 'p:A']);
        expect(await svc.unlockRibbon()).toBe(true);
        expect(svc.isRibbonLocked()).toBe(false);
        // The pin survives the unlock so the lock can be re-applied later.
        expect(svc.getRibbonLock()!.hiddenItems).toEqual({ 'p:B': true, 'p:A': false });
        expect(await svc.unlockRibbon()).toBe(false);
    });

    test('while locked, a stale ribbon snapshot does not make the session look unsaved', () => {
        const { svc } = createService({ enabled: true, hiddenItems: { 'p:A': true }, modified: 1 });
        svc.getCurrentWorkspaceLayout = () => ({ main: { a: true }, 'left-ribbon': { hiddenItems: { 'p:A': true } } } as Layout);
        expect(svc.isActiveSessionDirty()).toBe(false);
        svc.data.ribbonLock = null;
        expect(svc.isActiveSessionDirty()).toBe(true);
    });

    test('unknown items are announced once', () => {
        const { svc } = createService();
        expect(svc.takeUnannouncedRibbonIds(['p:X', 'p:Y'])).toEqual(['p:X', 'p:Y']);
        expect(svc.takeUnannouncedRibbonIds(['p:X', 'p:Z'])).toEqual(['p:Z']);
    });
});

function fakeAdapter(initial: RibbonHiddenItems) {
    let live: RibbonHiddenItems = { ...initial };
    const applied: RibbonHiddenItems[] = [];
    const adapter: RibbonAdapter = {
        getHiddenItems: () => ({ ...live }),
        getLiveIds: () => Object.keys(live),
        getTitle: (id) => id.replace('p:', ''),
        apply: (hiddenItems) => {
            applied.push(hiddenItems);
            // Like Obsidian's load(): only items that exist, in the given order.
            const next: RibbonHiddenItems = {};
            for (const id of Object.keys(hiddenItems)) if (id in live) next[id] = hiddenItems[id];
            live = next;
        },
        getItemsEl: () => null,
    };
    return {
        adapter,
        applied,
        setLive: (next: RibbonHiddenItems) => {
            live = { ...next };
        },
    };
}

describe('ribbon lock: controller', () => {
    test('a layout load that changed the ribbon is reverted, and re-applying is idempotent', () => {
        const { svc } = createService({ enabled: true, hiddenItems: { 'p:A': false, 'p:B': true }, modified: 1 });
        const { adapter, applied, setLive } = fakeAdapter({ 'p:B': false, 'p:A': false });
        const notices: string[] = [];
        const ctl = new RibbonLockController(svc, adapter, (m) => notices.push(m));
        expect(ctl.enforce('layout')).toBe(true);
        expect(applied).toEqual([{ 'p:A': false, 'p:B': true }]);
        expect(ctl.enforce('layout')).toBe(false);
        expect(applied).toHaveLength(1);
        expect(notices).toEqual([]);
        setLive({ 'p:A': false, 'p:B': false });
        expect(ctl.enforce('hand-edit')).toBe(true);
        expect(notices).toEqual([i18n.L.ribbonLockRevertedNotice]);
    });

    test('a new icon is appended hidden and announced once, without the hand-edit notice', () => {
        const { svc } = createService({ enabled: true, hiddenItems: { 'p:A': false }, modified: 1 });
        const { adapter, applied } = fakeAdapter({ 'p:New': false, 'p:A': false });
        const notices: string[] = [];
        const ctl = new RibbonLockController(svc, adapter, (m) => notices.push(m));
        expect(ctl.enforce('hand-edit')).toBe(true);
        expect(applied).toEqual([{ 'p:A': false, 'p:New': true }]);
        expect(notices).toEqual([i18n.L.ribbonLockUnknownNotice('New')]);
        ctl.enforce('layout');
        expect(notices).toHaveLength(1);
    });

    test('stampLayout writes the lock into a layout, and does nothing while unlocked', () => {
        const { svc } = createService({ enabled: true, hiddenItems: { 'p:A': true }, modified: 1 });
        const { adapter } = fakeAdapter({ 'p:A': false });
        const ctl = new RibbonLockController(svc, adapter, () => {});
        const layout = { main: {}, 'left-ribbon': { hiddenItems: { 'p:A': false } } } as Layout;
        expect(ctl.stampLayout(layout)['left-ribbon']).toEqual({ hiddenItems: { 'p:A': true } });
        svc.data.ribbonLock = { enabled: false, hiddenItems: { 'p:A': true }, modified: 2 };
        expect(ctl.stampLayout(layout)).toBe(layout);
    });

    test('lockFromCurrent pins the live ribbon in order', async () => {
        const { svc } = createService();
        const { adapter } = fakeAdapter({ 'p:B': true, 'p:A': false });
        const ctl = new RibbonLockController(svc, adapter, () => {});
        await ctl.lockFromCurrent();
        expect(Object.keys(svc.getRibbonLock()!.hiddenItems)).toEqual(['p:B', 'p:A']);
    });
});

describe('ribbon lock: sync', () => {
    test('the lock rides in the synced payload, with its order intact', () => {
        const payload = buildSyncedSessionPayload({
            sessions: {},
            ribbonLock: { enabled: true, hiddenItems: { 'p:B': true, 'p:A': false }, modified: 5 },
        } as Partial<SessionData>);
        expect(Object.keys((payload.ribbonLock as { hiddenItems: object }).hiddenItems)).toEqual(['p:B', 'p:A']);
        expect(buildSyncedSessionPayload({ sessions: {} } as Partial<SessionData>).ribbonLock).toBeUndefined();
    });

    test('a lock made on another device is adopted; an older one does not undo a local unlock', () => {
        const svc = new PersistenceService();
        svc.manifest = { id: 'workspace-mgr', dir: '.obsidian/plugins/workspace-mgr' };
        svc.app = { vault: { adapter: {} } } as unknown as AppLike;
        svc.data = {
            activeSessionId: 'a',
            sessions: { a: { id: 'a', name: 'A', modified: 5, layout: {} } },
            sessionOrder: ['a'],
            sessionGroups: {},
            groups: {},
            groupOrder: [],
            activeGroupId: null,
        } as unknown as SessionData;
        svc.recordSessionStorageState(1, 1, svc.data);

        const remoteLock = { enabled: true, hiddenItems: { 'p:A': false }, modified: 100 };
        expect(
            svc.applyExternalDataJson({
                sessions: { a: { id: 'a', name: 'A', modified: 5, layout: {} } },
                sessionOrder: ['a'],
                activeSessionId: 'a',
                ribbonLock: remoteLock,
            } as Partial<SessionData>),
        ).toBe(true);
        expect(svc.data.ribbonLock).toEqual(remoteLock);

        svc.data.ribbonLock = { enabled: false, hiddenItems: { 'p:A': false }, modified: 200 };
        svc.applyExternalDataJson({
            sessions: { a: { id: 'a', name: 'A', modified: 5, layout: {} } },
            sessionOrder: ['a'],
            activeSessionId: 'a',
            ribbonLock: { ...remoteLock, hiddenItems: { 'p:A': false, 'p:B': true } },
        } as Partial<SessionData>);
        expect(svc.data.ribbonLock).toEqual({ enabled: false, hiddenItems: { 'p:A': false }, modified: 200 });
    });
});
