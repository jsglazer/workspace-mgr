import { describe, test, expect } from 'vitest';
import {
    STATUS_NAME_COLOR_FALLBACK,
    UNSAVED_COLOR_FALLBACK,
    statusNameColorValue,
    unsavedHighlightColorValue,
    menuBarNameColorValue,
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

// The macOS menu bar is native AppKit, not the DOM, so there is no CSS
// variable to fall back to: "unset" must resolve to null, which the adapter
// reads as "draw a plain system-coloured label" rather than an image.
describe('menu-bar colour resolution', () => {
    test('picks the colour matching the active theme', () => {
        expect(menuBarNameColorValue('#ff0000', '#00ff00', false)).toBe('#ff0000');
        expect(menuBarNameColorValue('#ff0000', '#00ff00', true)).toBe('#00ff00');
    });

    test('trims whitespace around the chosen colour', () => {
        expect(menuBarNameColorValue('  #abcdef  ', '', false)).toBe('#abcdef');
    });

    test('returns null when unset, so the native system colour is kept', () => {
        expect(menuBarNameColorValue('', '', false)).toBeNull();
        expect(menuBarNameColorValue('   ', '   ', true)).toBeNull();
        expect(menuBarNameColorValue(null, undefined, false)).toBeNull();
    });

    test('an unset colour for one theme only affects that theme', () => {
        expect(menuBarNameColorValue('', '#00ff00', false)).toBeNull();
        expect(menuBarNameColorValue('', '#00ff00', true)).toBe('#00ff00');
    });
});
