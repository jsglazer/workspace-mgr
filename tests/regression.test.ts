import { describe, test, expect } from 'vitest';
import { SessionService } from '../src/core/session-service';
import type { AppLike } from '../src/core/host';
import type { Layout, Session, SessionData } from '../src/core/types';

// Ported from reference tests/regression.test.js. Exercises the composed session
// core end-to-end (switching, saving, deleting, relative switching, startup).
function createService(initialData: Partial<SessionData> = {}) {
    const svc = new SessionService();
    svc.data = Object.assign(
        {
            activeSessionId: null,
            sessions: {},
            sessionOrder: [],
            sessionGroups: {},
            groups: {},
            groupOrder: [],
            activeGroupId: null,
            autoSaveOnSwitch: true,
            warnOnUnsavedSwitch: true,
        },
        initialData,
    ) as SessionData;

    const state = {
        persistCalls: 0,
        changeLayoutCalls: [] as unknown[],
        historyPushes: 0,
        historyPushTargets: [] as (string | null)[],
    };

    svc.app = {
        workspace: {
            changeLayout: (layout: unknown) => {
                state.changeLayoutCalls.push(layout);
                return Promise.resolve();
            },
        },
    } as unknown as AppLike;
    svc.persistData = () => {
        state.persistCalls += 1;
        return Promise.resolve();
    };
    svc.updateStatusBar = () => {};
    svc.syncSessionCommands = () => {};
    svc.pushLayoutToHistory = (session: Session | null) => {
        state.historyPushes += 1;
        state.historyPushTargets.push(session ? session.id : null);
    };
    svc.showSwitchPreviewOverlay = () => {};
    svc.showSwitchFeedbackOverlay = () => {};
    return { svc, state };
}

describe('regression', () => {
    test('session switch auto-saves current layout and applies target layout', async () => {
        const currentLayout = { layout: 'current' } as Layout;
        const { svc, state } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'old-a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'target-b' }, modified: 1 },
            },
            autoSaveOnSwitch: true,
        });
        svc.getCurrentWorkspaceLayout = () => currentLayout;

        const switched = await svc.performSessionSwitch('b', { silent: true });
        expect(switched).toBe(true);
        expect(svc.data.activeSessionId).toBe('b');
        expect(svc.data.sessions.a.layout).toEqual(currentLayout);
        expect(state.historyPushes).toBe(1);
        expect(state.persistCalls).toBe(1);
        expect(state.changeLayoutCalls.length).toBe(1);
        expect(state.changeLayoutCalls[0]).toEqual({ layout: 'target-b' });
    });

    test('session switch can keep current sidebars while restoring target main area', async () => {
        const currentLayout = {
            main: { id: 'current-main', type: 'leaf', state: { type: 'markdown', state: { file: 'current.md' } } },
            left: { id: 'current-left', type: 'leaf', state: { type: 'file-explorer' } },
            right: { id: 'current-right', type: 'leaf', state: { type: 'outline' } },
            active: 'current-main',
        } as Layout;
        const targetLayout = {
            main: { id: 'target-main', type: 'leaf', state: { type: 'markdown', state: { file: 'target.md' } } },
            left: { id: 'target-left', type: 'leaf', state: { type: 'search' } },
            right: { id: 'target-right', type: 'leaf', state: { type: 'backlink' } },
            active: 'target-main',
        } as Layout;
        const { svc, state } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'old-a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: targetLayout, modified: 1 },
            },
            autoSaveOnSwitch: true,
            restoreSidebars: false,
        });
        svc.getCurrentWorkspaceLayout = () => currentLayout;

        const switched = await svc.performSessionSwitch('b', { silent: true });
        expect(switched).toBe(true);
        expect(state.changeLayoutCalls.length).toBe(1);
        const call = state.changeLayoutCalls[0] as Record<string, unknown>;
        expect(call.main).toEqual(targetLayout.main);
        expect(call.left).toEqual(currentLayout.left);
        expect(call.right).toEqual(currentLayout.right);
        expect(call.active).toBe('target-main');
    });

    test('overwriteSessionWithCurrentLayout saves current layout to selected session without switching', async () => {
        const currentLayout = { layout: 'current' } as Layout;
        const { svc, state } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'active-a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'old-b' }, modified: 1 },
            },
            autoSaveOnSwitch: false,
        });
        svc.getCurrentWorkspaceLayout = () => currentLayout;

        const saved = await svc.overwriteSessionWithCurrentLayout('b', { silent: true });
        expect(saved).toBe(true);
        expect(svc.data.activeSessionId).toBe('a');
        expect(svc.data.sessions.a.layout).toEqual({ layout: 'active-a' });
        expect(svc.data.sessions.b.layout).toEqual(currentLayout);
        expect(svc.data.sessions.b.modified).not.toBe(1);
        expect(state.historyPushTargets).toEqual(['b']);
        expect(state.persistCalls).toBe(1);
        expect(state.changeLayoutCalls.length).toBe(0);
    });

    test('unsaved status bar highlight is shown only in manual save mode with layout changes', () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a'],
            sessions: { a: { id: 'a', name: 'A', layout: { layout: 'saved' }, modified: 1 } },
            autoSaveOnSwitch: false,
        });
        svc.getCurrentWorkspaceLayout = () => ({ layout: 'changed' } as Layout);
        expect(svc.shouldShowUnsavedStatusBarHighlight()).toBe(true);

        svc.data.highlightUnsavedSessionChanges = false;
        expect(svc.shouldShowUnsavedStatusBarHighlight()).toBe(false);

        svc.data.highlightUnsavedSessionChanges = true;
        svc.data.autoSaveOnSwitch = true;
        expect(svc.shouldShowUnsavedStatusBarHighlight()).toBe(false);

        svc.data.autoSaveOnSwitch = false;
        svc.getCurrentWorkspaceLayout = () => ({ layout: 'saved' } as Layout);
        expect(svc.shouldShowUnsavedStatusBarHighlight()).toBe(false);

        svc.getCurrentWorkspaceLayout = () => ({ layout: 'saved', scroll: 25, left: 10, top: 20 } as Layout);
        expect(svc.shouldShowUnsavedStatusBarHighlight()).toBe(false);
    });

    test('structural layout comparison ignores Obsidian volatile workspace ids and focus state', () => {
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
                        { id: 'saved-leaf-a', type: 'leaf', state: { type: 'markdown', state: { file: 'a.md', mode: 'source', source: false }, eState: { cursor: { from: 3 }, scroll: 12 } } },
                        { id: 'saved-leaf-b', type: 'leaf', state: { type: 'markdown', state: { file: 'b.md', mode: 'source', source: false }, eState: { cursor: { from: 8 }, scroll: 40 } } },
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
                        { id: 'current-leaf-a', type: 'leaf', state: { type: 'markdown', state: { file: 'a.md', mode: 'source', source: false }, eState: { cursor: { from: 30 }, scroll: 120 } } },
                        { id: 'current-leaf-b', type: 'leaf', state: { type: 'markdown', state: { file: 'b.md', mode: 'source', source: false }, eState: { cursor: { from: 80 }, scroll: 400 } } },
                    ],
                }],
            },
            active: 'current-leaf-a',
            lastOpenFiles: ['b.md', 'a.md'],
        };
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a'],
            sessions: { a: { id: 'a', name: 'A', layout: savedLayout as Layout, modified: 1 } },
            autoSaveOnSwitch: false,
        });
        svc.getCurrentWorkspaceLayout = () => currentLayout as Layout;
        expect(svc.shouldShowUnsavedStatusBarHighlight()).toBe(false);

        (currentLayout.main.children[0] as Record<string, unknown>).currentTab = 1;
        expect(svc.shouldShowUnsavedStatusBarHighlight()).toBe(true);
    });

    test('deleting active session applies fallback active layout', async () => {
        const { svc, state } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
            },
            sessionGroups: {},
        });
        const deleted = await svc.deleteSession('a');
        expect(deleted).toBe(true);
        expect(svc.data.activeSessionId).toBe('b');
        expect(svc.data.sessions.a).toBeUndefined();
        expect(state.persistCalls).toBe(1);
        expect(state.changeLayoutCalls.length).toBe(1);
        expect(state.changeLayoutCalls[0]).toEqual({ layout: 'b' });
    });

    test('deleting non-active session does not change current layout', async () => {
        const { svc, state } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
            },
            sessionGroups: {},
        });
        const deleted = await svc.deleteSession('b');
        expect(deleted).toBe(true);
        expect(svc.data.activeSessionId).toBe('a');
        expect(svc.data.sessions.b).toBeUndefined();
        expect(state.persistCalls).toBe(1);
        expect(state.changeLayoutCalls.length).toBe(0);
    });

    test('viewed-group session creation uses exclusive group assignment', async () => {
        const { svc } = createService({
            activeGroupId: 'g1',
            groups: { g1: { id: 'g1', name: 'Group 1' }, g2: { id: 'g2', name: 'Group 2' } },
        });
        let movedArgs: [string, string] | null = null;
        let addCalled = false;
        svc.createSessionValidated = () =>
            Promise.resolve({ created: true, reason: '', name: 'New', sessionId: 'new-session' });
        svc.moveSessionToGroupExclusive = (sessionId: string, groupId: string) => {
            movedArgs = [sessionId, groupId];
            return Promise.resolve(true);
        };
        svc.addSessionToGroup = () => {
            addCalled = true;
            return Promise.resolve(true);
        };
        svc.resolveGroupSelection = () =>
            Promise.resolve({ switched: true, targetGroupId: 'g2', resolvedGroupId: 'g2', sessions: [] });

        const result = await svc.createSessionForViewedGroup('New', 'g2');
        expect(movedArgs).toEqual(['new-session', 'g2']);
        expect(addCalled).toBe(false);
        expect(result.viewGroupId).toBe('g2');
    });

    test('switchSession waits for startup settle window before switching', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
            },
        });
        let switchedAt = 0;
        const startedAt = Date.now();
        svc.performSessionSwitch = () => {
            switchedAt = Date.now();
            return Promise.resolve(true);
        };
        svc.startStartupSettleWindow(20);
        const switched = await svc.switchSession('b', { silent: true });
        expect(switched).toBe(true);
        expect(switchedAt >= startedAt + 15).toBe(true);
    });

    test('scheduleStartupFlush waits until startup settle completes', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a'],
            sessions: { a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 } },
            autoSaveOnSwitch: true,
        });
        const calls: number[] = [];
        svc.flushOnStartup = () => {
            calls.push(Date.now());
            return Promise.resolve(true);
        };
        const startedAt = Date.now();
        svc.startStartupSettleWindow(20);
        await svc.scheduleStartupFlush();
        expect(calls.length).toBe(1);
        expect(calls[0] >= startedAt + 15).toBe(true);
    });

    test('switchRelative shows preview overlay before switching when preview is enabled', () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b', 'c'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
                c: { id: 'c', name: 'C', layout: { layout: 'c' }, modified: 1 },
            },
            previewNext: true,
            previewPrevious: true,
        });
        const previewCalls: [string[], number][] = [];
        let switchCalled = false;
        svc.showSwitchPreviewOverlay = (ordered: Session[], index: number) => {
            previewCalls.push([ordered.map((s) => s.id), index]);
        };
        svc.switchSession = () => {
            switchCalled = true;
            return Promise.resolve(true);
        };
        svc.switchRelative(1);
        expect(previewCalls).toEqual([[['a', 'b', 'c'], 0]]);
        expect(switchCalled).toBe(false);
    });

    test('switchRelativeImmediate bypasses preview-only first step and uses feedback overlay', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b', 'c'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
                c: { id: 'c', name: 'C', layout: { layout: 'c' }, modified: 1 },
            },
            previewNext: true,
            previewPrevious: true,
        });
        const overlayCalls: [string[], number][] = [];
        const switchCalls: [string, Record<string, unknown>][] = [];
        svc.showSwitchFeedbackOverlay = (ordered: Session[], index: number) => {
            overlayCalls.push([ordered.map((s) => s.id), index]);
        };
        svc.switchSession = (sessionId: string, options?: Record<string, unknown>) => {
            switchCalls.push([sessionId, options ?? {}]);
            return Promise.resolve(true);
        };
        const switched = await svc.switchRelativeImmediate(1);
        expect(switched).toBe(true);
        expect(overlayCalls).toEqual([[['a', 'b', 'c'], 1]]);
        expect(switchCalls.length).toBe(1);
        expect(switchCalls[0][0]).toBe('b');
        expect(switchCalls[0][1].silent).toBe(true);
        expect(switchCalls[0][1].switchNoticeMode).toBeUndefined();
    });

    test('switchRelativeImmediate can suppress feedback overlay', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
            },
            previewNext: true,
            previewPrevious: true,
        });
        let overlayCalled = false;
        const switchCalls: [string, Record<string, unknown>][] = [];
        svc.showSwitchFeedbackOverlay = () => {
            overlayCalled = true;
        };
        svc.switchSession = (sessionId: string, options?: Record<string, unknown>) => {
            switchCalls.push([sessionId, options ?? {}]);
            return Promise.resolve(true);
        };
        const switched = await svc.switchRelativeImmediate(1, { showOverlay: false });
        expect(switched).toBe(true);
        expect(overlayCalled).toBe(false);
        expect(switchCalls.length).toBe(1);
        expect(switchCalls[0][0]).toBe('b');
        expect(switchCalls[0][1].silent).toBe(true);
        expect(switchCalls[0][1].switchNoticeMode).toBeUndefined();
    });

    test('switchRelativeFromStatusBar bypasses preview-only first step and uses a replaceable notice', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b', 'c'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
                c: { id: 'c', name: 'C', layout: { layout: 'c' }, modified: 1 },
            },
            previewNext: true,
            previewPrevious: true,
        });
        let previewCalled = false;
        let feedbackCalled = false;
        const switchCalls: [string, Record<string, unknown>][] = [];
        svc.showSwitchPreviewOverlay = () => {
            previewCalled = true;
        };
        svc.showSwitchFeedbackOverlay = () => {
            feedbackCalled = true;
        };
        svc.switchSession = (sessionId: string, options?: Record<string, unknown>) => {
            switchCalls.push([sessionId, options ?? {}]);
            return Promise.resolve(true);
        };
        const switched = await svc.switchRelativeFromStatusBar(1);
        expect(switched).toBe(true);
        expect(previewCalled).toBe(false);
        expect(feedbackCalled).toBe(false);
        expect(switchCalls.length).toBe(1);
        expect(switchCalls[0][0]).toBe('b');
        expect(switchCalls[0][1].silent).toBe(true);
        expect(switchCalls[0][1].switchNoticeMode).toBe('replace');
    });

    test('switchRelativeFromScroll switches without showing overlay', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
            },
            previewNext: true,
            previewPrevious: true,
        });
        let previewCalled = false;
        let feedbackCalled = false;
        const switchCalls: [string, Record<string, unknown>][] = [];
        svc.showSwitchPreviewOverlay = () => {
            previewCalled = true;
        };
        svc.showSwitchFeedbackOverlay = () => {
            feedbackCalled = true;
        };
        svc.switchSession = (sessionId: string, options?: Record<string, unknown>) => {
            switchCalls.push([sessionId, options ?? {}]);
            return Promise.resolve(true);
        };
        const switched = await svc.switchRelativeFromScroll(1);
        expect(switched).toBe(true);
        expect(previewCalled).toBe(false);
        expect(feedbackCalled).toBe(false);
        expect(switchCalls.length).toBe(1);
        expect(switchCalls[0][0]).toBe('b');
        expect(switchCalls[0][1].silent).toBe(true);
        expect(switchCalls[0][1].switchNoticeMode).toBe('replace');
    });

    test('switchSessionByIdFromCommand uses overlay feedback without switch notice', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
            },
        });
        const overlayCalls: [string[], number][] = [];
        const switchCalls: [string, Record<string, unknown>][] = [];
        svc.showSwitchFeedbackOverlay = (ordered: Session[], index: number) => {
            overlayCalls.push([ordered.map((s) => s.id), index]);
        };
        svc.switchSession = (sessionId: string, options?: Record<string, unknown>) => {
            switchCalls.push([sessionId, options ?? {}]);
            return Promise.resolve(true);
        };
        const switched = await svc.switchSessionByIdFromCommand('b');
        expect(switched).toBe(true);
        expect(overlayCalls).toEqual([[['a', 'b'], 1]]);
        expect(switchCalls.length).toBe(1);
        expect(switchCalls[0][0]).toBe('b');
        expect(switchCalls[0][1].silent).toBe(true);
        expect(switchCalls[0][1].switchNoticeMode).toBeUndefined();
    });

    test('performSessionSwitch can emit a replaceable session switch notice', async () => {
        const { svc } = createService({
            activeSessionId: 'a',
            sessionOrder: ['a', 'b'],
            sessions: {
                a: { id: 'a', name: 'A', layout: { layout: 'a' }, modified: 1 },
                b: { id: 'b', name: 'B', layout: { layout: 'b' }, modified: 1 },
            },
        });
        const noticeCalls: [string, Record<string, unknown>][] = [];
        svc.showSessionSwitchNotice = (sessionName: string, options?: { durationMs?: number }) => {
            noticeCalls.push([sessionName, options ?? {}]);
        };
        svc.getCurrentWorkspaceLayout = () => ({ layout: 'current' } as Layout);
        const switched = await svc.performSessionSwitch('b', {
            silent: true,
            switchNoticeMode: 'replace',
            switchNoticeDurationMs: 900,
        });
        expect(switched).toBe(true);
        expect(noticeCalls).toEqual([['B', { durationMs: 900 }]]);
    });
});
