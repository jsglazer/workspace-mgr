// Front-matter integration: watches file-open events and reacts to the
// `workspace-session` property (switch session/group), plus saving the current
// note's name as a session. Ported from the reference plugin's
// plugin/methods/frontmatter.js into an injected controller.
import { Notice } from 'obsidian';
import * as i18n from './i18n';
import type { Session, SessionData } from './core/types';
import type { SaveResult } from './core/session-service';

interface FileLike {
    path?: string;
    basename?: string;
    name?: string;
    extension?: string;
}

interface FrontmatterApp {
    workspace: {
        on(name: string, cb: (file: FileLike | null) => void): unknown;
        getActiveFile?(): FileLike | null;
        activeLeaf?: { id?: string } | null;
        iterateAllLeaves?(cb: (leaf: { id?: string; view?: { file?: FileLike } }) => void): void;
    };
    metadataCache: { getFileCache(file: FileLike): { frontmatter?: Record<string, unknown> } | null };
    fileManager?: { processFrontMatter?(file: FileLike, mutate: (fm: Record<string, unknown>) => void): Promise<void> };
}

export class FrontmatterController {
    app!: FrontmatterApp;
    data!: SessionData;
    isSwitchingSession = false;
    frontmatterLoadedFilePathsByLeaf: Record<string, string> | null = null;

    // --- Collaborators (wired by the shell; stubbed by tests) ---
    registerEvent(_ref: unknown): void {}
    getStartupSettleRemainingMs(): number {
        return 0;
    }
    saveCurrentLayoutAsSessionName(_name: string, _options?: { silent?: boolean }): Promise<SaveResult> {
        return Promise.resolve({ saved: false, created: false, overwritten: false, sessionId: null, name: '' });
    }
    isGroupFeatureEnabled(): boolean {
        return true;
    }
    setActiveGroup(_groupId: string | null): Promise<boolean> {
        return Promise.resolve(false);
    }
    switchSession(_sessionId: string): Promise<boolean> {
        return Promise.resolve(false);
    }

    getFileFrontmatter(file: FileLike | null): Record<string, unknown> | null {
        if (!file) return null;
        const cache = this.app.metadataCache.getFileCache(file);
        return (cache && cache.frontmatter) || null;
    }

    isMarkdownNoteFile(file: FileLike | null | undefined): boolean {
        return !!file && String(file.extension || '').toLowerCase() === 'md';
    }

    getSessionNameFromNoteFile(file: FileLike | null | undefined): string {
        if (!this.isMarkdownNoteFile(file)) return '';
        const f = file as FileLike;
        if (typeof f.basename === 'string' && f.basename.trim()) return f.basename.trim();
        let name = typeof f.name === 'string' ? f.name : '';
        if (!name && typeof f.path === 'string') {
            const parts = f.path.split('/');
            name = parts[parts.length - 1] || '';
        }
        return name.replace(/\.md$/i, '').trim();
    }

    setWorkspaceSessionFrontmatter(file: FileLike, sessionName: string): Promise<void> {
        if (!this.app.fileManager || typeof this.app.fileManager.processFrontMatter !== 'function') {
            return Promise.reject(new Error('processFrontMatter unavailable'));
        }
        return this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            frontmatter['workspace-session'] = sessionName;
        });
    }

    saveCurrentNoteNameAsSession(options?: { silent?: boolean }): Promise<SaveResult | false> {
        const L = i18n.L;
        const opts = options || {};
        const file = this.app.workspace.getActiveFile ? this.app.workspace.getActiveFile() : null;
        const sessionName = this.getSessionNameFromNoteFile(file);
        if (!file || !sessionName) {
            if (!opts.silent) new Notice(L.noActiveMarkdownFile);
            return Promise.resolve(false);
        }
        return this.setWorkspaceSessionFrontmatter(file, sessionName)
            .then(() => this.saveCurrentLayoutAsSessionName(sessionName, { silent: true }))
            .then((result) => {
                if (!opts.silent) new Notice(L.savedCurrentNoteNameAsSession(sessionName));
                return result;
            })
            .catch(() => {
                if (!opts.silent) new Notice(L.saveCurrentNoteNameAsSessionFailed);
                return false;
            });
    }

    parseWorkspaceSessionValue(value: unknown): { groupName: string | null; groupId?: string; sessionName: string } | null {
        if (!value || typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        const slashIndex = trimmed.indexOf('/');
        if (slashIndex === -1) return { groupName: null, sessionName: trimmed };
        const candidateGroup = trimmed.substring(0, slashIndex).trim();
        const candidateSession = trimmed.substring(slashIndex + 1).trim();
        if (!candidateGroup || !candidateSession) return { groupName: null, sessionName: trimmed };
        const groups = this.data.groups || {};
        for (const key of Object.keys(groups)) {
            if (groups[key].name === candidateGroup) {
                return { groupName: candidateGroup, groupId: groups[key].id, sessionName: candidateSession };
            }
        }
        return { groupName: null, sessionName: trimmed };
    }

    findSessionByName(name: string): Session | null {
        if (!name) return null;
        const sessions = this.data.sessions || {};
        for (const key of Object.keys(sessions)) {
            if (sessions[key].name === name) return sessions[key];
        }
        return null;
    }

    handleWorkspaceSessionProperty(value: unknown): void {
        const L = i18n.L;
        const parsed = this.parseWorkspaceSessionValue(value);
        if (!parsed) return;
        const session = this.findSessionByName(parsed.sessionName);
        if (!session) {
            new Notice(L.frontmatterSessionNotFound(parsed.sessionName));
            return;
        }
        const alreadyOnSession = session.id === this.data.activeSessionId;
        const alreadyOnGroup = !parsed.groupId || this.data.activeGroupId === parsed.groupId;
        if (alreadyOnSession && alreadyOnGroup) {
            new Notice(L.frontmatterAlreadyActive(parsed.sessionName));
            return;
        }
        if (parsed.groupId && this.isGroupFeatureEnabled() && !alreadyOnGroup) {
            void this.setActiveGroup(parsed.groupId).then(() => {
                if (session.id !== this.data.activeSessionId) void this.switchSession(session.id);
            });
        } else if (!alreadyOnSession) {
            void this.switchSession(session.id);
        }
    }

    handleFrontmatterTriggers(file: FileLike | null): void {
        const fm = this.getFileFrontmatter(file);
        if (!fm) return;
        if (fm['workspace-session']) this.handleWorkspaceSessionProperty(fm['workspace-session']);
    }

    getFrontmatterTriggerLeafId(): string {
        const activeLeaf = this.app.workspace.activeLeaf || null;
        return activeLeaf && activeLeaf.id ? activeLeaf.id : 'active';
    }

    markCurrentFrontmatterFilesLoaded(): void {
        const loadedByLeaf: Record<string, string> = {};
        if (typeof this.app.workspace.iterateAllLeaves === 'function') {
            this.app.workspace.iterateAllLeaves((leaf) => {
                const file = leaf && leaf.view && leaf.view.file;
                if (!leaf || !leaf.id || !file || !file.path) return;
                loadedByLeaf[leaf.id] = file.path;
            });
        }
        this.frontmatterLoadedFilePathsByLeaf = loadedByLeaf;
    }

    clearFrontmatterFileForActiveLeaf(): void {
        if (!this.frontmatterLoadedFilePathsByLeaf) return;
        delete this.frontmatterLoadedFilePathsByLeaf[this.getFrontmatterTriggerLeafId()];
    }

    shouldHandleFrontmatterFileOpen(file: FileLike | null): boolean {
        const filePath = file && file.path ? file.path : '';
        if (!filePath) return false;
        const leafId = this.getFrontmatterTriggerLeafId();
        if (!this.frontmatterLoadedFilePathsByLeaf) this.frontmatterLoadedFilePathsByLeaf = {};
        if (this.frontmatterLoadedFilePathsByLeaf[leafId] === filePath) return false;
        this.frontmatterLoadedFilePathsByLeaf[leafId] = filePath;
        return true;
    }

    registerFrontmatterListeners(): void {
        this.markCurrentFrontmatterFilesLoaded();
        this.registerEvent(
            this.app.workspace.on('file-open', (file: FileLike | null) => {
                if (this.isSwitchingSession) return;
                if (this.getStartupSettleRemainingMs() > 0) return;
                if (!file) {
                    this.clearFrontmatterFileForActiveLeaf();
                    return;
                }
                if (!this.shouldHandleFrontmatterFileOpen(file)) return;
                this.handleFrontmatterTriggers(file);
            }),
        );
    }
}
