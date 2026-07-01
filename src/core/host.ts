// Minimal structural interfaces for the Obsidian runtime objects the core
// touches. The core never imports `obsidian`; the shell injects the real `App`
// (which satisfies these shapes) and tests inject fakes.
import type { Layout } from './types';

export interface LeafLike {
    detach(): void;
}

export interface WorkspaceLike {
    getLayout?(): Layout;
    changeLayout(layout: unknown): unknown;
    iterateRootLeaves?(callback: (leaf: LeafLike) => void): void;
    [key: string]: unknown;
}

export interface FsAdapterLike {
    exists(path: string): Promise<boolean>;
    read?(path: string): Promise<string>;
    write?(path: string, data: string): Promise<void>;
    remove(path: string): Promise<void>;
    stat?(path: string): Promise<{ mtime: number } | null>;
    mkdir?(path: string): Promise<void>;
    list?(path: string): Promise<{ files: string[]; folders: string[] }>;
    [key: string]: unknown;
}

export interface VaultLike {
    adapter: FsAdapterLike;
    [key: string]: unknown;
}

export interface AppLike {
    workspace: WorkspaceLike;
    vault?: VaultLike;
    [key: string]: unknown;
}

export interface CommandLike {
    id: string;
    name: string;
    checkCallback?: (checking: boolean) => boolean | void;
    callback?: () => void;
}

/** Options passed to the injected name-prompt used by save flows. */
export interface NamePromptOptions {
    title?: string;
    placeholder?: string;
    buttonText?: string;
    skipButtonText?: string;
    emptyNotice?: string;
    onSubmit: (name: string) => void;
    onSkip?: () => void;
}
