import { describe, test, expect, beforeAll, vi } from 'vitest';

// Ported from reference tests/session-statusbar.test.js (wpp- -> wsmgr- classes).
vi.mock('obsidian', () => ({
    setIcon: (el: { icon?: string }, iconName: string) => {
        el.icon = iconName;
    },
}));

import * as i18n from '../src/i18n';
import { renderStatusBar } from '../src/session-statusbar';

beforeAll(() => {
    i18n.resolveLocale('en');
});

interface FakeSpan {
    cls?: string;
    text?: string;
    icon?: string;
}
interface FakeStatusBarEl {
    classes: string[];
    children: FakeSpan[];
    addClass(cls: string): void;
    removeClass(cls: string): void;
    empty(): void;
    createSpan(attrs?: FakeSpan): FakeSpan;
}

function createStatusBarEl(): FakeStatusBarEl {
    return {
        classes: [],
        children: [],
        addClass(cls: string) {
            if (this.classes.indexOf(cls) === -1) this.classes.push(cls);
        },
        removeClass(cls: string) {
            this.classes = this.classes.filter((c) => c !== cls);
        },
        empty() {
            this.children = [];
        },
        createSpan(attrs?: FakeSpan) {
            const child: FakeSpan = Object.assign({}, attrs || {});
            this.children.push(child);
            return child;
        },
    };
}

function createHost(options: {
    statusBarEl?: boolean;
    session?: { id: string; name: string } | null;
    group?: { id: string; name: string } | null;
    unsaved?: boolean;
}) {
    const el = options.statusBarEl === false ? null : createStatusBarEl();
    const host = {
        statusBarEl: el as never,
        getActiveSession: () => options.session || null,
        getActiveGroup: () => options.group || null,
        shouldShowUnsavedStatusBarHighlight: () => !!options.unsaved,
    };
    return { host, el };
}

describe('session-statusbar', () => {
    test('renders icon and session name', () => {
        const { host, el } = createHost({ session: { id: 's1', name: 'Session One' } });
        renderStatusBar(host);
        expect(el!.classes).toEqual([]);
        expect(el!.children[0].cls).toBe('wsmgr-status-icon');
        expect(el!.children[0].icon).toBe('panels-top-left');
        expect(el!.children.map((c) => c.text)).toEqual([undefined, 'Session One']);
    });

    test('renders active group before session name', () => {
        const { host, el } = createHost({
            session: { id: 's1', name: 'Session One' },
            group: { id: 'g1', name: 'Group One' },
        });
        renderStatusBar(host);
        expect(el!.children.map((c) => c.cls)).toEqual([
            'wsmgr-status-icon',
            'wsmgr-status-group',
            'wsmgr-status-separator',
            'wsmgr-status-name',
        ]);
        expect(el!.children.map((c) => c.text)).toEqual([undefined, 'Group One', ' / ', 'Session One']);
    });

    test('toggles unsaved highlight class', () => {
        const { host, el } = createHost({ session: { id: 's1', name: 'Session One' }, unsaved: true });
        renderStatusBar(host);
        expect(el!.classes).toEqual(['wsmgr-status-bar-unsaved']);
    });

    test('safely skips rendering before element exists', () => {
        const { host } = createHost({ statusBarEl: false, session: { id: 's1', name: 'Session One' } });
        expect(() => renderStatusBar(host)).not.toThrow();
    });
});
