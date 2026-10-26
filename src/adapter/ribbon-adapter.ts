// Thin adapter isolating the left ribbon's internals for the ribbon lock.
// Obsidian has no public API for reading or reordering the ribbon; this uses
// app.workspace.leftRibbon, the same object the layout's 'left-ribbon' entry
// is loaded into and serialized from (verified in Obsidian 1.14.5):
//   - items:        [{ id, title, hidden, buttonEl? }] in display order
//   - serialize():  { hiddenItems } — id -> hidden, keys in display order
//   - load({ hiddenItems }): sets visibility and sorts items by key order
//   - ribbonItemsEl: the container the buttons are rendered into
// Every call is wrapped in try/catch and createRibbonAdapter() returns null
// when the shape is missing, so a future Obsidian change disables the lock
// instead of breaking the plugin. Callers gate on !Platform.isPhone: phones
// show ribbon actions in a navbar menu that this does not drive.
import type { App } from 'obsidian';
import { cloneHiddenItems, type RibbonHiddenItems } from '../core/ribbon-lock';

export interface RibbonAdapter {
    /** The live ribbon as an ordered id -> hidden map. */
    getHiddenItems(): RibbonHiddenItems | null;
    /** Ids of the items that have a button right now (enabled plugins), in order. */
    getLiveIds(): string[];
    /** Display title for an item id, falling back to the id. */
    getTitle(id: string): string;
    /** Load `hiddenItems` into the live ribbon and save the workspace. */
    apply(hiddenItems: RibbonHiddenItems): void;
    /** The element the ribbon buttons live in, for change observation. */
    getItemsEl(): HTMLElement | null;
}

interface RibbonItemLike {
    id: string;
    title?: string;
    hidden?: boolean;
    buttonEl?: HTMLElement;
}

interface LeftRibbonLike {
    items: RibbonItemLike[];
    serialize(): { hiddenItems?: Record<string, unknown> };
    load(state: { hiddenItems: RibbonHiddenItems }): void;
    ribbonItemsEl?: HTMLElement | null;
}

function getLeftRibbon(app: App): LeftRibbonLike | null {
    const ribbon = (app.workspace as unknown as { leftRibbon?: LeftRibbonLike }).leftRibbon;
    if (!ribbon || !Array.isArray(ribbon.items)) return null;
    if (typeof ribbon.serialize !== 'function' || typeof ribbon.load !== 'function') return null;
    return ribbon;
}

export function createRibbonAdapter(app: App): RibbonAdapter | null {
    if (!getLeftRibbon(app)) return null;
    return {
        getHiddenItems(): RibbonHiddenItems | null {
            try {
                const ribbon = getLeftRibbon(app);
                return ribbon ? cloneHiddenItems(ribbon.serialize().hiddenItems) : null;
            } catch {
                return null;
            }
        },
        getLiveIds(): string[] {
            try {
                const ribbon = getLeftRibbon(app);
                return ribbon ? ribbon.items.filter((item) => !!item.buttonEl).map((item) => item.id) : [];
            } catch {
                return [];
            }
        },
        getTitle(id: string): string {
            try {
                const item = getLeftRibbon(app)?.items.find((i) => i.id === id);
                return (item && item.title) || id;
            } catch {
                return id;
            }
        },
        apply(hiddenItems: RibbonHiddenItems): void {
            try {
                const ribbon = getLeftRibbon(app);
                if (!ribbon) return;
                ribbon.load({ hiddenItems: { ...hiddenItems } });
                // load() redraws without saving; persist it to workspace.json too.
                app.workspace.requestSaveLayout();
            } catch {
                // Best-effort; never break the caller.
            }
        },
        getItemsEl(): HTMLElement | null {
            try {
                return getLeftRibbon(app)?.ribbonItemsEl || null;
            } catch {
                return null;
            }
        },
    };
}
