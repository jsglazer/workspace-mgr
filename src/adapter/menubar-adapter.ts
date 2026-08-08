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
export interface MenuBarAdapter {
    /** Set the injected menu item's text. */
    setTitle(text: string): void;
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
    }): ElectronMenuItemLike;
}

function resolveMenuConstructors(): { Menu: ElectronMenuConstructor; MenuItem: ElectronMenuItemConstructor } | null {
    const candidates = ['@electron/remote', 'electron'];
    for (const moduleName of candidates) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require(moduleName) as Record<string, unknown>;
            const remote = (mod.remote as Record<string, unknown> | undefined) || mod;
            const Menu = remote.Menu as ElectronMenuConstructor | undefined;
            const MenuItem = remote.MenuItem as ElectronMenuItemConstructor | undefined;
            if (Menu && MenuItem) return { Menu, MenuItem };
        } catch {
            // Module unavailable in this context; try the next candidate.
        }
    }
    return null;
}

/** Rebuild the application menu with our item appended (after Help), replacing any prior copy of it. */
function injectItem(
    Menu: ElectronMenuConstructor,
    MenuItem: ElectronMenuItemConstructor,
    text: string,
): ElectronMenuItemLike | null {
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
    });
    newMenu.append(ourItem);
    Menu.setApplicationMenu(newMenu);
    return ourItem;
}

export function createMenuBarAdapter(): MenuBarAdapter | null {
    try {
        const resolved = resolveMenuConstructors();
        if (!resolved) return null;
        const { Menu, MenuItem } = resolved;

        return {
            setTitle(text: string): void {
                try {
                    const appMenu = Menu.getApplicationMenu();
                    const existing = appMenu?.items.find((item) => item.id === MENU_ITEM_ID) ?? null;
                    // Compare against the live menu's own label rather than caching the
                    // last value we wrote: Obsidian runs every vault window in ONE
                    // process, and macOS has ONE application menu per process, so all
                    // vaults share this menu and overwrite each other's title. A
                    // per-instance cache would go stale the moment another vault wrote
                    // its own name, and this window would then skip re-claiming the
                    // title when it regained focus.
                    if (existing && existing.label === text) return;
                    // Rebuild rather than mutate .label: the label lives in two places
                    // (the item and its submenu entry), and macOS only re-draws the menu
                    // bar when the application menu is set again.
                    injectItem(Menu, MenuItem, text);
                } catch {
                    // Best-effort; a failed title update should never crash the plugin.
                }
            },
            destroy(): void {
                try {
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
