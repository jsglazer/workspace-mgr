// Pure layout comparison/merge helpers. No `obsidian` import: these operate on
// plain serialized layout objects, so they are fully unit-testable headless.
// Ported from the reference plugin's src/layout-utils.js.
import type { Layout, RestoreOptions } from './types';

export function serializeLayout(layout: unknown): string {
    try {
        return JSON.stringify(layout ?? null);
    } catch {
        return '';
    }
}

export function layoutsEqual(a: unknown, b: unknown): boolean {
    return serializeLayout(a) === serializeLayout(b);
}

export function cloneLayout<T>(layout: T): T {
    if (layout === undefined) return undefined as T;
    return JSON.parse(JSON.stringify(layout)) as T;
}

function nodeContainsId(node: unknown, id: string): boolean {
    if (!id || !node) return false;
    if (Array.isArray(node)) {
        for (const item of node) {
            if (nodeContainsId(item, id)) return true;
        }
        return false;
    }
    if (typeof node === 'object') {
        const record = node as Record<string, unknown>;
        if (record.id === id) return true;
        for (const key of Object.keys(record)) {
            if (nodeContainsId(record[key], id)) return true;
        }
    }
    return false;
}

/**
 * Replace `current.main` with `target.main` (deep-cloned) while keeping the
 * current sidebars. Used to restore only the main editor area on switch.
 */
export function mergeMainLayoutIntoCurrent(
    targetLayout: Layout | null | undefined,
    currentLayout: Layout | null | undefined,
): Layout | null | undefined {
    const target = cloneLayout(targetLayout);
    if (!target || typeof target !== 'object' || !('main' in target) || !target.main) {
        return target;
    }
    const current: Record<string, unknown> =
        currentLayout && typeof currentLayout === 'object' ? cloneLayout(currentLayout) : {};

    current.main = target.main;
    const active = target.active;
    if (typeof active === 'string' && nodeContainsId(target.main, active)) {
        current.active = active;
    }
    return current as Layout;
}

function looksLikeWorkspaceItem(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.id === 'string' &&
        typeof v.type === 'string' &&
        (Array.isArray(v.children) ||
            v.state !== undefined ||
            v.currentTab !== undefined ||
            v.direction !== undefined ||
            v.collapsed !== undefined)
    );
}

/**
 * Strip volatile Obsidian workspace state (auto-generated ids, cursor/scroll
 * eState, focus, recently-opened files, numeric sidebar sizes) so two layouts
 * can be compared for meaningful structural equality.
 */
export function normalizeLayoutForComparison(
    layout: unknown,
    options: RestoreOptions = {},
): unknown {
    let root = layout;
    if (
        options.restoreScope === 'main-only' &&
        root &&
        typeof root === 'object' &&
        (root as Record<string, unknown>).main
    ) {
        root = (root as Record<string, unknown>).main;
    }

    const volatileKeys: Record<string, true> = {
        eState: true,
        lastOpenFiles: true,
        scroll: true,
        top: true,
    };

    function normalizeNode(value: unknown, depth: number): unknown {
        if (Array.isArray(value)) {
            return value.map((item) => normalizeNode(item, depth + 1));
        }
        if (value && typeof value === 'object') {
            const source = value as Record<string, unknown>;
            const normalized: Record<string, unknown> = {};
            const isWorkspaceItem = looksLikeWorkspaceItem(value);
            const keys = Object.keys(source).sort();
            for (const key of keys) {
                if (volatileKeys[key]) continue;
                if (key === 'left' && (source[key] === null || typeof source[key] !== 'object')) continue;
                if (key === 'id' && isWorkspaceItem) continue;
                if (key === 'active' && depth === 0 && typeof source[key] === 'string') continue;
                normalized[key] = normalizeNode(source[key], depth + 1);
            }
            return normalized;
        }
        return value;
    }

    return normalizeNode(root ?? null, 0);
}

export function layoutsEqualStructural(
    a: unknown,
    b: unknown,
    options: RestoreOptions = {},
): boolean {
    try {
        return (
            JSON.stringify(normalizeLayoutForComparison(a, options)) ===
            JSON.stringify(normalizeLayoutForComparison(b, options))
        );
    } catch {
        return layoutsEqual(a, b);
    }
}
