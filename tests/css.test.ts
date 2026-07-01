import { describe, test, expect } from 'vitest';
import {
    STATUS_NAME_COLOR_FALLBACK,
    UNSAVED_COLOR_FALLBACK,
    statusNameColorValue,
    unsavedHighlightColorValue,
} from '../src/core/css';

// Deterministic test (§4): a chosen colour-picker value maps to the expected
// CSS custom-property value, per light/dark theme; empty falls back to the
// theme colour.
describe('status-bar colour -> CSS custom property mapping', () => {
    test('picks the light-theme colour when not dark', () => {
        expect(statusNameColorValue('#ff0000', '#00ff00', false)).toBe('#ff0000');
    });

    test('picks the dark-theme colour when dark', () => {
        expect(statusNameColorValue('#ff0000', '#00ff00', true)).toBe('#00ff00');
    });

    test('trims whitespace around the chosen colour', () => {
        expect(statusNameColorValue('  #abcdef  ', '', false)).toBe('#abcdef');
    });

    test('falls back to the theme muted colour when empty', () => {
        expect(statusNameColorValue('', '', false)).toBe(STATUS_NAME_COLOR_FALLBACK);
        expect(statusNameColorValue('   ', '   ', true)).toBe(STATUS_NAME_COLOR_FALLBACK);
        expect(statusNameColorValue(null, null, false)).toBe(STATUS_NAME_COLOR_FALLBACK);
    });
});

describe('unsaved-highlight colour -> CSS custom property mapping', () => {
    test('picks the light-theme colour when not dark', () => {
        expect(unsavedHighlightColorValue('#ff0000', '#00ff00', false)).toBe('#ff0000');
    });

    test('picks the dark-theme colour when dark', () => {
        expect(unsavedHighlightColorValue('#ff0000', '#00ff00', true)).toBe('#00ff00');
    });

    test('falls back to the theme warning colour when empty', () => {
        expect(unsavedHighlightColorValue('', '', false)).toBe(UNSAVED_COLOR_FALLBACK);
        expect(unsavedHighlightColorValue(undefined, undefined, true)).toBe(UNSAVED_COLOR_FALLBACK);
    });
});
