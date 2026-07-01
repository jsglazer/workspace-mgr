import { describe, test, expect, vi } from 'vitest';

// Ported from reference tests/statusbar-actions.test.js. Mocks obsidian and the
// modal/menu dependencies (mirroring the reference's Module._load interception).
vi.mock('obsidian', () => ({ Notice: class {} }));
vi.mock('../src/i18n', () => ({ L: {} }));
vi.mock('../src/modals', () => ({
    SessionManagerModal: class {
        open(): void {}
    },
    HistoryModal: class {
        open(): void {}
    },
    ConfirmModal: class {
        open(): void {}
    },
    RenameModal: class {
        open(): void {}
    },
}));
vi.mock('../src/session-context-actions', () => ({ openSessionContextMenu: () => {} }));
vi.mock('../src/settings-context-menu', () => ({ openSettingsContextMenu: () => {} }));

import * as statusBarActions from '../src/statusbar-actions';

describe('statusbar-actions', () => {
    test('exposes first-pass direct action ids', () => {
        const expected = [
            'saveAsSession',
            'saveCurrentNoteNameAsSession',
            'renameSession',
            'duplicateSession',
            'previousSession',
            'nextSession',
            'newEmptySession',
            'toggleAutoSaveOnSwitch',
        ];
        for (const id of expected) expect(statusBarActions.ACTION_IDS).toContain(id);
    });

    test('delegate new direct actions to plugin methods', async () => {
        const calls: unknown[] = [];
        const plugin = {
            saveAsSession: () => {
                calls.push('saveAsSession');
                return Promise.resolve(true);
            },
            saveCurrentNoteNameAsSession: () => {
                calls.push('saveCurrentNoteNameAsSession');
                return Promise.resolve(true);
            },
            renameCurrentSession: () => {
                calls.push('renameCurrentSession');
            },
            duplicateCurrentSession: () => {
                calls.push('duplicateCurrentSession');
                return Promise.resolve(true);
            },
            switchRelativeFromStatusBar: (offset: number) => {
                calls.push(['switchRelativeFromStatusBar', offset]);
                return Promise.resolve(true);
            },
            createEmptySession: () => {
                calls.push('createEmptySession');
                return Promise.resolve(true);
            },
            toggleAutoSaveOnSwitch: (options: unknown) => {
                calls.push(['toggleAutoSaveOnSwitch', options]);
                return Promise.resolve(true);
            },
        };

        await statusBarActions.executeStatusBarAction(plugin as never, 'saveAsSession');
        await statusBarActions.executeStatusBarAction(plugin as never, 'saveCurrentNoteNameAsSession');
        await statusBarActions.executeStatusBarAction(plugin as never, 'renameSession');
        await statusBarActions.executeStatusBarAction(plugin as never, 'duplicateSession');
        await statusBarActions.executeStatusBarAction(plugin as never, 'previousSession');
        await statusBarActions.executeStatusBarAction(plugin as never, 'nextSession');
        await statusBarActions.executeStatusBarAction(plugin as never, 'newEmptySession');
        await statusBarActions.executeStatusBarAction(plugin as never, 'toggleAutoSaveOnSwitch');

        expect(calls).toEqual([
            'saveAsSession',
            'saveCurrentNoteNameAsSession',
            'renameCurrentSession',
            'duplicateCurrentSession',
            ['switchRelativeFromStatusBar', -1],
            ['switchRelativeFromStatusBar', 1],
            'createEmptySession',
            ['toggleAutoSaveOnSwitch', { notify: true }],
        ]);
    });

    test('labels reuse existing localized command labels', () => {
        const L = {
            statusBarActionNone: 'Do nothing',
            cmdSaveAs: 'Save current session as...',
            cmdSaveCurrentNoteNameAsSession: 'Save current note name as session',
            cmdRename: 'Rename current session',
            cmdDuplicate: 'Duplicate current session',
            cmdPrevious: 'Previous session',
            cmdNext: 'Next session',
            cmdNewEmpty: 'Create blank session',
            cmdToggleAutoSave: 'Toggle auto-save on switch',
        };
        expect(statusBarActions.getActionLabel(L, 'saveAsSession')).toBe('Save current session as...');
        expect(statusBarActions.getActionLabel(L, 'saveCurrentNoteNameAsSession')).toBe(
            'Save current note name as session',
        );
        expect(statusBarActions.getActionLabel(L, 'renameSession')).toBe('Rename current session');
        expect(statusBarActions.getActionLabel(L, 'duplicateSession')).toBe('Duplicate current session');
        expect(statusBarActions.getActionLabel(L, 'previousSession')).toBe('Previous session');
        expect(statusBarActions.getActionLabel(L, 'nextSession')).toBe('Next session');
        expect(statusBarActions.getActionLabel(L, 'newEmptySession')).toBe('Create blank session');
        expect(statusBarActions.getActionLabel(L, 'toggleAutoSaveOnSwitch')).toBe('Toggle auto-save on switch');
    });
});
