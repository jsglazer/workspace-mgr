import { describe, test, expect } from 'vitest';
import {
    STATUS_NAME_COLOR_VAR,
    STATUS_NAME_COLOR_FALLBACK,
    statusNameColorValue,
    statusNameColorDeclaration,
} from '../src/core/css';

// Deterministic test (§4): a chosen colour-picker value maps to the expected CSS
// custom-property declaration string; empty falls back to the theme colour.
describe('status-bar colour -> CSS custom property mapping', () => {
    test('maps a chosen colour to the custom-property declaration', () => {
        expect(statusNameColorDeclaration('#ff0000')).toBe('--wsmgr-status-name-color: #ff0000;');
        expect(statusNameColorDeclaration('rgb(1, 2, 3)')).toBe('--wsmgr-status-name-color: rgb(1, 2, 3);');
    });

    test('trims whitespace around the chosen colour', () => {
        expect(statusNameColorDeclaration('  #abcdef  ')).toBe('--wsmgr-status-name-color: #abcdef;');
        expect(statusNameColorValue('  #abcdef  ')).toBe('#abcdef');
    });

    test('falls back to the theme muted colour when empty', () => {
        expect(statusNameColorValue('')).toBe(STATUS_NAME_COLOR_FALLBACK);
        expect(statusNameColorValue('   ')).toBe(STATUS_NAME_COLOR_FALLBACK);
        expect(statusNameColorValue(null)).toBe(STATUS_NAME_COLOR_FALLBACK);
        expect(statusNameColorDeclaration('')).toBe(`${STATUS_NAME_COLOR_VAR}: ${STATUS_NAME_COLOR_FALLBACK};`);
    });

    test('uses the wsmgr- prefixed variable name (no legacy wpp-)', () => {
        expect(STATUS_NAME_COLOR_VAR).toBe('--wsmgr-status-name-color');
        expect(STATUS_NAME_COLOR_VAR).not.toContain('wpp-');
    });
});
