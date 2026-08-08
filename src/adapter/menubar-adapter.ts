// Thin adapter isolating the optional macOS menu-bar text feature. There is no
// public Obsidian plugin API for the native application menu; this reaches
// Electron's Menu/MenuItem API directly (require('electron') is reachable
// because Obsidian bundles Electron with Node integration for plugins), the
// same "undocumented internal" category the layout adapter confines for the
// workspace-layout APIs. Every entry point is wrapped in try/catch: if
// Electron access is ever blocked or restructured, this feature silently
// disables itself instead of breaking the plugin. Desktop macOS only —
// callers must gate on Platform.isMacOS && Platform.isDesktopApp before
// constructing this adapter.
//
// Design: rather than a system Tray icon (always visible regardless of which
// window is focused, which is why running several vaults at once used to
// show several stale "Vault - Workspace" entries at once), the text is
// injected as a plain (disabled) item appended to the end of the native
// application menu, right after Help. macOS only ever displays the
// frontmost process's application menu, so this gets "only one shown at a
// time, matching the focused vault" for free — no window focus/blur
// tracking needed. Obsidian occasionally rebuilds its own application menu
// wholesale (e.g. after hotkeys change), which would silently drop our
// injected item; every setTitle() call re-checks for it and re-injects if
// missing, so it self-heals rather than needing an explicit rebuild hook.
//
// macOS gotcha (verified empirically against Obsidian 1.12.7 via the
// Accessibility API): a top-level application-menu item with NO submenu is
// silently never drawn in the menu bar, even though it is present in the Menu
// object that Menu.getApplicationMenu() returns. The `enabled` flag has no
// bearing on this — a disabled item with a submenu still renders (greyed),
// while an enabled item without one does not render at all. So the item MUST
// carry a submenu to be visible; we give it a one-entry disabled submenu
// echoing the same text, since this item is a status readout, not a command.
// Colour: AppKit exposes no way to colour a menu title through Electron
// (MenuItem has no colour option, and NSMenuItem.attributedTitle is not
// surfaced), so a custom colour is achieved by drawing the text into an image
// and handing that over as the item's `icon`. Verified empirically: when a
// top-level item carries an icon, macOS draws the icon INSTEAD of the label,
// and does so in full colour without template-tinting it. The label is still
// set alongside the icon — it is what macOS falls back to if the image is
// rejected, and it is what lets setTitle() detect another vault having
// overwritten the shared menu. A null colour keeps the plain label so the
// default stays genuinely native (and keeps adapting to the system
// appearance, which a fixed colour cannot).
export interface MenuBarAdapter {
    /** Set the injected menu item's text, optionally drawn in a custom colour. */
    setTitle(text: string, color?: string | null): void;
    /** Remove the injected menu item. */
    destroy(): void;
}

const MENU_ITEM_ID = 'workspace-mgr-vault-session';

interface ElectronMenuItemLike {
    id?: string;
    label: string;
}

interface ElectronMenuLike {
    items: ElectronMenuItemLike[];
    append(item: ElectronMenuItemLike): void;
}

interface ElectronMenuConstructor {
    new (): ElectronMenuLike;
    getApplicationMenu(): ElectronMenuLike | null;
    setApplicationMenu(menu: ElectronMenuLike | null): void;
}

interface ElectronMenuItemConstructor {
    new (options: {
        id: string;
        label: string;
        enabled: boolean;
        submenu: { label: string; enabled: boolean }[];
        icon?: ElectronNativeImageLike;
    }): ElectronMenuItemLike;
}

interface ElectronNativeImageLike {
    isEmpty(): boolean;
    addRepresentation(options: { scaleFactor: number; dataURL: string }): void;
}

interface ElectronNativeImageStatic {
    createFromDataURL(dataURL: string): ElectronNativeImageLike;
}

const FONT_SIZE = 13; // matches the macOS menu-bar type size
const HEIGHT = 18;
const PAD_X = 4;

/** Draw the text at `scale`x and return it as a PNG data URL, or null. */
function drawTextDataURL(text: string, color: string, scale: number): string | null {
    const font = `${FONT_SIZE * scale}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`;
    const canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width);
    if (width <= 0) return null;

    canvas.width = width + PAD_X * 2 * scale;
    canvas.height = HEIGHT * scale;
    // Resizing the canvas resets its context, so re-acquire and re-apply state.
    ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, PAD_X * scale, canvas.height / 2);
    return canvas.toDataURL();
}

/**
 * Draw `text` in `color` as a menu-bar image, or null if it can't be produced
 * (in which case the caller falls back to a plain system label).
 *
 * The 1x bitmap establishes the image's point size — macOS lays the menu item
 * out at those points, so this is what keeps the text at the same size as the
 * surrounding menu titles. A 2x bitmap is then layered on as an extra
 * representation purely for sharpness on Retina; AppKit picks whichever
 * representation matches the display.
 *
 * Both halves of that matter, and getting either wrong is silent:
 *  - Building the image from ONLY a high-DPI bitmap (e.g. createEmpty() +
 *    addRepresentation({ scaleFactor: 2 })) yields a wrongly-sized image that
 *    macOS squashes into an illegible sliver.
 *  - nativeImage.createFromBuffer(buf, { scaleFactor }) is worse still: it
 *    sizes the result by scaleFactor SQUARED (a 200x40 bitmap at scaleFactor 2
 *    comes back as 50x10).
 * Verified by screenshotting the real menu bar; neither failure is visible
 * from JS, since the image reports a plausible size either way.
 */
function renderTextImage(
    nativeImage: ElectronNativeImageStatic,
    text: string,
    color: string,
): ElectronNativeImageLike | null {
    const base = drawTextDataURL(text, color, 1);
    if (!base) return null;
    const image = nativeImage.createFromDataURL(base);
    if (image.isEmpty()) return null;

    const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
    if (scale > 1) {
        const hiDpi = drawTextDataURL(text, color, scale);
        if (hiDpi) image.addRepresentation({ scaleFactor: scale, dataURL: hiDpi });
    }
    return image;
}

interface ResolvedElectron {
    Menu: ElectronMenuConstructor;
    MenuItem: ElectronMenuItemConstructor;
    /** Absent only if Electron restructures; colour then degrades to a plain label. */
    nativeImage: ElectronNativeImageStatic | null;
}

function resolveMenuConstructors(): ResolvedElectron | null {
    const candidates = ['@electron/remote', 'electron'];
    for (const moduleName of candidates) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require(moduleName) as Record<string, unknown>;
            const remote = (mod.remote as Record<string, unknown> | undefined) || mod;
            const Menu = remote.Menu as ElectronMenuConstructor | undefined;
            const MenuItem = remote.MenuItem as ElectronMenuItemConstructor | undefined;
            const nativeImage = (remote.nativeImage as ElectronNativeImageStatic | undefined) ?? null;
            if (Menu && MenuItem) return { Menu, MenuItem, nativeImage };
        } catch {
            // Module unavailable in this context; try the next candidate.
        }
    }
    return null;
}

/** Find our injected item, searching from the end where it is always appended. */
function findOurItem(appMenu: ElectronMenuLike | null): ElectronMenuItemLike | null {
    if (!appMenu) return null;
    const items = appMenu.items;
    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].id === MENU_ITEM_ID) return items[i];
    }
    return null;
}

/** Rebuild the application menu with our item appended (after Help), replacing any prior copy of it. */
function injectItem(
    electron: ResolvedElectron,
    text: string,
    icon: ElectronNativeImageLike | null,
): ElectronMenuItemLike | null {
    const { Menu, MenuItem } = electron;
    const appMenu = Menu.getApplicationMenu();
    const newMenu = new Menu();
    if (appMenu) {
        for (const item of appMenu.items) {
            if (item.id !== MENU_ITEM_ID) newMenu.append(item);
        }
    }
    // The submenu is what makes macOS draw the item at all (see header note).
    const ourItem = new MenuItem({
        id: MENU_ITEM_ID,
        label: text,
        enabled: true,
        submenu: [{ label: text, enabled: false }],
        ...(icon ? { icon } : {}),
    });
    newMenu.append(ourItem);
    Menu.setApplicationMenu(newMenu);
    return ourItem;
}

export function createMenuBarAdapter(): MenuBarAdapter | null {
    try {
        const resolved = resolveMenuConstructors();
        if (!resolved) return null;
        const { Menu, nativeImage } = resolved;

        // The colour currently drawn into the icon. The live menu can be
        // inspected for the label but not for the icon's colour, so this one
        // bit has to be remembered — it is only ever used to force a redraw,
        // never to skip one, so it cannot cause the staleness described below.
        let lastColor: string | null = null;

        return {
            setTitle(text: string, color?: string | null): void {
                try {
                    const wanted = typeof color === 'string' && color.trim() ? color.trim() : null;
                    const appMenu = Menu.getApplicationMenu();
                    // Scan from the end: our item is always appended last, and every
                    // property read here is a synchronous IPC hop into the main
                    // process. This runs on a short interval, so the usual case
                    // should cost one read, not one per menu.
                    const existing = findOurItem(appMenu);
                    // Compare against the live menu's own label rather than caching the
                    // last value we wrote: Obsidian runs every vault window in ONE
                    // process, and macOS has ONE application menu per process, so all
                    // vaults share this menu and overwrite each other's title. A
                    // per-instance cache would go stale the moment another vault wrote
                    // its own name, and this window would then skip re-claiming the
                    // title when it regained focus.
                    if (existing && existing.label === text && lastColor === wanted) return;
                    // Rebuild rather than mutate .label: the label lives in two places
                    // (the item and its submenu entry), and macOS only re-draws the menu
                    // bar when the application menu is set again.
                    const icon = wanted && nativeImage ? renderTextImage(nativeImage, text, wanted) : null;
                    injectItem(resolved, text, icon);
                    lastColor = wanted;
                } catch {
                    // Best-effort; a failed title update should never crash the plugin.
                }
            },
            destroy(): void {
                try {
                    lastColor = null;
                    const appMenu = Menu.getApplicationMenu();
                    if (!appMenu) return;
                    const filtered = appMenu.items.filter((item) => item.id !== MENU_ITEM_ID);
                    if (filtered.length === appMenu.items.length) return;
                    const newMenu = new Menu();
                    for (const item of filtered) newMenu.append(item);
                    Menu.setApplicationMenu(newMenu);
                } catch {
                    // Already gone; nothing to clean up.
                }
            },
        };
    } catch {
        return null;
    }
}
