// Thin adapter isolating the optional macOS menu-bar text feature. There is no
// public Obsidian plugin API for the system menu bar; this reaches Electron's
// Tray API directly (require('electron') is reachable because Obsidian bundles
// Electron with Node integration for plugins), the same "undocumented internal"
// category the layout adapter confines for the workspace-layout APIs. Every
// entry point is wrapped in try/catch: if Electron access is ever blocked or
// restructured, this feature silently disables itself instead of breaking the
// plugin. Desktop macOS only — callers must gate on Platform.isMacOS &&
// Platform.isDesktopApp before constructing this adapter.
export interface MenuBarAdapter {
    /** Set the menu-bar text next to the tray icon. */
    setTitle(text: string): void;
    /** Remove the tray icon. */
    destroy(): void;
}

interface ElectronTrayLike {
    setTitle(title: string): void;
    destroy(): void;
}

function resolveTrayConstructor(): { Tray: new (icon: unknown) => ElectronTrayLike; nativeImage: { createEmpty(): unknown } } | null {
    const candidates = ['@electron/remote', 'electron'];
    for (const moduleName of candidates) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require(moduleName) as Record<string, unknown>;
            const remote = (mod.remote as Record<string, unknown> | undefined) || mod;
            const Tray = remote.Tray as (new (icon: unknown) => ElectronTrayLike) | undefined;
            const nativeImage = remote.nativeImage as { createEmpty(): unknown } | undefined;
            if (Tray && nativeImage) return { Tray, nativeImage };
        } catch {
            // Module unavailable in this context; try the next candidate.
        }
    }
    return null;
}

export function createMenuBarAdapter(): MenuBarAdapter | null {
    try {
        const resolved = resolveTrayConstructor();
        if (!resolved) return null;
        const icon = resolved.nativeImage.createEmpty();
        const tray = new resolved.Tray(icon);
        return {
            setTitle(text: string): void {
                try {
                    tray.setTitle(text);
                } catch {
                    // Best-effort; a failed title update should never crash the plugin.
                }
            },
            destroy(): void {
                try {
                    tray.destroy();
                } catch {
                    // Already gone; nothing to clean up.
                }
            },
        };
    } catch {
        return null;
    }
}
