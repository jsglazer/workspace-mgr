// Status-bar rendering. Ported from the reference plugin's
// plugin/methods/session-statusbar.js with the wpp- class prefix renamed to
// wsmgr-. The session-name colour is applied via the --wsmgr-status-name-color
// CSS custom property (set on the document root), not inline here.
import { setIcon } from 'obsidian';
import * as i18n from './i18n';
import type { Group, Session } from './core/types';

interface StatusBarSpanAttrs {
    text?: string;
    cls?: string;
}

interface StatusBarEl {
    addClass(cls: string): void;
    removeClass(cls: string): void;
    empty(): void;
    createSpan(attrs?: StatusBarSpanAttrs): HTMLElement;
}

export interface StatusBarHost {
    statusBarEl?: StatusBarEl | null;
    getActiveSession(): Session | null;
    getActiveGroup(): Group | null;
    shouldShowUnsavedStatusBarHighlight(): boolean;
}

export function renderStatusBar(host: StatusBarHost): void {
    const L = i18n.L;
    const session = host.getActiveSession();
    if (!host.statusBarEl) return;
    const showUnsavedHighlight = host.shouldShowUnsavedStatusBarHighlight();

    host.statusBarEl.removeClass('wsmgr-status-bar-unsaved');
    if (showUnsavedHighlight) host.statusBarEl.addClass('wsmgr-status-bar-unsaved');

    host.statusBarEl.empty();
    const icon = host.statusBarEl.createSpan({ cls: 'wsmgr-status-icon' });
    setIcon(icon, 'panels-top-left');

    const activeGroup = host.getActiveGroup();
    if (activeGroup) {
        host.statusBarEl.createSpan({ text: activeGroup.name, cls: 'wsmgr-status-group' });
        host.statusBarEl.createSpan({ text: ' / ', cls: 'wsmgr-status-separator' });
    }

    host.statusBarEl.createSpan({ text: session ? session.name : L.noSession, cls: 'wsmgr-status-name' });
}
