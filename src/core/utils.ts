// Pure utilities ported from the reference plugin's src/utils.js. No `obsidian`
// import: platform detection uses `navigator` defensively so these run headless.

export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

export function isMacPlatform(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        typeof navigator.platform === 'string' &&
        navigator.platform.indexOf('Mac') !== -1
    );
}

export interface ModifierEvent {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}

export function isModPressed(e: ModifierEvent | null | undefined): boolean {
    if (!e) return false;
    return isMacPlatform() ? !!e.metaKey : !!e.ctrlKey;
}

export function isModShiftPressed(e: ModifierEvent | null | undefined): boolean {
    return isModPressed(e) && !!(e && e.shiftKey);
}
