// Pure mapping between the status-bar colour-picker setting and the CSS custom
// property that drives it. The shell sets this property on the document root
// (:root); styles.css consumes it via `.wsmgr-status-name { color: var(...) }`.
// No dynamic <style> injection is used anywhere. Kept pure so the mapping is
// unit-testable headless.

/** Name of the CSS custom property the status-bar session name reads. */
export const STATUS_NAME_COLOR_VAR = '--wsmgr-status-name-color';

/** Fallback used when no colour is chosen (theme's muted text colour). */
export const STATUS_NAME_COLOR_FALLBACK = 'var(--text-muted)';

/**
 * Resolve the effective value for the custom property. An empty/whitespace
 * colour means "use the theme default", so the fallback is returned.
 */
export function statusNameColorValue(color: string | null | undefined): string {
    const trimmed = typeof color === 'string' ? color.trim() : '';
    return trimmed || STATUS_NAME_COLOR_FALLBACK;
}

/**
 * The full CSS declaration string to set the custom property on the document
 * root, e.g. `--wsmgr-status-name-color: #ff0000;`.
 */
export function statusNameColorDeclaration(color: string | null | undefined): string {
    return `${STATUS_NAME_COLOR_VAR}: ${statusNameColorValue(color)};`;
}
