import { describe, test, expect } from 'vitest';
import * as layoutUtils from '../src/core/layout-utils';

// Ported from reference tests/layout-utils.test.js (node:test -> Vitest).
describe('layout-utils', () => {
    test('compare exact serialized layouts', () => {
        expect(layoutUtils.layoutsEqual({ a: 1 }, { a: 1 })).toBe(true);
        expect(layoutUtils.layoutsEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    test('structural comparison ignores volatile Obsidian workspace state', () => {
        const savedLayout = {
            main: {
                id: 'saved-main',
                type: 'split',
                direction: 'vertical',
                children: [{
                    id: 'saved-tabs',
                    type: 'tabs',
                    currentTab: 0,
                    children: [
                        {
                            id: 'saved-leaf-a',
                            type: 'leaf',
                            state: {
                                type: 'markdown',
                                state: { file: 'a.md', mode: 'source' },
                                eState: { cursor: { from: 1 }, scroll: 10 },
                            },
                        },
                        {
                            id: 'saved-leaf-b',
                            type: 'leaf',
                            state: {
                                type: 'markdown',
                                state: { file: 'b.md', mode: 'source' },
                                eState: { cursor: { from: 2 }, scroll: 20 },
                            },
                        },
                    ],
                }],
            },
            active: 'saved-leaf-a',
            lastOpenFiles: ['a.md', 'b.md'],
        };
        const currentLayout = {
            main: {
                id: 'current-main',
                type: 'split',
                direction: 'vertical',
                children: [{
                    id: 'current-tabs',
                    type: 'tabs',
                    currentTab: 0,
                    children: [
                        {
                            id: 'current-leaf-a',
                            type: 'leaf',
                            state: {
                                type: 'markdown',
                                state: { file: 'a.md', mode: 'source' },
                                eState: { cursor: { from: 100 }, scroll: 1000 },
                            },
                        },
                        {
                            id: 'current-leaf-b',
                            type: 'leaf',
                            state: {
                                type: 'markdown',
                                state: { file: 'b.md', mode: 'source' },
                                eState: { cursor: { from: 200 }, scroll: 2000 },
                            },
                        },
                    ],
                }],
            },
            active: 'current-leaf-b',
            lastOpenFiles: ['b.md', 'a.md'],
        };

        expect(layoutUtils.layoutsEqualStructural(savedLayout, currentLayout)).toBe(true);
    });

    test('structural comparison still detects meaningful layout differences', () => {
        const a = {
            main: {
                id: 'a-main',
                type: 'tabs',
                currentTab: 0,
                children: [
                    { id: 'a-leaf', type: 'leaf', state: { type: 'markdown', state: { file: 'a.md' } } },
                ],
            },
        };
        const b = {
            main: {
                id: 'b-main',
                type: 'tabs',
                currentTab: 0,
                children: [
                    { id: 'b-leaf', type: 'leaf', state: { type: 'markdown', state: { file: 'b.md' } } },
                ],
            },
        };

        expect(layoutUtils.layoutsEqualStructural(a, b)).toBe(false);
    });

    test('cloneLayout returns a deep copy', () => {
        const layout = { main: { children: [{ state: { file: 'a.md' } }] } };
        const clone = layoutUtils.cloneLayout(layout);

        expect(clone).toEqual(layout);
        expect(clone).not.toBe(layout);
        expect(clone.main).not.toBe(layout.main);

        clone.main.children[0].state.file = 'b.md';
        expect(layout.main.children[0].state.file).toBe('a.md');
    });

    test('merge main layout keeps current sidebars', () => {
        const targetLayout = {
            main: { id: 'target-main', type: 'leaf', state: { type: 'markdown', state: { file: 'target.md' } } },
            left: { id: 'target-left', type: 'leaf', state: { type: 'file-explorer' } },
            right: { id: 'target-right', type: 'leaf', state: { type: 'backlink' } },
            active: 'target-main',
        };
        const currentLayout = {
            main: { id: 'current-main', type: 'leaf', state: { type: 'markdown', state: { file: 'current.md' } } },
            left: { id: 'current-left', type: 'leaf', state: { type: 'file-explorer' } },
            right: { id: 'current-right', type: 'leaf', state: { type: 'outline' } },
            active: 'current-main',
        };

        const merged = layoutUtils.mergeMainLayoutIntoCurrent(targetLayout, currentLayout) as Record<string, any>;

        expect(merged.main).toEqual(targetLayout.main);
        expect(merged.left).toEqual(currentLayout.left);
        expect(merged.right).toEqual(currentLayout.right);
        expect(merged.active).toBe('target-main');

        merged.left.id = 'changed';
        expect(currentLayout.left.id).toBe('current-left');
    });

    test('main-only structural comparison ignores sidebar changes', () => {
        const a = {
            main: { id: 'a-main', type: 'leaf', state: { type: 'markdown', state: { file: 'a.md' } } },
            left: { id: 'a-left', type: 'leaf', state: { type: 'file-explorer' } },
            right: { id: 'a-right', type: 'leaf', state: { type: 'backlink' } },
        };
        const b = {
            main: { id: 'b-main', type: 'leaf', state: { type: 'markdown', state: { file: 'a.md' } } },
            left: { id: 'b-left', type: 'leaf', state: { type: 'search' } },
            right: { id: 'b-right', type: 'leaf', state: { type: 'outline' } },
        };

        expect(layoutUtils.layoutsEqualStructural(a, b)).toBe(false);
        expect(layoutUtils.layoutsEqualStructural(a, b, { restoreScope: 'main-only' })).toBe(true);
    });

    test('full structural comparison keeps sidebar branches but ignores numeric positions', () => {
        const savedLayout = {
            main: { id: 'main-a', type: 'leaf', state: { type: 'markdown', state: { file: 'a.md' } } },
            left: { id: 'left-a', type: 'leaf', state: { type: 'file-explorer' } },
        };
        const sameWithPosition = {
            main: { id: 'main-b', type: 'leaf', state: { type: 'markdown', state: { file: 'a.md' } } },
            left: { id: 'left-b', type: 'leaf', state: { type: 'file-explorer' } },
            top: 20,
        };
        const differentSidebar = {
            main: { id: 'main-c', type: 'leaf', state: { type: 'markdown', state: { file: 'a.md' } } },
            left: { id: 'left-c', type: 'leaf', state: { type: 'search' } },
        };
        const sameContentWithNumericLeft = {
            main: { id: 'main-d', type: 'leaf', state: { type: 'markdown', state: { file: 'a.md' } } },
            left: 10,
        };

        expect(layoutUtils.layoutsEqualStructural(savedLayout, sameWithPosition)).toBe(true);
        expect(layoutUtils.layoutsEqualStructural(savedLayout, differentSidebar)).toBe(false);
        expect(layoutUtils.layoutsEqualStructural({ layout: 'saved' }, { layout: 'saved', left: 10, top: 20 })).toBe(true);
        expect(layoutUtils.layoutsEqualStructural({ layout: 'saved', left: 10 }, sameContentWithNumericLeft)).toBe(false);
    });
});
