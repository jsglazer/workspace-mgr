import { describe, test, expect, beforeAll } from 'vitest';
import * as i18n from '../src/i18n';
import { SessionService } from '../src/core/session-service';
import type { CommandLike } from '../src/core/host';
import type { Session, SessionData } from '../src/core/types';

// Ported from reference tests/session-commands.test.js.
beforeAll(() => {
    i18n.resolveLocale('en');
});

function createSession(id: string, name: string): Session {
    return { id, name };
}

function createService(initialData: Partial<SessionData> = {}) {
    const svc = new SessionService();
    svc.data = Object.assign(
        {
            activeSessionId: 's1',
            numberedSwitchCommands: true,
            showActiveSwitchCommand: false,
            sessionOrder: ['s1', 's2'],
            sessions: { s1: createSession('s1', 'One'), s2: createSession('s2', 'Two') },
        },
        initialData,
    ) as SessionData;
    const state = {
        addedCommands: [] as CommandLike[],
        removedCommandIds: [] as string[],
        switchToIndexCalls: [] as number[],
        switchByIdCalls: [] as string[],
    };
    svc.addCommand = (command: CommandLike) => {
        state.addedCommands.push(command);
    };
    svc.removeCommand = (id: string) => {
        state.removedCommandIds.push(id);
    };
    svc.getOrderedSessions = () =>
        svc.data.sessionOrder.map((id) => svc.data.sessions[id]).filter(Boolean);
    svc.switchToIndex = (index: number) => {
        state.switchToIndexCalls.push(index);
        return Promise.resolve(true);
    };
    svc.switchSessionByIdFromCommand = (sessionId: string) => {
        state.switchByIdCalls.push(sessionId);
        return Promise.resolve(true);
    };
    return { svc, state };
}

describe('session-commands', () => {
    test('sync refreshes numbered commands with current session names', () => {
        const { svc, state } = createService();
        svc._dynamicSessionCommandIds = ['switch-to-named-old'];

        svc.syncSessionCommands();

        expect(state.removedCommandIds.slice(0, 10)).toEqual([
            'switch-to-named-old',
            'switch-to-1',
            'switch-to-2',
            'switch-to-3',
            'switch-to-4',
            'switch-to-5',
            'switch-to-6',
            'switch-to-7',
            'switch-to-8',
            'switch-to-9',
        ]);
        expect(state.addedCommands.length).toBe(9);
        expect(state.addedCommands[0].id).toBe('switch-to-1');
        expect(state.addedCommands[0].name).toMatch(/One/);
        expect(state.addedCommands[0].checkCallback!(true)).toBe(false);
        expect(state.addedCommands[1].checkCallback!(false)).toBe(true);
        expect(state.switchToIndexCalls).toEqual([1]);
    });

    test('sync registers named commands when numbering is disabled', () => {
        const { svc, state } = createService({
            numberedSwitchCommands: false,
            sessionOrder: ['s1', 's2', 's3'],
            sessions: {
                s1: createSession('s1', 'One'),
                s2: createSession('s2', 'Two'),
                s3: createSession('s3', 'Three'),
            },
        });

        svc.syncSessionCommands();

        expect(state.removedCommandIds).toEqual([
            'switch-to-1',
            'switch-to-2',
            'switch-to-3',
            'switch-to-4',
            'switch-to-5',
            'switch-to-6',
            'switch-to-7',
            'switch-to-8',
            'switch-to-9',
        ]);
        expect(svc._dynamicSessionCommandIds).toEqual([
            'switch-to-named-s1',
            'switch-to-named-s2',
            'switch-to-named-s3',
        ]);
        expect(state.addedCommands.map((c) => c.id)).toEqual(svc._dynamicSessionCommandIds);
        expect(state.addedCommands[0].checkCallback!(true)).toBe(false);
        expect(state.addedCommands[1].checkCallback!(false)).toBe(true);
        expect(state.switchByIdCalls).toEqual(['s2']);
    });
});
