// Settings tab. Exposes the status-bar session-name colour picker (applied via
// the --wsmgr-status-name-color CSS custom property on the document root — no
// dynamic <style> injection) plus the core session/history toggles. A focused
// subset of the reference plugin's large settings surface.
import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import * as i18n from './i18n';
import { STATUS_NAME_COLOR_FALLBACK } from './core/css';
import type { SessionData } from './core/types';
import type { SessionService } from './core/session-service';

export interface SettingsHost {
    app: App;
    data: SessionData;
    session: SessionService;
    /** Apply the current status-name colour to the document-root custom property. */
    applyStatusNameColor(): void;
    updateStatusBar(): void;
}

export class WorkspaceMgrSettingTab extends PluginSettingTab {
    private host: SettingsHost;

    constructor(app: App, plugin: Plugin & SettingsHost) {
        super(app, plugin);
        this.host = plugin;
    }

    display(): void {
        const L = i18n.L;
        const { containerEl } = this;
        containerEl.empty();
        const data = this.host.data;

        // --- Status-bar session-name colour ---
        new Setting(containerEl)
            .setName(L.settingsSectionSessionListSearch ? 'Status bar session name colour' : 'Status bar colour')
            .setDesc('Colour of the session name shown in the status bar.')
            .addColorPicker((cp) => {
                const current = typeof data.statusBarNameColor === 'string' && data.statusBarNameColor
                    ? (data.statusBarNameColor as string)
                    : '';
                if (current) cp.setValue(current);
                cp.onChange(async (value) => {
                    await this.host.session.setStatusBarNameColor(value);
                    this.host.applyStatusNameColor();
                });
            })
            .addExtraButton((b) =>
                b
                    .setIcon('rotate-ccw')
                    .setTooltip('Reset to theme default (' + STATUS_NAME_COLOR_FALLBACK + ')')
                    .onClick(async () => {
                        await this.host.session.setStatusBarNameColor('');
                        this.host.applyStatusNameColor();
                        this.display();
                    }),
            );

        // --- Auto-save on switch ---
        new Setting(containerEl)
            .setName(L.settingsAutoSaveOnSwitch)
            .setDesc(L.settingsAutoSaveOnSwitchDesc)
            .addToggle((t) =>
                t.setValue(this.host.session.isAutoSaveOnSwitchEnabled()).onChange(async (v) => {
                    await this.host.session.setAutoSaveOnSwitch(v);
                }),
            );

        // --- Warn on unsaved switch ---
        new Setting(containerEl)
            .setName(L.settingsWarnUnsavedSwitch)
            .setDesc(L.settingsWarnUnsavedSwitchDesc)
            .addToggle((t) =>
                t.setValue(this.host.session.isWarnOnUnsavedSwitchEnabled()).onChange(async (v) => {
                    await this.host.session.setWarnOnUnsavedSwitch(v);
                }),
            );

        // --- Highlight unsaved changes ---
        new Setting(containerEl)
            .setName(L.settingsHighlightUnsavedSessionChanges)
            .setDesc(L.settingsHighlightUnsavedSessionChangesDesc)
            .addToggle((t) =>
                t.setValue(this.host.session.isUnsavedStatusBarHighlightEnabled()).onChange(async (v) => {
                    await this.host.session.setUnsavedStatusBarHighlight(v);
                }),
            );

        // --- Restore sidebars ---
        new Setting(containerEl)
            .setName(L.settingsRestoreSidebars)
            .setDesc(L.settingsRestoreSidebarsDesc)
            .addToggle((t) =>
                t.setValue(this.host.session.isSidebarRestoreEnabled()).onChange(async (v) => {
                    await this.host.session.setRestoreSidebars(v);
                }),
            );

        // --- Numbered switch commands ---
        new Setting(containerEl)
            .setName(L.settingsNumberedSwitchCommands)
            .setDesc(L.settingsNumberedSwitchCommandsDesc)
            .addToggle((t) =>
                t.setValue(data.numberedSwitchCommands !== false).onChange(async (v) => {
                    await this.host.session.setNumberedSwitchCommands(v);
                }),
            );

        // --- Version history ---
        new Setting(containerEl)
            .setName(L.settingsVersionHistoryEnabled)
            .setDesc(L.settingsVersionHistoryEnabledDesc)
            .addToggle((t) =>
                t.setValue(this.host.session.isVersionHistoryEnabled()).onChange(async (v) => {
                    await this.host.session.setVersionHistoryEnabled(v);
                }),
            );

        // --- Language ---
        new Setting(containerEl).setName(L.settingsLanguage).addDropdown((d) => {
            d.addOption('auto', 'Auto');
            for (const lang of i18n.LANG_ORDER) d.addOption(lang, i18n.LANG_OPTIONS[lang]);
            d.setValue((data.language as string) || 'auto').onChange(async (v) => {
                await this.host.session.setLanguageSetting(v);
                this.host.updateStatusBar();
                this.display();
            });
        });
    }
}
