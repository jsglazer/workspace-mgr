// Pure data types shared across the core (no `obsidian` imports). A workspace
// layout is an opaque serialized object produced by Obsidian's layout APIs; the
// core only ever clones/compares it, never interprets its internals.
import type { RibbonLock } from './ribbon-lock';

export type Layout = Record<string, unknown>;

export interface HistoryEntry {
    savedAt: number;
    layout: Layout;
}

/**
 * The main window's bounds, pinned to a workspace. x/y/width/height are the
 * window's normal (un-maximized) bounds; the flags record whether it was
 * maximized or full screen when pinned.
 */
export interface WindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized?: boolean;
    fullScreen?: boolean;
}

export interface Session {
    id: string;
    name: string;
    layout?: Layout;
    modified?: number;
    isDefault?: boolean;
    history?: HistoryEntry[];
    /** Set only by "Pin window size"; a normal save never touches it. */
    windowBounds?: WindowBounds;
}

export interface Group {
    id: string;
    name: string;
}

/**
 * The persisted plugin state. Mirrors the reference plugin's `plugin.data`
 * shape. Session contents live in individual files; this in-memory object is
 * the assembled view the UI and services operate on.
 */
export interface SessionData {
    activeSessionId: string | null;
    sessions: Record<string, Session>;
    sessionOrder: string[];
    sessionGroups: Record<string, string[]>;
    groups: Record<string, Group>;
    groupOrder: string[];
    /** When the user last reordered sessions; decides whose order wins a Sync merge. */
    sessionOrderModified?: number;
    /** When the user last reordered groups; decides whose order wins a Sync merge. */
    groupOrderModified?: number;
    activeGroupId: string | null;
    /** Deleted session id -> deletion time; synced so deletes reach every device. */
    deletedSessions?: Record<string, number>;

    autoSaveOnSwitch: boolean;
    warnOnUnsavedSwitch: boolean;
    highlightUnsavedSessionChanges: boolean;
    restoreSidebars: boolean;
    groupFeatureEnabled: boolean;
    macMenuBarEnabled: boolean;
    /** macOS menu-bar text colour (light theme); empty means the native system colour. */
    menuBarNameColorLight: string;
    /** macOS menu-bar text colour (dark theme); empty means the native system colour. */
    menuBarNameColorDark: string;
    ribbonSyncToFutureSessions: boolean;
    syncedRibbonHiddenItems: Record<string, boolean> | null;
    /** The pinned left ribbon; synced with the sessions, later `modified` wins. */
    ribbonLock?: RibbonLock | null;
    /** Whether ribbon items missing from the lock are added hidden or shown. */
    ribbonLockUnknownItems: 'hidden' | 'shown';
    /** Unknown ribbon item ids already announced in a Notice. */
    ribbonLockAnnouncedIds: string[];
    /** What a pinned window size restores on switch. */
    windowRestoreMode: 'size' | 'size-location';

    previewNext: boolean;
    previewPrevious: boolean;

    numberedSwitchCommands: boolean;
    showActiveSwitchCommand: boolean;

    versionHistoryEnabled: boolean;
    versionHistorySnapshotInterval: number;

    statusBarActions: Record<string, string> | null;

    // Free-form settings (status-bar scroll config, colours, etc.). Kept open so
    // the settings surface can grow without widening this interface everywhere.
    [key: string]: unknown;
}

export interface RestoreOptions {
    restoreScope?: 'main-only' | 'full';
}
