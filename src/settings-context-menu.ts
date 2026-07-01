// Lightweight status-bar settings context menu (quick toggles). Functionally
// equivalent to the reference plugin's settings-context-menu.js (visual surface).
import { Menu } from 'obsidian';
import * as i18n from './i18n';

interface SettingsMenuPlugin {
    isAutoSaveOnSwitchEnabled(): boolean;
    toggleAutoSaveOnSwitch(options?: { notify?: boolean }): Promise<boolean>;
    isVersionHistoryEnabled(): boolean;
    setVersionHistoryEnabled(enabled: boolean): Promise<unknown>;
}

interface SettingsMenuOptions {
    plugin: SettingsMenuPlugin;
    app?: unknown;
    event?: unknown;
    onChanged?: () => void;
}

export function openSettingsContextMenu(options: SettingsMenuOptions): void {
    const L = i18n.L;
    const { plugin } = options;
    const menu = new Menu();
    const changed = (): void => {
        if (typeof options.onChanged === 'function') options.onChanged();
    };

    menu.addItem((m) =>
        m
            .setTitle(L.cmdToggleAutoSave)
            .setChecked(plugin.isAutoSaveOnSwitchEnabled())
            .onClick(() => void plugin.toggleAutoSaveOnSwitch({ notify: true }).then(changed)),
    );
    menu.addItem((m) =>
        m
            .setTitle(L.settingsVersionHistoryEnabled)
            .setChecked(plugin.isVersionHistoryEnabled())
            .onClick(() => void plugin.setVersionHistoryEnabled(!plugin.isVersionHistoryEnabled()).then(changed)),
    );

    const evt = options.event as MouseEvent | undefined;
    if (evt && typeof evt.clientX === 'number') menu.showAtMouseEvent(evt);
    else menu.showAtPosition({ x: 0, y: 0 });
}
