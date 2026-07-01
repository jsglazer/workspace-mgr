// Default persisted plugin state, ported from the reference plugin's
// src/plugin/default-data.js. Pure data, no imports.
import type { SessionData } from './types';

export const DEFAULT_DATA: SessionData = {
    activeSessionId: null,
    sessions: {},
    sessionOrder: [],
    language: 'auto',
    previewNext: true,
    previewPrevious: true,
    confirmDeleteByHotkey: true,
    confirmQuickActions: false,
    autoSaveOnSwitch: false,
    warnOnUnsavedSwitch: true,
    highlightUnsavedSessionChanges: true,
    restoreSidebars: true,
    statusBarQuickSwitcher: true,
    groupFeatureEnabled: true,
    showFilterInput: false,
    overlayDefaultFocus: 'current-session',
    showActiveSwitchCommand: false,
    numberedSwitchCommands: true,
    searchOverlayPosition: null,
    searchOverlaySize: null,
    groups: {},
    groupOrder: [],
    sessionGroups: {},
    activeGroupId: null,
    versionHistoryEnabled: true,
    versionHistorySnapshotInterval: 5,
    versionHistoryCtrlRmbRestore: true,
    versionHistoryConfirmRestore: true,
    statusBarModScrollSwitch: false,
    statusBarScrollPreset: 'trackpad',
    statusBarScrollModifierMode: 'none',
    statusBarScrollThreshold: 30,
    statusBarScrollCooldownMs: 500,
    statusBarScrollResetMs: 250,
    statusBarScrollInvert: false,
    // Status-bar session-name colour (drives the --wsmgr-status-name-color CSS
    // custom property), one value per Obsidian theme mode. Empty means "use the
    // theme default".
    statusBarNameColorLight: '',
    statusBarNameColorDark: '',
    // Unsaved-changes status-bar highlight colour (drives the
    // --wsmgr-unsaved-color CSS custom property; the highlight background is a
    // computed tint of this colour). Empty means "use the theme default".
    unsavedHighlightColorLight: '',
    unsavedHighlightColorDark: '',
    statusBarActions: {
        click: 'sessionManager',
        altClick: 'reloadWithoutSaving',
        modClick: 'saveSession',
        shiftClick: 'none',
        middleClick: 'none',
        altMiddleClick: 'none',
        modMiddleClick: 'reloadWithoutSaving',
        shiftMiddleClick: 'none',
        rightClick: 'sessionMenu',
        altRightClick: 'none',
        modRightClick: 'restoreLatestHistory',
        shiftRightClick: 'none',
    },
};
