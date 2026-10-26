// Keeps the live left ribbon on the locked configuration. The data (the pin,
// the unknown-item setting) lives in SessionService; this applies it through
// the RibbonAdapter at the moments a layout can change the ribbon:
//   - at startup, once the layout is ready;
//   - on every workspace-mgr switch, by stamping the pin into the layout
//     BEFORE changeLayout (stampLayout), so the ribbon never flickers;
//   - after any other layout load (core Workspaces, Commander macros), seen
//     as a `layout-change` with a ribbon that no longer matches;
//   - after a hand edit (drag or hide) — that fires no workspace event, so the
//     ribbon's own element is observed instead, and the user is told why the
//     change was undone rather than having it silently reverted.
// Re-applying is idempotent: it does nothing while the live ribbon already
// matches, so the redraw it causes can never start another round.
import * as i18n from './i18n';
import { buildLockedRibbon, ribbonMatches, stampRibbonIntoLayout, type LockedRibbon } from './core/ribbon-lock';
import type { RibbonAdapter } from './adapter/ribbon-adapter';
import type { SessionService } from './core/session-service';
import type { Layout } from './core/types';

/** A ribbon redraw this soon after a layout load belongs to that load, not to the user. */
const LAYOUT_LOAD_GRACE_MS = 1000;
/** Redraws inside this window after our own apply are ours. */
const SELF_APPLY_GRACE_MS = 300;
/**
 * A layout load redraws the ribbon a little before it fires `layout-change`;
 * waiting this long lets that event arrive first, so a load is never mistaken
 * for a hand edit.
 */
const HAND_EDIT_SETTLE_MS = 400;

type EnforceSource = 'startup' | 'layout' | 'external' | 'hand-edit';

export class RibbonLockController {
    private applyingUntil = 0;
    private layoutChangedAt = 0;
    private observer: MutationObserver | null = null;
    private handEditTimer: number | null = null;

    constructor(
        private session: SessionService,
        private adapter: RibbonAdapter,
        private notify: (message: string, timeoutMs?: number) => void,
    ) {}

    /** The ribbon the lock wants right now, or null while unlocked. */
    expected(): LockedRibbon | null {
        const lock = this.session.getRibbonLock();
        if (!lock || !lock.enabled) return null;
        return buildLockedRibbon(lock.hiddenItems, this.adapter.getLiveIds(), this.session.isRibbonLockUnknownHidden());
    }

    /** `layout` with the locked ribbon written in; unchanged while unlocked. */
    stampLayout(layout: Layout): Layout {
        if (!layout || typeof layout !== 'object') return layout;
        const expected = this.expected();
        return expected ? stampRibbonIntoLayout(layout, expected.hiddenItems) : layout;
    }

    /** Lock to (or, while locked, re-pin from) the live ribbon. */
    lockFromCurrent(): Promise<boolean> {
        const live = this.adapter.getHiddenItems();
        if (!live) return Promise.resolve(false);
        return this.session.lockRibbon(live);
    }

    /** Start enforcing; call once the workspace layout is ready. */
    start(): void {
        this.enforce('startup');
        const el = this.adapter.getItemsEl();
        if (!el || typeof MutationObserver === 'undefined') return;
        this.observer = new MutationObserver(() => this.onRibbonRedrawn());
        this.observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    }

    stop(): void {
        if (this.observer) this.observer.disconnect();
        this.observer = null;
        if (this.handEditTimer !== null) window.clearTimeout(this.handEditTimer);
        this.handEditTimer = null;
    }

    noteLayoutChange(): void {
        this.layoutChangedAt = Date.now();
        this.enforce('layout');
    }

    noteExternalChange(): void {
        this.enforce('external');
    }

    private onRibbonRedrawn(): void {
        if (Date.now() < this.applyingUntil) return;
        if (this.handEditTimer !== null) window.clearTimeout(this.handEditTimer);
        this.handEditTimer = window.setTimeout(() => {
            this.handEditTimer = null;
            const fromLayout =
                this.session.isSwitchingSession || Date.now() - this.layoutChangedAt < LAYOUT_LOAD_GRACE_MS;
            this.enforce(fromLayout ? 'layout' : 'hand-edit');
        }, HAND_EDIT_SETTLE_MS);
    }

    /** Bring the live ribbon back to the lock. Returns true if it had to change anything. */
    enforce(source: EnforceSource): boolean {
        const expected = this.expected();
        if (!expected) return false;
        this.announceUnknown(expected.unknownIds);
        const live = this.adapter.getHiddenItems();
        if (!live || ribbonMatches(live, expected.hiddenItems)) return false;

        const handEdited = source === 'hand-edit' && !this.onlyUnknownItemsDiffer(live);
        this.applyingUntil = Date.now() + SELF_APPLY_GRACE_MS;
        this.adapter.apply(expected.hiddenItems);
        if (handEdited) this.notify(i18n.L.ribbonLockRevertedNotice, 8000);
        return true;
    }

    /**
     * True when the pinned items are already in pinned order and visibility, so
     * the mismatch is only a newly added icon taking its place — not something
     * the user did by hand.
     */
    private onlyUnknownItemsDiffer(live: Record<string, boolean>): boolean {
        const lock = this.session.getRibbonLock();
        if (!lock) return true;
        const knownLive: Record<string, boolean> = {};
        for (const id of Object.keys(live)) {
            if (Object.prototype.hasOwnProperty.call(lock.hiddenItems, id)) knownLive[id] = live[id];
        }
        return ribbonMatches(knownLive, lock.hiddenItems);
    }

    private announceUnknown(unknownIds: string[]): void {
        if (unknownIds.length === 0) return;
        const fresh = this.session.takeUnannouncedRibbonIds(unknownIds);
        if (fresh.length === 0) return;
        const names = fresh.map((id) => this.adapter.getTitle(id)).join(', ');
        this.notify(i18n.L.ribbonLockUnknownNotice(names), 15000);
    }
}
