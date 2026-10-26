import { describe, test, expect, beforeAll } from 'vitest';
import * as i18n from '../src/i18n';
import { SessionService } from '../src/core/session-service';
import { buildSyncedSessionPayload, reconcileSessionConflict } from '../src/core/sync';
import {
    fitRectToWorkAreas,
    normalizeWindowBounds,
    normalizeWindowRestoreMode,
    pickWorkArea,
    resolveTargetRect,
} from '../src/core/window-bounds';
import type { AppLike } from '../src/core/host';
import type { Layout, Session, SessionData, WindowBounds } from '../src/core/types';

beforeAll(() => {
    i18n.resolveLocale('en');
});

// Two displays like the dev machine: a wide main one and a tall one to its left.
const MAIN = { x: 0, y: 30, width: 3200, height: 1770 };
const LEFT = { x: -1800, y: 30, width: 1800, height: 3170 };

describe('window bounds: fitting onto a visible display', () => {
    test('a window already on screen is left where it is', () => {
        const rect = { x: 100, y: 100, width: 1200, height: 900 };
        expect(fitRectToWorkAreas(rect, [MAIN, LEFT])).toEqual(rect);
    });

    test('a window pinned on a display that is gone is brought onto the nearest one', () => {
        const offScreen = { x: 5000, y: 200, width: 1000, height: 800 };
        const fitted = fitRectToWorkAreas(offScreen, [MAIN, LEFT]);
        expect(pickWorkArea(offScreen, [MAIN, LEFT])).toBe(MAIN);
        expect(fitted).toEqual({ x: 2200, y: 200, width: 1000, height: 800 });
    });

    test('a size larger than the work area shrinks to fit', () => {
        const huge = { x: -1700, y: 100, width: 2500, height: 4000 };
        expect(fitRectToWorkAreas(huge, [LEFT])).toEqual({ x: -1800, y: 30, width: 1800, height: 3170 });
    });

    test('the display the window overlaps most is the target', () => {
        const straddling = { x: -300, y: 100, width: 1000, height: 600 };
        expect(pickWorkArea(straddling, [MAIN, LEFT])).toBe(MAIN);
    });

    test('size mode keeps the current position and takes only the pinned size', () => {
        const pinned: WindowBounds = { x: -1500, y: 500, width: 1400, height: 1000 };
        const current = { x: 200, y: 100, width: 800, height: 600 };
        expect(resolveTargetRect(pinned, current, 'size', [MAIN, LEFT])).toEqual({ x: 200, y: 100, width: 1400, height: 1000 });
    });

    test('size + location mode moves the window to the pinned position', () => {
        const pinned: WindowBounds = { x: -1500, y: 500, width: 1400, height: 1000 };
        const current = { x: 200, y: 100, width: 800, height: 600 };
        expect(resolveTargetRect(pinned, current, 'size-location', [MAIN, LEFT])).toEqual({
            x: -1500,
            y: 500,
            width: 1400,
            height: 1000,
        });
    });

    test('normalizers reject unusable input', () => {
        expect(normalizeWindowBounds(null)).toBeNull();
        expect(normalizeWindowBounds({ x: 0, y: 0, width: 0, height: 10 })).toBeNull();
        expect(normalizeWindowBounds({ x: 1.4, y: 2, width: 3, height: 4, maximized: true, fullScreen: 'yes' })).toEqual({
            x: 1,
            y: 2,
            width: 3,
            height: 4,
            maximized: true,
        });
        expect(normalizeWindowRestoreMode('size-location')).toBe('size-location');
        expect(normalizeWindowRestoreMode('anything')).toBe('size');
    });
});

function createService() {
    const svc = new SessionService();
    svc.data = {
        activeSessionId: 'a',
        sessions: {
            a: { id: 'a', name: 'A', layout: { main: { a: true } }, modified: 1 },
            b: { id: 'b', name: 'B', layout: { main: { b: true } }, modified: 1, windowBounds: { x: 10, y: 20, width: 900, height: 700 } },
        },
        sessionOrder: ['a', 'b'],
        sessionGroups: {},
        groups: {},
        groupOrder: [],
        activeGroupId: null,
        autoSaveOnSwitch: false,
        warnOnUnsavedSwitch: false,
        versionHistoryEnabled: false,
    } as unknown as SessionData;
    const restored: WindowBounds[] = [];
    svc.getCurrentWorkspaceLayout = () => ({ main: { current: true } } as Layout);
    svc.updateStatusBar = () => {};
    svc.syncSessionCommands = () => {};
    svc.persistData = () => Promise.resolve(true);
    svc.restoreWindowBounds = (bounds) => restored.push(bounds);
    svc.app = { workspace: { changeLayout: () => Promise.resolve() } } as unknown as AppLike;
    return { svc, restored };
}

describe('window bounds: pinned on the session', () => {
    test('pinning records the bounds and stamps the session so the change syncs', async () => {
        const { svc } = createService();
        const ok = await svc.pinWindowBounds('a', { x: 5, y: 6, width: 1000, height: 800, maximized: true });
        expect(ok).toBe(true);
        expect(svc.data.sessions.a.windowBounds).toEqual({ x: 5, y: 6, width: 1000, height: 800, maximized: true });
        expect(svc.data.sessions.a.modified).toBeGreaterThan(1);
    });

    test('a normal save does not change the pinned bounds', async () => {
        const { svc } = createService();
        svc.data.activeSessionId = 'b';
        await svc.saveActiveSession({ silent: true });
        expect(svc.data.sessions.b.layout).toEqual({ main: { current: true } });
        expect(svc.data.sessions.b.windowBounds).toEqual({ x: 10, y: 20, width: 900, height: 700 });
    });

    test('clearing removes the bounds; clearing again reports nothing to do', async () => {
        const { svc } = createService();
        expect(await svc.clearWindowBounds('b')).toBe(true);
        expect(svc.data.sessions.b.windowBounds).toBeUndefined();
        expect(await svc.clearWindowBounds('b')).toBe(false);
    });

    test('switching to a pinned workspace restores its bounds; an unpinned one does not', async () => {
        const { svc, restored } = createService();
        await svc.switchSession('b');
        expect(restored).toEqual([{ x: 10, y: 20, width: 900, height: 700 }]);
        await svc.switchSession('a');
        expect(restored).toHaveLength(1);
    });

    test('duplicating a session copies its pinned bounds', async () => {
        const { svc } = createService();
        await svc.duplicateSession('b');
        const copy = Object.values(svc.data.sessions).find((s) => s.id !== 'a' && s.id !== 'b') as Session;
        expect(copy.windowBounds).toEqual({ x: 10, y: 20, width: 900, height: 700 });
    });

    test('the restore mode setting defaults to size only', async () => {
        const { svc } = createService();
        expect(svc.getWindowRestoreMode()).toBe('size');
        await svc.setWindowRestoreMode('size-location');
        expect(svc.getWindowRestoreMode()).toBe('size-location');
    });
});

describe('window bounds: sync', () => {
    test('pinned bounds travel in the synced payload', () => {
        const payload = buildSyncedSessionPayload({
            sessions: {
                a: { id: 'a', name: 'A', modified: 1, windowBounds: { x: 1, y: 2, width: 3, height: 4 } },
            },
        } as Partial<SessionData>);
        expect((payload.sessions as Record<string, Session>).a.windowBounds).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    });

    test('a newer copy that only changed the pinned bounds is adopted without a conflict copy', () => {
        const local: Session = { id: 'a', name: 'A', modified: 1, layout: { main: {} } };
        const incoming: Session = { ...local, modified: 2, windowBounds: { x: 1, y: 2, width: 3, height: 4 } };
        const { kept, duplicate } = reconcileSessionConflict(local, incoming, '2026-01-01T00:00:00Z');
        expect(duplicate).toBeNull();
        expect(kept.windowBounds).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    });
});
