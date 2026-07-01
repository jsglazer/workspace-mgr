// Thin adapter isolating every use of Obsidian's workspace layout
// serialization/deserialization. The audit (New-1-Concept §2) flags these as a
// "brittle surface": app.workspace.getLayout() / changeLayout() are behaviorally
// unstable and device-specific across desktop/mobile, even though they appear in
// the public type definitions. Confining them here means a future API break is a
// one-file fix; core logic never calls them directly.
//
// Targeted Obsidian API: minAppVersion 1.11.0 (manifest), verified against the
// installed build 1.12.7 — getLayout(): Record<string, unknown> and
// changeLayout(workspace): Promise<void> are present and stable across that range.
import type { App } from 'obsidian';
import type { Layout } from '../core/types';

/** The Obsidian workspace-layout API surface this plugin depends on. */
export interface LayoutAdapter {
    /** Serialize the current workspace layout. */
    getLayout(): Layout;
    /** Restore a previously serialized workspace layout. */
    changeLayout(layout: Layout): Promise<void>;
}

export function createLayoutAdapter(app: App): LayoutAdapter {
    const workspace = app.workspace;
    return {
        getLayout(): Layout {
            return workspace.getLayout() as Layout;
        },
        changeLayout(layout: Layout): Promise<void> {
            return workspace.changeLayout(layout);
        },
    };
}
