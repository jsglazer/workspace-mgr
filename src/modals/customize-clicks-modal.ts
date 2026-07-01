import { App, Modal, Setting } from 'obsidian';
import * as i18n from '../i18n';
import { ACTION_IDS, SLOT_KEYS, getActionLabel } from '../statusbar-actions';

interface CustomizeClicksPlugin {
    data: { statusBarActions?: Record<string, string> | null };
    setStatusBarAction(slotKey: string, actionId: string): Promise<unknown>;
    updateStatusBar(): void;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function slotLabel(L: Record<string, unknown>, slotKey: string): string {
    const label = L['statusBarSlot' + capitalize(slotKey)];
    return typeof label === 'function' ? (label as () => string)() : (label as string);
}

/**
 * Full status-bar action matrix: every modifier-key slot (click / middle-click /
 * right-click, each plain or with Alt/Cmd(Ctrl)/Shift) mapped to any of the
 * existing status-bar actions. Reachable via the session context menu's
 * "Customize click actions" item.
 */
export default class CustomizeClicksModal extends Modal {
    private plugin: CustomizeClicksPlugin;

    constructor(app: App, plugin: CustomizeClicksPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const L = i18n.L;
        const contentEl = this.contentEl;
        contentEl.addClass('wsmgr-customize-clicks');
        this.titleEl.setText(L.contextCustomizeClicks);

        for (const slotKey of SLOT_KEYS) {
            new Setting(contentEl).setName(slotLabel(L as unknown as Record<string, unknown>, slotKey)).addDropdown((d) => {
                for (const actionId of ACTION_IDS) d.addOption(actionId, getActionLabel(L as unknown as Record<string, unknown>, actionId));
                const current = (this.plugin.data.statusBarActions || {})[slotKey] || 'none';
                d.setValue(current).onChange(async (value) => {
                    await this.plugin.setStatusBarAction(slotKey, value);
                    this.plugin.updateStatusBar();
                });
            });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
