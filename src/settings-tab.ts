// Settings tab. Exposes the status-bar session-name and unsaved-highlight
// colour pickers (each applied via a CSS custom property on the document
// root — no dynamic <style> injection) plus the core session/history
// toggles. A focused subset of the reference plugin's large settings surface.
import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import * as i18n from './i18n';
import { STATUS_NAME_COLOR_FALLBACK, UNSAVED_COLOR_FALLBACK } from './core/css';
import type { SessionData } from './core/types';
import type { SessionService } from './core/session-service';
import CustomizeClicksModal from './modals/customize-clicks-modal';
import RenameModal from './modals/rename-modal';
import ConfirmModal from './modals/confirm-modal';

export interface SettingsHost {
    app: App;
    data: SessionData;
    session: SessionService;
    /** Apply the current status-name colour to the document-root custom property. */
    applyStatusNameColor(): void;
    /** Apply the current unsaved-highlight colour to the document-root custom property. */
    applyUnsavedHighlightColor(): void;
    updateStatusBar(): void;
    updateMacMenuBar(): void;
    setStatusBarAction(slotKey: string, actionId: string): Promise<unknown>;
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

        // --- Core-plugin requirement notice ---
        containerEl.createEl('div', {
            cls: 'wsmgr-settings-notice',
            text: 'The core Obsidian "Workspace" plugin must be enabled for Workspace Manager to work.',
        });

        // --- Status-bar session-name colour ---
        new Setting(containerEl)
            .setName('Status bar session name colour (light theme)')
            .setDesc('Colour of the session name shown in the status bar when using a light theme.')
            .addColorPicker((cp) => {
                const current = (data.statusBarNameColorLight as string) || '';
                if (current) cp.setValue(current);
                cp.onChange(async (value) => {
                    await this.host.session.setStatusBarNameColorLight(value);
                    this.host.applyStatusNameColor();
                });
            })
            .addExtraButton((b) =>
                b
                    .setIcon('rotate-ccw')
                    .setTooltip('Reset to theme default (' + STATUS_NAME_COLOR_FALLBACK + ')')
                    .onClick(async () => {
                        await this.host.session.setStatusBarNameColorLight('');
                        this.host.applyStatusNameColor();
                        this.display();
                    }),
            );

        new Setting(containerEl)
            .setName('Status bar session name colour (dark theme)')
            .setDesc('Colour of the session name shown in the status bar when using a dark theme.')
            .addColorPicker((cp) => {
                const current = (data.statusBarNameColorDark as string) || '';
                if (current) cp.setValue(current);
                cp.onChange(async (value) => {
                    await this.host.session.setStatusBarNameColorDark(value);
                    this.host.applyStatusNameColor();
                });
            })
            .addExtraButton((b) =>
                b
                    .setIcon('rotate-ccw')
                    .setTooltip('Reset to theme default (' + STATUS_NAME_COLOR_FALLBACK + ')')
                    .onClick(async () => {
                        await this.host.session.setStatusBarNameColorDark('');
                        this.host.applyStatusNameColor();
                        this.display();
                    }),
            );

        // --- Status-bar click actions ---
        new Setting(containerEl)
            .setName(L.contextCustomizeClicks)
            .setDesc('Choose what happens when you click, ⌘-click, or ⌥-click the session name in the status bar.')
            .addButton((b) =>
                b.setButtonText(L.contextCustomizeClicks).onClick(() => {
                    new CustomizeClicksModal(this.host.app, this.host).open();
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

        new Setting(containerEl)
            .setName('Unsaved highlight colour (light theme)')
            .setDesc('Colour of the status bar when there are unsaved changes, using a light theme.')
            .addColorPicker((cp) => {
                const current = (data.unsavedHighlightColorLight as string) || '';
                if (current) cp.setValue(current);
                cp.onChange(async (value) => {
                    await this.host.session.setUnsavedHighlightColorLight(value);
                    this.host.applyUnsavedHighlightColor();
                });
            })
            .addExtraButton((b) =>
                b
                    .setIcon('rotate-ccw')
                    .setTooltip('Reset to theme default (' + UNSAVED_COLOR_FALLBACK + ')')
                    .onClick(async () => {
                        await this.host.session.setUnsavedHighlightColorLight('');
                        this.host.applyUnsavedHighlightColor();
                        this.display();
                    }),
            );

        new Setting(containerEl)
            .setName('Unsaved highlight colour (dark theme)')
            .setDesc('Colour of the status bar when there are unsaved changes, using a dark theme.')
            .addColorPicker((cp) => {
                const current = (data.unsavedHighlightColorDark as string) || '';
                if (current) cp.setValue(current);
                cp.onChange(async (value) => {
                    await this.host.session.setUnsavedHighlightColorDark(value);
                    this.host.applyUnsavedHighlightColor();
                });
            })
            .addExtraButton((b) =>
                b
                    .setIcon('rotate-ccw')
                    .setTooltip('Reset to theme default (' + UNSAVED_COLOR_FALLBACK + ')')
                    .onClick(async () => {
                        await this.host.session.setUnsavedHighlightColorDark('');
                        this.host.applyUnsavedHighlightColor();
                        this.display();
                    }),
            );

        // --- Session groups ---
        new Setting(containerEl).setName(L.settingsSectionGroups).setHeading();
        new Setting(containerEl)
            .setName(L.contextToggleGroups)
            .setDesc(L.settingsSectionGroupsDesc)
            .addToggle((t) =>
                t.setValue(this.host.session.isGroupFeatureEnabled()).onChange(async (v) => {
                    await this.host.session.setGroupFeatureEnabled(v);
                    this.display();
                }),
            );

        if (this.host.session.isGroupFeatureEnabled()) {
            let newGroupInputEl: HTMLInputElement | null = null;
            const createGroupFromInput = async (): Promise<void> => {
                const name = newGroupInputEl ? newGroupInputEl.value : '';
                const created = await this.host.session.createGroupValidated(name);
                if (created) this.display();
            };
            new Setting(containerEl)
                .setName(L.settingsGroupCreate)
                .setDesc(L.settingsGroupCreateDesc)
                .addText((t) => {
                    t.setPlaceholder(L.settingsGroupCreatePlaceholder);
                    newGroupInputEl = t.inputEl;
                    t.inputEl.addEventListener('keydown', (e) => {
                        if (e.key !== 'Enter') return;
                        void createGroupFromInput();
                    });
                })
                .addButton((b) => b.setButtonText(L.settingsGroupCreateBtn).onClick(() => void createGroupFromInput()));

            for (const group of this.host.session.getOrderedGroups()) {
                new Setting(containerEl)
                    .setName(group.name)
                    .addExtraButton((b) =>
                        b.setIcon('pencil').setTooltip(L.groupContextRename).onClick(() => {
                            new RenameModal(
                                this.host.app,
                                group.name,
                                async (newName) => {
                                    await this.host.session.renameGroupValidated(group.id, newName);
                                    this.display();
                                },
                                { title: L.groupContextRename, placeholder: L.groupCreatePlaceholder, buttonText: L.save, emptyNotice: L.groupEmptyName },
                            ).open();
                        }),
                    )
                    .addExtraButton((b) =>
                        b.setIcon('copy').setTooltip(L.groupContextDuplicate).onClick(async () => {
                            await this.host.session.duplicateGroup(group.id);
                            this.display();
                        }),
                    )
                    .addExtraButton((b) =>
                        b.setIcon('trash').setTooltip(L.groupContextDelete).onClick(() => {
                            new ConfirmModal(this.host.app, L.confirmDeleteGroup(group.name), async () => {
                                await this.host.session.deleteGroup(group.id);
                                this.display();
                            }).open();
                        }),
                    );
            }
        }

        // --- Ribbon sync ---
        new Setting(containerEl).setName('Ribbon').setHeading();
        {
            const allSessions = this.host.session.getOrderedSessionsUnfiltered();
            let ribbonSourceId = allSessions.some((s) => s.id === data.activeSessionId)
                ? (data.activeSessionId as string)
                : allSessions[0]?.id || '';
            new Setting(containerEl)
                .setName('Sync left ribbon')
                .setDesc(
                    "Replicate the selected workspace's left-ribbon icon visibility to every other workspace. " +
                        "Obsidian doesn't store icon order, so only which icons are shown or hidden is synced.",
                )
                .addDropdown((d) => {
                    for (const s of allSessions) d.addOption(s.id, s.name);
                    if (ribbonSourceId) d.setValue(ribbonSourceId);
                    d.onChange((v) => {
                        ribbonSourceId = v;
                    });
                })
                .addButton((b) =>
                    b
                        .setButtonText('Sync now')
                        .setCta()
                        .onClick(async () => {
                            if (!ribbonSourceId) return;
                            const ok = await this.host.session.syncRibbonFromSession(ribbonSourceId);
                            new Notice(
                                ok
                                    ? 'Ribbon layout synced to all workspaces.'
                                    : 'That workspace has no saved ribbon layout yet — switch to it once, then try again.',
                            );
                        }),
                );

            new Setting(containerEl)
                .setName('Also sync new workspaces automatically')
                .setDesc('Apply the same ribbon visibility whenever a new workspace is created.')
                .addToggle((t) =>
                    t.setValue(!!data.ribbonSyncToFutureSessions).onChange(async (v) => {
                        await this.host.session.setRibbonSyncToFutureSessions(v);
                    }),
                );
        }

        // --- macOS menu bar ---
        new Setting(containerEl)
            .setName(L.settingsMenuBarEnabled)
            .setDesc(L.settingsMenuBarEnabledDesc)
            .addToggle((t) =>
                t.setValue(!!data.macMenuBarEnabled).onChange(async (v) => {
                    await this.host.session.setMacMenuBarEnabled(v);
                    this.host.updateMacMenuBar();
                    this.display();
                }),
            );

        if (data.macMenuBarEnabled) {
            new Setting(containerEl)
                .setName('Menu bar text colour (light theme)')
                .setDesc(
                    'Colour of the vault/workspace text in the macOS menu bar under a light theme. ' +
                        'Leave unset to use the native system colour, which adapts to your wallpaper automatically.',
                )
                .addColorPicker((cp) => {
                    const current = (data.menuBarNameColorLight as string) || '';
                    if (current) cp.setValue(current);
                    cp.onChange(async (value) => {
                        await this.host.session.setMenuBarNameColorLight(value);
                        this.host.updateMacMenuBar();
                    });
                })
                .addExtraButton((b) =>
                    b
                        .setIcon('rotate-ccw')
                        .setTooltip('Reset to the native system colour')
                        .onClick(async () => {
                            await this.host.session.setMenuBarNameColorLight('');
                            this.host.updateMacMenuBar();
                            this.display();
                        }),
                );

            new Setting(containerEl)
                .setName('Menu bar text colour (dark theme)')
                .setDesc(
                    'Colour of the vault/workspace text in the macOS menu bar under a dark theme. ' +
                        'Leave unset to use the native system colour, which adapts to your wallpaper automatically.',
                )
                .addColorPicker((cp) => {
                    const current = (data.menuBarNameColorDark as string) || '';
                    if (current) cp.setValue(current);
                    cp.onChange(async (value) => {
                        await this.host.session.setMenuBarNameColorDark(value);
                        this.host.updateMacMenuBar();
                    });
                })
                .addExtraButton((b) =>
                    b
                        .setIcon('rotate-ccw')
                        .setTooltip('Reset to the native system colour')
                        .onClick(async () => {
                            await this.host.session.setMenuBarNameColorDark('');
                            this.host.updateMacMenuBar();
                            this.display();
                        }),
                );
        }

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
