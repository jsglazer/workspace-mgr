import { App, Modal } from 'obsidian';
import * as i18n from '../i18n';
import formatRelativeTime from './format-relative-time';
import type { Session } from '../core/types';

interface HistoryPlugin {
    restoreFromHistoryEntry(sessionId: string, entryIndex: number): Promise<boolean>;
    countPanesInLayout(layout: unknown): number;
}

/**
 * Version-history browser for a session. Lists snapshot entries newest-first and
 * restores the selected one. Functionally equivalent to the reference plugin's
 * modals/history-modal.js (visual surface; class prefix wpp- -> wsmgr-).
 */
export default class HistoryModal extends Modal {
    private plugin: HistoryPlugin;
    private session: Session;

    constructor(app: App, plugin: HistoryPlugin, session: Session) {
        super(app);
        this.plugin = plugin;
        this.session = session;
    }

    onOpen(): void {
        const L = i18n.L;
        const contentEl = this.contentEl;
        this.titleEl.setText(L.historyTitle);
        const list = contentEl.createDiv({ cls: 'wsmgr-history-list' });
        const history = this.session.history || [];

        if (history.length === 0) {
            list.createEl('p', { text: L.historyNoEntries });
            return;
        }

        history.forEach((entry, index) => {
            const row = list.createDiv({ cls: 'wsmgr-history-entry' });
            row.createSpan({
                cls: 'wsmgr-history-time',
                text: formatRelativeTime(entry.savedAt),
            });
            row.createSpan({
                cls: 'wsmgr-history-panes',
                text: L.historyPanes(this.plugin.countPanesInLayout(entry.layout)),
            });
            const restoreBtn = row.createEl('button', { text: L.historyRestore, cls: 'mod-cta' });
            restoreBtn.addEventListener('click', () => {
                void this.plugin.restoreFromHistoryEntry(this.session.id, index).then((ok) => {
                    if (ok) this.close();
                });
            });
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
