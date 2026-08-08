// Pure mapping between colour-picker settings and the CSS custom properties
// that drive them. The shell sets these properties on the document root
// (:root); styles.css consumes them. No dynamic <style> injection is used
// anywhere. Kept pure so the mapping is unit-testable headless.
//
// Both the status-bar session-name colour and the unsaved-highlight colour
// have separate light/dark-theme values; the shell resolves which one is
// active (via the `isDark` flag) and writes a single effective custom
// property per setting.

/** Name of the CSS custom property the status-bar session name reads. */
export const STATUS_NAME_COLOR_VAR = '--wsmgr-status-name-color';

/** Fallback used when no colour is chosen (theme's muted text colour). */
export const STATUS_NAME_COLOR_FALLBACK = 'var(--text-muted)';

/** Name of the CSS custom property the unsaved-highlight colour reads. */
export const UNSAVED_COLOR_VAR = '--wsmgr-unsaved-color';

/** Fallback used when no colour is chosen (theme's warning colour). */
export const UNSAVED_COLOR_FALLBACK = 'var(--text-warning)';

/**
 * Resolve the effective value for a themed colour custom property. An
 * empty/whitespace colour means "use the theme default", so the fallback is
 * returned.
 */
function resolveThemedColor(
    light: string | null | undefined,
    dark: string | null | undefined,
    isDark: boolean,
    fallback: string,
): string {
    const chosen = isDark ? dark : light;
    const trimmed = typeof chosen === 'string' ? chosen.trim() : '';
    return trimmed || fallback;
}

export function statusNameColorValue(
    light: string | null | undefined,
    dark: string | null | undefined,
    isDark: boolean,
): string {
    return resolveThemedColor(light, dark, isDark, STATUS_NAME_COLOR_FALLBACK);
}

/**
 * Resolve the macOS menu-bar text colour. Unlike the two above this does NOT
 * fall back to a CSS variable: the menu bar is native AppKit, not the DOM, so
 * there is no theme colour to inherit. An empty value means "leave it to
 * macOS", which the adapter renders as a plain system-coloured label — so this
 * returns null rather than a colour string.
 */
export function menuBarNameColorValue(
    light: string | null | undefined,
    dark: string | null | undefined,
    isDark: boolean,
): string | null {
    const chosen = isDark ? dark : light;
    const trimmed = typeof chosen === 'string' ? chosen.trim() : '';
    return trimmed || null;
}

export function unsavedHighlightColorValue(
    light: string | null | undefined,
    dark: string | null | undefined,
    isDark: boolean,
): string {
    return resolveThemedColor(light, dark, isDark, UNSAVED_COLOR_FALLBACK);
}
