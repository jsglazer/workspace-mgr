import { describe, test, expect, vi } from 'vitest';
import { SessionService } from '../src/core/session-service';
import type { Group, Session, SessionData } from '../src/core/types';

// A Menu stub that records what was added, so the menu's arrangement can be asserted.
type Entry = { kind: 'item'; title: string; disabled: boolean; cls: string[] } | { kind: 'sep' };
let lastMenu: { entries: Entry[] } | null = null;

vi.mock('obsidian', () => {
    class MenuItem {
        title = '';
        disabled = false;
        dom = { classList: { list: [] as string[], add(c: string) { this.list.push(c); } } };
        setTitle(t: string) { this.title = t; return this; }
        setIcon() { return this; }
        setChecked() { return this; }
        setDisabled(d: boolean) { this.disabled = d; return this; }
        onClick() { return this; }
    }
    class Menu {
        entries: Entry[] = [];
        constructor() { lastMenu = this; }
        addItem(cb: (item: MenuItem) => void) {
            const item = new MenuItem();
            cb(item);
            this.entries.push({ kind: 'item', title: item.title, disabled: item.disabled, cls: item.dom.classList.list });
            return this;
        }
        addSeparator() { this.entries.push({ kind: 'sep' }); return this; }
        showAtMouseEvent() {}
        showAtPosition() {}
    }
    return { Menu, Notice: class {} };
});
vi.mock('../src/i18n', () => ({
    L: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock('../src/modals', () => ({ SessionManagerModal: class {} }));
vi.mock('../src/session-context-actions', () => ({
    createSessionContextMenuOptions: () => new Proxy({}, { get: () => () => undefined }),
}));

import { buildWorkspaceMenu, addGroupedSessionItems } from '../src/workspace-menu';
import { Menu } from 'obsidian';

function createService(initialData: Partial<SessionData> = {}) {
    const svc = new SessionService();
    svc.data = Object.assign(
        {
            activeGroupId: null,
            groupFeatureEnabled: true,
            groups: {
                g1: { id: 'g1', name: 'Zeta' },
                g2: { id: 'g2', name: 'Alpha' },
                g3: { id: 'g3', name: 'Mid' },
            },
            groupOrder: ['__all__', 'g1', 'g2', 'g3'],
            sessionGroups: { s2: ['g1'], s3: ['g2'], s4: ['g3'] },
            sessions: {
                s1: { id: 's1', name: 'Loose' },
                s2: { id: 's2', name: 'InZeta' },
                s3: { id: 's3', name: 'InAlpha' },
                s4: { id: 's4', name: 'InMid' },
            },
            sessionOrder: ['s1', 's2', 's3', 's4'],
            activeSessionId: 's1',
        },
        initialData,
    ) as SessionData;
    let persistCalls = 0;
    svc.persistData = () => {
        persistCalls += 1;
        return Promise.resolve(true);
    };
    svc.syncSessionCommands = () => {};
    svc.updateStatusBar = () => {};
    return { svc, persists: () => persistCalls };
}

function menuPlugin(svc: SessionService) {
    return {
        app: {} as never,
        data: svc.data,
        getActiveSession: (): Session | null => svc.getActiveSession(),
        getOrderedSessions: (): Session[] => svc.getOrderedSessionsUnfiltered(),
        getOrderedGroups: (): Group[] => svc.getOrderedGroups(),
        getOrderedGroupTabIds: (): string[] => svc.getOrderedGroupTabIds(),
        getOrderedSessionsForGroup: (id: string | null): Session[] => svc.getOrderedSessionsForGroup(id),
        isGroupFeatureEnabled: () => svc.isGroupFeatureEnabled(),
        switchSession: () => Promise.resolve(true),
        openSaveCurrentLayoutMenu: () => {},
        updateStatusBar: () => {},
    };
}

const titles = (entries: Entry[]): string[] => entries.map((e) => (e.kind === 'sep' ? '---' : e.title));

describe('group order', () => {
    test('moves a group up and down and persists', async () => {
        const { svc, persists } = createService();
        expect(await svc.moveGroupInOrder('g3', -1)).toBe(true);
        expect(svc.data.groupOrder).toEqual(['__all__', 'g1', 'g3', 'g2']);
        expect(await svc.moveGroupInOrder('g1', 1)).toBe(true);
        expect(svc.data.groupOrder).toEqual(['__all__', 'g3', 'g1', 'g2']);
        expect(persists()).toBe(2);
    });

    test('Ungrouped moves like any group', async () => {
        const { svc } = createService();
        await svc.moveGroupInOrder('__all__', 1);
        await svc.moveGroupInOrder('__all__', 1);
        expect(svc.data.groupOrder).toEqual(['g1', 'g2', '__all__', 'g3']);
    });

    test('refuses moves off either end and unknown ids', async () => {
        const { svc, persists } = createService();
        expect(await svc.moveGroupInOrder('__all__', -1)).toBe(false);
        expect(await svc.moveGroupInOrder('g3', 1)).toBe(false);
        expect(await svc.moveGroupInOrder('nope', 1)).toBe(false);
        expect(persists()).toBe(0);
    });

    test('steps over a hidden neighbour when given the visible blocks', async () => {
        const { svc } = createService({ groupOrder: ['g1', '__all__', 'g2', 'g3'] });
        // Ungrouped is hidden in the view: moving g2 up must pass g1, not just swap with Ungrouped.
        await svc.moveGroupInOrder('g2', -1, ['g1', 'g2', 'g3']);
        expect(svc.data.groupOrder).toEqual(['g2', 'g1', '__all__', 'g3']);
    });

    test('sort A–Z puts Ungrouped first, then groups by name', async () => {
        const { svc } = createService({ groupOrder: ['g1', 'g3', '__all__', 'g2'] });
        await svc.sortGroupsByName();
        expect(svc.data.groupOrder).toEqual(['__all__', 'g2', 'g3', 'g1']);
    });
});

describe('session order', () => {
    const twoInZeta = {
        sessionGroups: { s2: ['g1'], s3: ['g1'], s4: ['g1'] },
        sessionOrder: ['s4', 's1', 's2', 's3'],
    };

    test('moves a session within its block past outside sessions', async () => {
        const { svc } = createService(twoInZeta);
        // Zeta's block is s4, s2, s3; s1 (ungrouped) sits between them in the full order.
        expect(await svc.moveSessionInOrder('s2', -1, ['s4', 's2', 's3'])).toBe(true);
        expect(svc.data.sessionOrder).toEqual(['s2', 's1', 's4', 's3']);
        expect(await svc.moveSessionInOrder('s2', 1, ['s2', 's4', 's3'])).toBe(true);
        expect(svc.data.sessionOrder).toEqual(['s4', 's1', 's2', 's3']);
    });

    test('refuses moves off either end of the block', async () => {
        const { svc, persists } = createService(twoInZeta);
        expect(await svc.moveSessionInOrder('s4', -1, ['s4', 's2', 's3'])).toBe(false);
        expect(await svc.moveSessionInOrder('s3', 1, ['s4', 's2', 's3'])).toBe(false);
        expect(persists()).toBe(0);
    });

    test('sort A–Z orders every session by name', async () => {
        const { svc } = createService(twoInZeta);
        await svc.sortSessionsByName();
        expect(svc.data.sessionOrder).toEqual(['s3', 's4', 's2', 's1']);
    });

    test('menu lists a block in the saved session order, not A–Z', () => {
        const { svc } = createService(twoInZeta);
        const menu = new Menu() as unknown as { entries: Entry[] };
        addGroupedSessionItems(menu as never, menuPlugin(svc) as never, { onPick: () => {} });
        expect(titles(menu.entries)).toEqual(['Loose', '---', 'Zeta', 'InMid', 'InZeta', 'InAlpha']);
    });
});

describe('workspace menu', () => {
    test('Save and Reload lead the menu with their colour classes', () => {
        const { svc } = createService();
        buildWorkspaceMenu(menuPlugin(svc) as never);
        const entries = lastMenu!.entries;
        expect(entries[0]).toMatchObject({ kind: 'item', title: 'statusBarActionSaveSession', cls: ['wsmgr-menu-save'] });
        expect(entries[1]).toMatchObject({ kind: 'item', title: 'statusBarActionReloadWithoutSaving', cls: ['wsmgr-menu-reload'] });
        expect(entries[2]).toEqual({ kind: 'sep' });
        expect(titles(entries).filter((t) => t === 'statusBarActionSaveSession')).toHaveLength(1);
        expect(titles(entries).filter((t) => t === 'statusBarActionReloadWithoutSaving')).toHaveLength(1);
    });

    test('session blocks follow the saved group order, not A–Z', () => {
        const { svc } = createService({ groupOrder: ['g3', '__all__', 'g1', 'g2'] });
        const menu = new Menu() as unknown as { entries: Entry[] };
        addGroupedSessionItems(menu as never, menuPlugin(svc) as never, { onPick: () => {} });
        expect(titles(menu.entries)).toEqual([
            'Mid', 'InMid', '---',
            'ribbonUngrouped', 'Loose', '---',
            'Zeta', 'InZeta', '---',
            'Alpha', 'InAlpha',
        ]);
    });

    test('Ungrouped has no header when it comes first', () => {
        const { svc } = createService();
        const menu = new Menu() as unknown as { entries: Entry[] };
        addGroupedSessionItems(menu as never, menuPlugin(svc) as never, { onPick: () => {} });
        expect(titles(menu.entries).slice(0, 2)).toEqual(['Loose', '---']);
    });
});

describe('reorders are stamped for Sync merges', () => {
    test('moving a group stamps groupOrderModified', async () => {
        const { svc } = createService();
        expect(svc.data.groupOrderModified).toBeUndefined();
        await svc.moveGroupInOrder('g3', -1);
        expect(typeof svc.data.groupOrderModified).toBe('number');
        expect(svc.data.groupOrderModified).toBeGreaterThan(0);
    });

    test('moving a session stamps sessionOrderModified', async () => {
        const { svc } = createService();
        await svc.moveSessionInOrder('s2', -1, ['s1', 's2', 's3', 's4']);
        expect(svc.data.sessionOrderModified).toBeGreaterThan(0);
    });

    test('a no-op move does not stamp', async () => {
        const { svc } = createService();
        await svc.moveGroupInOrder('__all__', -1);
        expect(svc.data.groupOrderModified).toBeUndefined();
    });
});
