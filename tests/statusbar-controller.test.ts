import { describe, test, expect, beforeEach, vi } from 'vitest';

// Ported from reference tests/statusbar-controller.test.js. Mocks the util and
// action dependencies (mirroring the reference's Module._load interception).
const h = vi.hoisted(() => ({ calls: [] as unknown[], isMac: false }));

vi.mock('../src/core/utils', () => ({
    isMacPlatform: () => h.isMac,
    isModPressed: (e: { ctrlKey?: boolean } | null | undefined) => !!(e && e.ctrlKey),
    isModShiftPressed: () => false,
    generateId: () => 'test-id',
}));
vi.mock('../src/statusbar-actions', () => ({
    executeStatusBarAction: (_plugin: unknown, actionId: string, event: { type?: string }) => {
        h.calls.push(['action', actionId, (event && event.type) || '']);
    },
}));

import * as controller from '../src/statusbar-controller';

interface TestEvent {
    type: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    prevented: number;
    stopped: number;
    button?: number;
    preventDefault(): void;
    stopPropagation(): void;
}

function createEvent(props: Partial<TestEvent> = {}): TestEvent {
    const event: TestEvent = Object.assign(
        {
            type: 'event',
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            deltaX: 0,
            deltaY: 0,
            deltaMode: 0,
            prevented: 0,
            stopped: 0,
            preventDefault(): void {
                event.prevented += 1;
            },
            stopPropagation(): void {
                event.stopped += 1;
            },
        },
        props,
    ) as TestEvent;
    return event;
}

beforeEach(() => {
    h.calls = [];
    h.isMac = false;
});

describe('statusbar-controller', () => {
    test('resolves scroll preset configs', () => {
        expect(controller.getStatusBarScrollConfig({ statusBarScrollPreset: 'notchedWheel' })).toEqual({
            threshold: 16,
            cooldownMs: 350,
            resetMs: 220,
        });
        expect(
            controller.getStatusBarScrollConfig({
                statusBarScrollPreset: 'custom',
                statusBarScrollThreshold: '40',
                statusBarScrollCooldownMs: '750',
                statusBarScrollResetMs: '400',
            }),
        ).toEqual({ threshold: 40, cooldownMs: 750, resetMs: 400 });
        expect(controller.getStatusBarScrollConfig({ statusBarScrollPreset: 'missing' })).toEqual({
            threshold: 30,
            cooldownMs: 500,
            resetMs: 250,
        });
    });

    test('matches scroll modifier modes', () => {
        expect(controller.matchesStatusBarScrollModifier(createEvent(), false, 'none')).toBe(true);
        expect(controller.matchesStatusBarScrollModifier(createEvent({ ctrlKey: true }), false, 'none')).toBe(false);
        expect(controller.matchesStatusBarScrollModifier(createEvent({ ctrlKey: true }), false, 'modOnly')).toBe(true);
        expect(controller.matchesStatusBarScrollModifier(createEvent({ metaKey: true }), true, 'modOnly')).toBe(true);
        expect(controller.matchesStatusBarScrollModifier(createEvent({ altKey: true }), false, 'altOnly')).toBe(true);
        expect(controller.matchesStatusBarScrollModifier(createEvent({ altKey: true }), false, 'modOrAlt')).toBe(true);
        expect(controller.matchesStatusBarScrollModifier(createEvent({ ctrlKey: true }), false, 'modOrAlt')).toBe(true);
    });

    test('resolves modified click slots', () => {
        expect(controller.getClickSlot(createEvent())).toBe('click');
        expect(controller.getClickSlot(createEvent({ shiftKey: true }))).toBe('shiftClick');
        expect(controller.getClickSlot(createEvent({ ctrlKey: true }))).toBe('modClick');
        expect(controller.getClickSlot(createEvent({ altKey: true, ctrlKey: true }))).toBe('altClick');
        expect(controller.getMiddleClickSlot(createEvent({ ctrlKey: true }))).toBe('modMiddleClick');
        expect(controller.getRightClickSlot(createEvent({ altKey: true }))).toBe('altRightClick');
    });

    test('accumulates wheel delta and switches after threshold', () => {
        const calls: number[] = [];
        const plugin = {
            data: {
                statusBarModScrollSwitch: true,
                statusBarScrollPreset: 'custom',
                statusBarScrollThreshold: 30,
                statusBarScrollCooldownMs: 500,
                statusBarScrollResetMs: 250,
                statusBarScrollModifierMode: 'none',
                statusBarScrollInvert: false,
            },
            isSwitchingSession: false,
            statusBarScrollDelta: 0,
            statusBarScrollEventAt: 0,
            statusBarScrollSwitchAt: 0,
            switchRelativeFromScroll: (direction: number) => {
                calls.push(direction);
                return Promise.resolve(true);
            },
        };
        const first = createEvent({ type: 'wheel', deltaY: 10 });
        const second = createEvent({ type: 'wheel', deltaY: 25 });

        expect(controller.handleStatusBarWheel(plugin, first, 1000)).toBe(false);
        expect(plugin.statusBarScrollDelta).toBe(10);
        expect(first.prevented).toBe(1);
        expect(first.stopped).toBe(1);

        expect(controller.handleStatusBarWheel(plugin, second, 1050)).toBe(true);
        expect(plugin.statusBarScrollDelta).toBe(0);
        expect(plugin.statusBarScrollSwitchAt).toBe(1050);
        expect(calls).toEqual([1]);
    });

    test('setup wires basic click handling', () => {
        const listeners: Record<string, (evt: TestEvent) => void> = {};
        const plugin = {
            data: { statusBarActions: { click: 'quickSwitcher' } },
            addStatusBarItem: () => ({
                addClass: (className: string) => {
                    h.calls.push(['class', className]);
                },
                addEventListener: (type: string, handler: (evt: TestEvent) => void) => {
                    listeners[type] = handler;
                },
            }),
            updateStatusBar: () => {
                h.calls.push(['update']);
            },
        };

        controller.setupStatusBar(plugin as never);
        const event = createEvent({ type: 'click' });
        listeners.click(event);

        expect((plugin as { statusBarEl?: unknown }).statusBarEl !== undefined).toBe(true);
        expect(event.prevented).toBe(1);
        expect(event.stopped).toBe(1);
        expect(h.calls).toEqual([
            ['class', 'wsmgr-status-bar'],
            ['update'],
            ['action', 'quickSwitcher', 'click'],
        ]);
    });
});
