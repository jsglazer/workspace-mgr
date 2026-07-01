import { describe, test, expect, beforeEach, vi } from 'vitest';

// Ported from reference tests/session-context-actions.test.js. Mocks obsidian,
// i18n, the history modal, and the menu/list-action collaborators.
const h = vi.hoisted(() => ({
    notices: [] as string[],
    menuOpens: [] as Record<string, unknown>[],
    actionCalls: [] as unknown[],
}));

vi.mock('obsidian', () => ({
    Notice: class {
        constructor(message: string) {
            h.notices.push(message);
        }
    },
}));
vi.mock('../src/i18n', () => ({
    L: {
        groupRemovedSession: (s: string, g: string) => 'removed ' + s + ' from ' + g,
        groupAddedSession: (s: string, g: string) => 'added ' + s + ' to ' + g,
        confirmDeleteActive: (s: string) => 'delete active ' + s,
        confirmDelete: (s: string) => 'delete ' + s,
    },
}));
vi.mock('../src/modals/history-modal', () => ({
    default: class {
        session: { id: string };
        constructor(_app: unknown, _plugin: unknown, session: { id: string }) {
            this.session = session;
        }
        open(): void {
            h.actionCalls.push(['history', this.session.id]);
        }
    },
}));
vi.mock('../src/modals/customize-clicks-modal', () => ({
    default: class {
        open(): void {
            h.actionCalls.push(['customizeClicks']);
        }
    },
}));
vi.mock('../src/session-context-menu', () => ({
    openSessionContextMenu: (options: Record<string, unknown>) => {
        h.menuOpens.push(options);
    },
}));
vi.mock('../src/session-list-actions', () => ({
    renameSessionWithPrompt: (options: { session: { id: string }; onRenamed?: () => void }) => {
        h.actionCalls.push(['rename', options.session.id]);
        if (options.onRenamed) options.onRenamed();
    },
    deleteSessionWithPrompt: (options: {
        session: { id: string };
        forceConfirm?: boolean;
        confirmMessage?: string;
        notifyDeleted?: boolean;
        onDeleted?: () => void;
    }) => {
        h.actionCalls.push(['delete', options.session.id, options.forceConfirm, options.confirmMessage, options.notifyDeleted]);
        if (options.onDeleted) options.onDeleted();
        return Promise.resolve(true);
    },
}));

import * as actions from '../src/session-context-actions';

function createPlugin(calls: unknown[]) {
    return {
        app: {},
        data: { activeSessionId: 'a', groups: { g1: { id: 'g1', name: 'Group 1' } } },
        isGroupFeatureEnabled: () => true,
        getOrderedGroups: () => [{ id: 'g1', name: 'Group 1' }],
        saveActiveSession: () => {
            calls.push('save');
            return Promise.resolve(true);
        },
        reloadCurrentSessionWithoutSaving: () => {
            calls.push('reload');
            return Promise.resolve(true);
        },
        saveAsSession: () => {
            calls.push('saveAs');
            return Promise.resolve(true);
        },
        confirmOverwriteSessionWithCurrentLayout: (sessionId: string, options: { onSaved?: () => void }) => {
            calls.push(['overwrite', sessionId]);
            if (options && options.onSaved) options.onSaved();
            return true;
        },
        duplicateSession: (sessionId: string) => {
            calls.push(['duplicate', sessionId]);
            return Promise.resolve(true);
        },
        removeSessionFromGroup: (sessionId: string, groupId: string) => {
            calls.push(['removeGroup', sessionId, groupId]);
            return Promise.resolve(true);
        },
        moveSessionToGroupExclusive: (sessionId: string, groupId: string) => {
            calls.push(['moveGroup', sessionId, groupId]);
            return Promise.resolve(true);
        },
        setStatusBarAction: (slotKey: string, actionId: string) => {
            calls.push(['setStatusBarAction', slotKey, actionId]);
            return Promise.resolve(true);
        },
        updateStatusBar: () => calls.push('updateStatusBar'),
    };
}

beforeEach(() => {
    h.notices = [];
    h.menuOpens = [];
    h.actionCalls = [];
});

describe('session-context-actions', () => {
    test('builder wires shared defaults and refresh callbacks', async () => {
        const calls: unknown[] = [];
        const plugin = createPlugin(calls);
        const session = { id: 'b', name: 'Beta' };
        const menuOptions = actions.createSessionContextMenuOptions({
            plugin: plugin as never,
            session,
            getViewGroupId: () => 'g1',
            onGroupsChanged: () => calls.push('groupsChanged'),
            onSessionsChanged: () => calls.push('sessionsChanged'),
        })!;

        expect(menuOptions.showMoveToGroup).toBe(true);
        expect(menuOptions.showRemoveFromGroup).toBe(true);

        await menuOptions.onSave();
        menuOptions.onOverwriteWithCurrentLayout();
        await menuOptions.onDuplicate();
        await menuOptions.onRemoveFromGroup();
        await menuOptions.onMoveToGroup('g1');
        menuOptions.onRename();
        menuOptions.onVersionHistory();
        menuOptions.onCustomizeClicks();

        expect(calls).toEqual([
            'save',
            'sessionsChanged',
            ['overwrite', 'b'],
            'sessionsChanged',
            ['duplicate', 'b'],
            'sessionsChanged',
            ['removeGroup', 'b', 'g1'],
            'groupsChanged',
            'sessionsChanged',
            ['moveGroup', 'b', 'g1'],
            'groupsChanged',
            'sessionsChanged',
            'sessionsChanged',
        ]);
        expect(h.notices).toEqual(['removed Beta from Group 1', 'added Beta to Group 1']);
        expect(h.actionCalls).toEqual([
            ['rename', 'b'],
            ['history', 'b'],
            ['customizeClicks'],
        ]);
    });

    test('preserves delete confirmation options', async () => {
        const calls: unknown[] = [];
        const plugin = createPlugin(calls);
        const session = { id: 'a', name: 'Alpha' };
        const menuOptions = actions.createSessionContextMenuOptions({
            plugin: plugin as never,
            session,
            isActive: true,
            forceDeleteConfirm: true,
            notifyDeleted: false,
            deleteConfirmMessage: 'custom delete',
            onSessionsChanged: () => calls.push('sessionsChanged'),
        })!;

        await menuOptions.onDelete();

        expect(h.actionCalls).toEqual([['delete', 'a', true, 'custom delete', false]]);
        expect(calls).toEqual(['sessionsChanged']);
    });

    test('openSessionContextMenu delegates generated options to the menu renderer', () => {
        const plugin = createPlugin([]);
        const session = { id: 'b', name: 'Beta' };
        actions.openSessionContextMenu({
            plugin: plugin as never,
            session,
            event: { type: 'contextmenu' },
            showSwitch: true,
        });
        expect(h.menuOpens.length).toBe(1);
        expect(h.menuOpens[0].session).toBe(session);
        expect(h.menuOpens[0].showSwitch).toBe(true);
    });
});
