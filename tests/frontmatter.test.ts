import { describe, test, expect, beforeAll, vi } from 'vitest';

// Ported from reference tests/frontmatter.test.js.
const h = vi.hoisted(() => ({ notices: [] as string[] }));
vi.mock('obsidian', () => ({
    Notice: class {
        constructor(message: string) {
            h.notices.push(message);
        }
    },
}));

import * as i18n from '../src/i18n';
import { FrontmatterController } from '../src/frontmatter';

beforeAll(() => {
    i18n.resolveLocale('en');
});

function createController(appOverrides: Record<string, unknown> = {}): FrontmatterController {
    const c = new FrontmatterController();
    c.isSwitchingSession = false;
    c.getStartupSettleRemainingMs = () => 0;
    c.registerEvent = (ref: unknown) => {
        (c as unknown as { registeredEvent: unknown }).registeredEvent = ref;
    };
    c.app = Object.assign(
        {
            workspace: {},
            metadataCache: { getFileCache: () => null },
            fileManager: {},
        },
        appOverrides,
    ) as never;
    return c;
}

describe('frontmatter', () => {
    test('listener uses file-open instead of active leaf changes', () => {
        let eventName = '';
        let eventCallback: ((file: unknown) => void) | null = null;
        let handledFile: unknown = null;
        const file = { path: 'Project.md', basename: 'Project', extension: 'md' };
        const c = createController({
            workspace: {
                on: (name: string, callback: (file: unknown) => void) => {
                    eventName = name;
                    eventCallback = callback;
                    return { name };
                },
            },
        });
        c.handleFrontmatterTriggers = (incomingFile: unknown) => {
            handledFile = incomingFile;
        };

        c.registerFrontmatterListeners();
        eventCallback!(file);

        expect(eventName).toBe('file-open');
        expect((c as unknown as { registeredEvent: { name: string } }).registeredEvent.name).toBe('file-open');
        expect(handledFile).toBe(file);
    });

    test('listener skips files already loaded in the active leaf', () => {
        let eventCallback: ((file: unknown) => void) | null = null;
        let handledCount = 0;
        const file = { path: 'Project.md', basename: 'Project', extension: 'md' };
        const c = createController({
            workspace: {
                activeLeaf: { id: 'leaf-a' },
                iterateAllLeaves: (callback: (leaf: unknown) => void) => callback({ id: 'leaf-a', view: { file } }),
                on: (_name: string, callback: (file: unknown) => void) => {
                    eventCallback = callback;
                    return {};
                },
            },
        });
        c.handleFrontmatterTriggers = () => {
            handledCount += 1;
        };

        c.registerFrontmatterListeners();
        eventCallback!(file);
        eventCallback!(file);
        expect(handledCount).toBe(0);
    });

    test('listener handles a new file loaded into the active leaf once', () => {
        let eventCallback: ((file: unknown) => void) | null = null;
        let handledCount = 0;
        const existingFile = { path: 'Existing.md', basename: 'Existing', extension: 'md' };
        const newFile = { path: 'New.md', basename: 'New', extension: 'md' };
        const c = createController({
            workspace: {
                activeLeaf: { id: 'leaf-a' },
                iterateAllLeaves: (callback: (leaf: unknown) => void) =>
                    callback({ id: 'leaf-a', view: { file: existingFile } }),
                on: (_name: string, callback: (file: unknown) => void) => {
                    eventCallback = callback;
                    return {};
                },
            },
        });
        c.handleFrontmatterTriggers = () => {
            handledCount += 1;
        };

        c.registerFrontmatterListeners();
        eventCallback!(newFile);
        eventCallback!(newFile);
        expect(handledCount).toBe(1);
    });

    test('treats a file as newly loaded after active leaf closes its file', () => {
        let eventCallback: ((file: unknown) => void) | null = null;
        let handledCount = 0;
        const file = { path: 'Project.md', basename: 'Project', extension: 'md' };
        const c = createController({
            workspace: {
                activeLeaf: { id: 'leaf-a' },
                iterateAllLeaves: (callback: (leaf: unknown) => void) => callback({ id: 'leaf-a', view: { file } }),
                on: (_name: string, callback: (file: unknown) => void) => {
                    eventCallback = callback;
                    return {};
                },
            },
        });
        c.handleFrontmatterTriggers = () => {
            handledCount += 1;
        };

        c.registerFrontmatterListeners();
        eventCallback!(file);
        eventCallback!(null);
        eventCallback!(file);
        expect(handledCount).toBe(1);
    });

    test('save current note name as session writes workspace-session frontmatter', async () => {
        const file = { path: 'Folder/Project Note.md', basename: 'Project Note', extension: 'md' };
        let processedFile: unknown = null;
        let processedFrontmatter: Record<string, unknown> | null = null;
        let savedSessionName: string | null = null;
        const c = createController({
            workspace: { getActiveFile: () => file },
            fileManager: {
                processFrontMatter: (incomingFile: unknown, mutate: (fm: Record<string, unknown>) => void) => {
                    const frontmatter: Record<string, unknown> = {};
                    processedFile = incomingFile;
                    mutate(frontmatter);
                    processedFrontmatter = frontmatter;
                    return Promise.resolve();
                },
            },
        });
        c.saveCurrentLayoutAsSessionName = (name: string) => {
            savedSessionName = name;
            return Promise.resolve({ saved: true, created: true, overwritten: false, sessionId: 'x', name });
        };

        const result = (await c.saveCurrentNoteNameAsSession({ silent: true })) as { saved: boolean };
        expect(result.saved).toBe(true);
        expect(processedFile).toBe(file);
        expect(processedFrontmatter).toEqual({ 'workspace-session': 'Project Note' });
        expect(savedSessionName).toBe('Project Note');
    });

    test('save current note name as session requires an active Markdown note', async () => {
        let called = false;
        const c = createController({
            workspace: { getActiveFile: () => ({ path: 'Sketch.canvas', basename: 'Sketch', extension: 'canvas' }) },
        });
        c.saveCurrentLayoutAsSessionName = () => {
            called = true;
            return Promise.resolve({ saved: true, created: false, overwritten: false, sessionId: null, name: '' });
        };

        const result = await c.saveCurrentNoteNameAsSession({ silent: true });
        expect(result).toBe(false);
        expect(called).toBe(false);
    });
});
