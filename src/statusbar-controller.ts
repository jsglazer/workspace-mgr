// Status-bar interaction controller: scroll-to-switch config, modifier/click slot
// resolution, wheel accumulation, and DOM wiring. Ported from the reference
// plugin's statusbar-controller.js. Pure decision helpers are exported for unit
// testing; setupStatusBar performs the (DOM) wiring at the shell boundary.
import { isMacPlatform, isModPressed } from './core/utils';
import { executeStatusBarAction } from './statusbar-actions';

export interface ScrollConfig {
    threshold: number;
    cooldownMs: number;
    resetMs: number;
}

interface ScrollSettings {
    statusBarScrollPreset?: string;
    statusBarScrollThreshold?: string | number;
    statusBarScrollCooldownMs?: string | number;
    statusBarScrollResetMs?: string | number;
    [key: string]: unknown;
}

interface ModifierEventLike {
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
}

interface WheelEventLike extends ModifierEventLike {
    deltaX?: number;
    deltaY?: number;
    deltaMode?: number;
    preventDefault(): void;
    stopPropagation(): void;
}

interface ScrollPlugin {
    data: ScrollSettings & {
        statusBarModScrollSwitch?: boolean;
        statusBarScrollModifierMode?: string;
        statusBarScrollInvert?: boolean;
    };
    isSwitchingSession: boolean;
    statusBarScrollDelta: number;
    statusBarScrollEventAt: number;
    statusBarScrollSwitchAt: number;
    switchRelativeFromScroll(direction: number): Promise<boolean>;
}

const STATUS_BAR_SCROLL_PRESETS: Record<string, ScrollConfig> = {
    trackpad: { threshold: 30, cooldownMs: 500, resetMs: 250 },
    notchedWheel: { threshold: 16, cooldownMs: 350, resetMs: 220 },
    freeSpinWheel: { threshold: 48, cooldownMs: 650, resetMs: 320 },
};

export function getStatusBarScrollConfig(data: ScrollSettings): ScrollConfig {
    const presetId = (data && data.statusBarScrollPreset) || 'trackpad';
    if (presetId === 'custom') {
        return {
            threshold: Number((data && data.statusBarScrollThreshold) || 30) || 30,
            cooldownMs: Number((data && data.statusBarScrollCooldownMs) || 500) || 500,
            resetMs: Number((data && data.statusBarScrollResetMs) || 250) || 250,
        };
    }
    return STATUS_BAR_SCROLL_PRESETS[presetId] || STATUS_BAR_SCROLL_PRESETS.trackpad;
}

export function matchesStatusBarScrollModifier(evt: ModifierEventLike, isMac: boolean, mode?: string): boolean {
    const m = mode || 'none';
    const modPressed = isMac ? !!evt.metaKey : !!evt.ctrlKey;
    const altPressed = !!evt.altKey;
    if (m === 'none') return !modPressed && !altPressed;
    if (m === 'modOnly') return modPressed;
    if (m === 'altOnly') return altPressed;
    if (m === 'modOrAlt') return modPressed || altPressed;
    return modPressed || altPressed;
}

function getModifiedStatusBarSlot(evt: ModifierEventLike, baseSlot: string): string {
    const baseName = baseSlot.charAt(0).toUpperCase() + baseSlot.slice(1);
    if (evt.altKey) return 'alt' + baseName;
    if (isModPressed(evt)) return 'mod' + baseName;
    if (evt.shiftKey) return 'shift' + baseName;
    return baseSlot;
}

export function getClickSlot(evt: ModifierEventLike): string {
    return getModifiedStatusBarSlot(evt, 'click');
}

export function getMiddleClickSlot(evt: ModifierEventLike): string {
    return getModifiedStatusBarSlot(evt, 'middleClick');
}

export function getRightClickSlot(evt: ModifierEventLike): string {
    return getModifiedStatusBarSlot(evt, 'rightClick');
}

function getStatusBarAction(plugin: { data?: { statusBarActions?: Record<string, string> } }, slotKey: string): string {
    return ((plugin.data && plugin.data.statusBarActions) || {})[slotKey] || 'none';
}

function normalizeWheelDeltaY(evt: WheelEventLike): number {
    const deltaY = evt.deltaY || 0;
    if (evt.deltaMode === 1) return deltaY * 16;
    if (evt.deltaMode === 2) return deltaY * 240;
    return deltaY;
}

export function handleStatusBarWheel(plugin: ScrollPlugin, evt: WheelEventLike, now?: number): boolean {
    if (!plugin.data.statusBarModScrollSwitch) return false;
    const isMac = isMacPlatform();
    const cfg = getStatusBarScrollConfig(plugin.data);
    if (!matchesStatusBarScrollModifier(evt, isMac, plugin.data.statusBarScrollModifierMode)) return false;
    if (Math.abs(evt.deltaY || 0) <= Math.abs(evt.deltaX || 0)) return false;

    evt.preventDefault();
    evt.stopPropagation();

    const t = typeof now === 'number' ? now : Date.now();
    if (plugin.isSwitchingSession) return false;
    if (t - plugin.statusBarScrollSwitchAt < cfg.cooldownMs) return false;

    if (t - plugin.statusBarScrollEventAt > cfg.resetMs) plugin.statusBarScrollDelta = 0;
    plugin.statusBarScrollEventAt = t;
    plugin.statusBarScrollDelta += normalizeWheelDeltaY(evt);

    if (Math.abs(plugin.statusBarScrollDelta) < cfg.threshold) return false;

    let direction = plugin.statusBarScrollDelta < 0 ? -1 : 1;
    if (plugin.data.statusBarScrollInvert) direction *= -1;
    plugin.statusBarScrollDelta = 0;
    plugin.statusBarScrollSwitchAt = t;
    plugin.switchRelativeFromScroll(direction).catch(() => {});
    return true;
}

interface StatusBarElement {
    addClass(cls: string): void;
    addEventListener(type: string, handler: (evt: WheelEventLike & { button?: number }) => void, options?: unknown): void;
}

interface SetupPlugin extends ScrollPlugin {
    statusBarEl?: StatusBarElement;
    addStatusBarItem(): StatusBarElement;
    updateStatusBar(): void;
    data: ScrollPlugin['data'] & { statusBarActions?: Record<string, string> };
}

function executeStatusBarSlot(plugin: SetupPlugin, slotKey: string, evt: WheelEventLike, options?: { preventDefault?: boolean }): unknown {
    const opts = options || {};
    const action = getStatusBarAction(plugin, slotKey);
    if (action !== 'none' && opts.preventDefault !== false) {
        evt.preventDefault();
        evt.stopPropagation();
    }
    // The real plugin implements both the scroll surface and the full action
    // surface; the controller only needs the former, so widen at the boundary.
    return executeStatusBarAction(plugin as never, action, evt);
}

export function setupStatusBar(plugin: SetupPlugin): StatusBarElement {
    plugin.statusBarEl = plugin.addStatusBarItem();
    plugin.statusBarEl.addClass('wsmgr-status-bar');

    plugin.statusBarEl.addEventListener('click', (evt) => {
        executeStatusBarSlot(plugin, getClickSlot(evt), evt);
    });
    plugin.statusBarEl.addEventListener('auxclick', (evt) => {
        if (evt.button !== 1) return;
        executeStatusBarSlot(plugin, getMiddleClickSlot(evt), evt);
    });
    plugin.statusBarEl.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        const action = getStatusBarAction(plugin, getRightClickSlot(evt));
        executeStatusBarAction(plugin as never, action, evt);
    });
    plugin.statusBarEl.addEventListener(
        'wheel',
        (evt) => {
            handleStatusBarWheel(plugin, evt);
        },
        { passive: false },
    );

    plugin.updateStatusBar();
    return plugin.statusBarEl;
}
