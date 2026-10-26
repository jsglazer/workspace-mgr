// Pure helpers for the per-workspace pinned window size. No `obsidian` or
// Electron import: the adapter reads/writes the real window, these decide what
// rectangle to apply so the decision is unit-testable headless.
import type { WindowBounds } from './types';

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 'size' restores width/height only; 'size-location' also restores x/y and maximized/full-screen. */
export type WindowRestoreMode = 'size' | 'size-location';

export function normalizeWindowRestoreMode(value: unknown): WindowRestoreMode {
    return value === 'size-location' ? 'size-location' : 'size';
}

function finiteInt(value: unknown): number | null {
    return typeof value === 'number' && isFinite(value) ? Math.round(value) : null;
}

/** Coerce a stored value into clean bounds, or null if it isn't usable. */
export function normalizeWindowBounds(raw: unknown): WindowBounds | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const x = finiteInt(r.x);
    const y = finiteInt(r.y);
    const width = finiteInt(r.width);
    const height = finiteInt(r.height);
    if (x === null || y === null || width === null || height === null) return null;
    if (width <= 0 || height <= 0) return null;
    const out: WindowBounds = { x, y, width, height };
    if (r.maximized === true) out.maximized = true;
    if (r.fullScreen === true) out.fullScreen = true;
    return out;
}

function overlapArea(a: Rect, b: Rect): number {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}

function centerDistance(a: Rect, b: Rect): number {
    const dx = a.x + a.width / 2 - (b.x + b.width / 2);
    const dy = a.y + a.height / 2 - (b.y + b.height / 2);
    return dx * dx + dy * dy;
}

/**
 * The work area `rect` belongs on: the one it overlaps most, or — when it is
 * entirely off every display (bounds pinned on a monitor that is no longer
 * attached) — the nearest one.
 */
export function pickWorkArea(rect: Rect, workAreas: Rect[]): Rect | null {
    if (workAreas.length === 0) return null;
    let best = workAreas[0];
    let bestOverlap = overlapArea(rect, best);
    for (const area of workAreas.slice(1)) {
        const overlap = overlapArea(rect, area);
        if (overlap > bestOverlap) {
            best = area;
            bestOverlap = overlap;
        }
    }
    if (bestOverlap > 0) return best;
    let nearest = workAreas[0];
    for (const area of workAreas.slice(1)) {
        if (centerDistance(rect, area) < centerDistance(rect, nearest)) nearest = area;
    }
    return nearest;
}

/**
 * Move (and if needed shrink) `rect` so it lies wholly inside one visible work
 * area. A size larger than the work area shrinks to fit; the position then
 * slides just far enough to bring the window fully on screen.
 */
export function fitRectToWorkAreas(rect: Rect, workAreas: Rect[]): Rect {
    const area = pickWorkArea(rect, workAreas);
    if (!area) return { ...rect };
    const width = Math.min(rect.width, area.width);
    const height = Math.min(rect.height, area.height);
    const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - width);
    const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - height);
    return { x, y, width, height };
}

/**
 * The rectangle to apply for `pinned`. In 'size' mode the window keeps its
 * current position and takes only the pinned width/height; in 'size-location'
 * it takes the pinned position too. Either way the result is fitted onto a
 * visible display.
 */
export function resolveTargetRect(
    pinned: WindowBounds,
    current: Rect,
    mode: WindowRestoreMode,
    workAreas: Rect[],
): Rect {
    const wanted: Rect =
        mode === 'size-location'
            ? { x: pinned.x, y: pinned.y, width: pinned.width, height: pinned.height }
            : { x: current.x, y: current.y, width: pinned.width, height: pinned.height };
    return fitRectToWorkAreas(wanted, workAreas);
}
