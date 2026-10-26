// Thin adapter isolating the pinned-window-size feature's Electron access, in
// the same "undocumented internal" category as the menu-bar adapter: Obsidian
// exposes no plugin API for the application window, so this reaches Electron's
// BrowserWindow/screen through @electron/remote (or electron.remote). Every
// entry point is wrapped in try/catch, and createWindowAdapter() returns null
// when Electron is unreachable — callers hide the feature in that case.
// Desktop only: callers must gate on Platform.isDesktopApp.
//
// getCurrentWindow() is the window whose renderer runs the plugin, i.e. the
// main window; popout windows are separate BrowserWindows and are never touched.
import { resolveTargetRect, type Rect, type WindowRestoreMode } from '../core/window-bounds';
import type { WindowBounds } from '../core/types';

export interface WindowAdapter {
    /** The main window's current bounds, as a pin would record them. */
    captureBounds(): WindowBounds | null;
    /** Resize (and, in 'size-location' mode, move) the main window to `bounds`. */
    applyBounds(bounds: WindowBounds, mode: WindowRestoreMode): void;
}

interface BrowserWindowLike {
    getBounds(): Rect;
    getNormalBounds(): Rect;
    setBounds(bounds: Rect): void;
    isMaximized(): boolean;
    isFullScreen(): boolean;
    maximize(): void;
    unmaximize(): void;
    setFullScreen(flag: boolean): void;
    once(event: string, listener: () => void): void;
}

interface ScreenLike {
    getAllDisplays(): { workArea: Rect }[];
}

interface ResolvedElectron {
    getCurrentWindow(): BrowserWindowLike | null;
    screen: ScreenLike;
}

function resolveElectron(): ResolvedElectron | null {
    for (const moduleName of ['@electron/remote', 'electron']) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require(moduleName) as Record<string, unknown>;
            const remote = (mod.remote as Record<string, unknown> | undefined) || mod;
            const getCurrentWindow = remote.getCurrentWindow as (() => BrowserWindowLike | null) | undefined;
            const screen = remote.screen as ScreenLike | undefined;
            if (typeof getCurrentWindow === 'function' && screen && getCurrentWindow()) {
                return { getCurrentWindow: () => getCurrentWindow(), screen };
            }
        } catch {
            // Module unavailable in this context; try the next candidate.
        }
    }
    return null;
}

export function createWindowAdapter(): WindowAdapter | null {
    const electron = resolveElectron();
    if (!electron) return null;

    const workAreas = (): Rect[] => electron.screen.getAllDisplays().map((d) => d.workArea);

    const setRect = (win: BrowserWindowLike, bounds: WindowBounds, mode: WindowRestoreMode): void => {
        const rect = resolveTargetRect(bounds, win.getBounds(), mode, workAreas());
        win.setBounds(rect);
    };

    return {
        captureBounds(): WindowBounds | null {
            try {
                const win = electron.getCurrentWindow();
                if (!win) return null;
                const maximized = win.isMaximized();
                const fullScreen = win.isFullScreen();
                // Maximized/full-screen bounds are the screen's; the normal bounds
                // are the size the window returns to, which is what a pin means.
                const rect = maximized || fullScreen ? win.getNormalBounds() : win.getBounds();
                const out: WindowBounds = {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                };
                if (maximized) out.maximized = true;
                if (fullScreen) out.fullScreen = true;
                return out;
            } catch {
                return null;
            }
        },
        applyBounds(bounds: WindowBounds, mode: WindowRestoreMode): void {
            try {
                const win = electron.getCurrentWindow();
                if (!win) return;
                if (mode === 'size') {
                    // A full-screen window can't be resized; leave it alone.
                    if (win.isFullScreen()) return;
                    if (win.isMaximized()) win.unmaximize();
                    setRect(win, bounds, mode);
                    return;
                }
                const finish = (): void => {
                    try {
                        if (win.isMaximized() && !bounds.maximized) win.unmaximize();
                        setRect(win, bounds, mode);
                        if (bounds.fullScreen) win.setFullScreen(true);
                        else if (bounds.maximized) win.maximize();
                    } catch {
                        // Best-effort; a failed resize should never break a switch.
                    }
                };
                if (win.isFullScreen() && !bounds.fullScreen) {
                    // Leaving full screen is animated on macOS; bounds set before
                    // it finishes are discarded, so wait for it.
                    win.once('leave-full-screen', finish);
                    win.setFullScreen(false);
                    return;
                }
                if (win.isFullScreen() && bounds.fullScreen) return;
                finish();
            } catch {
                // Best-effort; a failed resize should never break a switch.
            }
        },
    };
}
