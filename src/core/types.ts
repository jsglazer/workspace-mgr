// Pure data types shared across the core (no `obsidian` imports). A workspace
// layout is an opaque serialized object produced by Obsidian's layout APIs; the
// core only ever clones/compares it, never interprets its internals.

export type Layout = Record<string, unknown>;

export interface HistoryEntry {
    savedAt: number;
    layout: Layout;
}

export interface Session {
    id: string;
    name: string;
    layout?: Layout;
    modified?: number;
    isDefault?: boolean;
    history?: HistoryEntry[];
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
    activeGroupId: string | null;

    autoSaveOnSwitch: boolean;
    warnOnUnsavedSwitch: boolean;
    highlightUnsavedSessionChanges: boolean;
    restoreSidebars: boolean;
    groupFeatureEnabled: boolean;

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
