// Pure helpers for the ribbon lock: one pinned left-ribbon configuration that
// every layout load is brought back to. No `obsidian` import.
//
// Obsidian stores the left ribbon in each layout as `left-ribbon.hiddenItems`,
// a map of ribbon-item id -> hidden. The map's KEY ORDER is the icon order:
// the ribbon's load() sorts its items by Object.keys(hiddenItems).indexOf(id)
// (verified in Obsidian 1.14.5's app.js and against a live vault). An item
// missing from the map gets index -1, so it sorts to the FRONT and is shown —
// which is why the lock always writes every live item explicitly.

export type RibbonHiddenItems = Record<string, boolean>;

export interface RibbonLock {
    /** False once unlocked; the pin is kept so a later lock can reuse it. */
    enabled: boolean;
    /** The pinned ribbon: ordered id -> hidden. */
    hiddenItems: RibbonHiddenItems;
    /** When the lock last changed; the later stamp wins a Sync merge. */
    modified: number;
}

/** Copy a hiddenItems map, keeping its key order and coercing values to booleans. */
export function cloneHiddenItems(raw: unknown): RibbonHiddenItems {
    const out: RibbonHiddenItems = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const id of Object.keys(raw as Record<string, unknown>)) {
        out[id] = (raw as Record<string, unknown>)[id] === true;
    }
    return out;
}

export function normalizeRibbonLock(raw: unknown): RibbonLock | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const hiddenItems = cloneHiddenItems(r.hiddenItems);
    if (Object.keys(hiddenItems).length === 0) return null;
    const modified = typeof r.modified === 'number' && isFinite(r.modified) ? r.modified : 0;
    return { enabled: r.enabled === true, hiddenItems, modified };
}

/** The later lock wins; on a tie the first argument (the local copy) is kept. */
export function mergeRibbonLock(local: unknown, external: unknown): RibbonLock | null {
    const a = normalizeRibbonLock(local);
    const b = normalizeRibbonLock(external);
    if (!a) return b;
    if (!b) return a;
    return b.modified > a.modified ? b : a;
}

export interface LockedRibbon {
    /** The full map to load: pinned entries first, in pin order, then the unknown ones. */
    hiddenItems: RibbonHiddenItems;
    /** Live items the pin doesn't mention, in their current order. */
    unknownIds: string[];
}

/**
 * The ribbon the lock wants, given the items that exist right now. Pinned
 * entries keep their pinned order and visibility — including entries whose
 * plugin is missing or disabled, which Obsidian simply skips. Live items absent
 * from the pin (a new plugin, a renamed command) are appended at the end,
 * hidden or shown per `unknownHidden`.
 */
export function buildLockedRibbon(pin: RibbonHiddenItems, liveIds: string[], unknownHidden: boolean): LockedRibbon {
    const hiddenItems: RibbonHiddenItems = {};
    for (const id of Object.keys(pin)) hiddenItems[id] = pin[id] === true;
    const unknownIds: string[] = [];
    for (const id of liveIds) {
        if (Object.prototype.hasOwnProperty.call(hiddenItems, id)) continue;
        hiddenItems[id] = unknownHidden;
        unknownIds.push(id);
    }
    return { hiddenItems, unknownIds };
}

/**
 * True when the live ribbon already shows `expected`: the same items in the
 * same order with the same visibility. Expected entries with no live item are
 * ignored (their plugin is missing), so they can never cause a re-apply loop.
 */
export function ribbonMatches(live: RibbonHiddenItems, expected: RibbonHiddenItems): boolean {
    const liveIds = Object.keys(live);
    const expectedIds = Object.keys(expected).filter((id) => Object.prototype.hasOwnProperty.call(live, id));
    if (liveIds.length !== expectedIds.length) return false;
    for (let i = 0; i < liveIds.length; i++) {
        if (liveIds[i] !== expectedIds[i]) return false;
        if ((live[liveIds[i]] === true) !== (expected[expectedIds[i]] === true)) return false;
    }
    return true;
}

/** A copy of `layout` whose left ribbon is `hiddenItems`. Other keys are untouched. */
export function stampRibbonIntoLayout<T extends Record<string, unknown>>(layout: T, hiddenItems: RibbonHiddenItems): T {
    const next = { ...layout } as Record<string, unknown>;
    next['left-ribbon'] = { hiddenItems: { ...hiddenItems } };
    return next as T;
}

/** A copy of `layout` without its left ribbon, for comparisons that should ignore it. */
export function withoutRibbon(layout: unknown): unknown {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return layout;
    if (!Object.prototype.hasOwnProperty.call(layout, 'left-ribbon')) return layout;
    const next = { ...(layout as Record<string, unknown>) };
    delete next['left-ribbon'];
    return next;
}
