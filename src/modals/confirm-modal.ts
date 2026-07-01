import { App, Modal } from 'obsidian';
import * as i18n from '../i18n';

export interface ConfirmModalOptions {
    confirmText?: string;
    confirmClass?: string;
    hint?: string;
    onHintClick?: () => void;
}

// Ported from the reference plugin's modals/confirm-modal.js (wpp- -> wsmgr-).
export default class ConfirmModal extends Modal {
    private message: string;
    private onConfirm: () => void;
    private options: ConfirmModalOptions;
    private buttons: HTMLButtonElement[] = [];
    private focusedButtonIndex = 1;
    private confirmKeyHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(app: App, message: string, onConfirm: () => void, options?: ConfirmModalOptions) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
        this.options = options || {};
    }

    onOpen(): void {
        const L = i18n.L;
        this.containerEl.style.zIndex = '10001';
        const contentEl = this.contentEl;
        contentEl.createEl('p', { text: this.message });
        const btns = contentEl.createDiv({ cls: 'wsmgr-confirm-buttons' });

        const cancelBtn = btns.createEl('button', { text: L.cancel });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmText = this.options.confirmText || L.delete;
        const confirmClass = this.options.confirmClass || 'mod-warning';
        const confirmBtn = btns.createEl('button', { text: confirmText, cls: confirmClass });
        confirmBtn.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });

        if (this.options.hint) {
            const hintEl = contentEl.createDiv({ cls: 'wsmgr-confirm-hint' });
            const hintLink = hintEl.createEl('a', { text: this.options.hint });
            hintLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.close();
                if (this.options.onHintClick) this.options.onHintClick();
            });
        }

        this.buttons = [cancelBtn, confirmBtn];
        this.focusedButtonIndex = 1;
        this.updateButtonFocus();

        this.confirmKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.focusedButtonIndex = 0;
                this.updateButtonFocus();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                this.focusedButtonIndex = 1;
                this.updateButtonFocus();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.focusedButtonIndex === 0) this.close();
                else {
                    this.onConfirm();
                    this.close();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.close();
            }
        };
        document.addEventListener('keydown', this.confirmKeyHandler, true);
    }

    private updateButtonFocus(): void {
        this.buttons.forEach((btn, i) => btn.classList.toggle('wsmgr-btn-focused', i === this.focusedButtonIndex));
    }

    onClose(): void {
        if (this.confirmKeyHandler) {
            document.removeEventListener('keydown', this.confirmKeyHandler, true);
            this.confirmKeyHandler = null;
        }
        this.contentEl.empty();
    }
}
