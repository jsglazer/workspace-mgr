import { App, Modal, Notice } from 'obsidian';
import * as i18n from '../i18n';

export interface RenameModalOptions {
    title?: string;
    placeholder?: string;
    buttonText?: string;
    skipButtonText?: string;
    emptyNotice?: string;
    onSkip?: () => void;
}

// Ported from the reference plugin's modals/rename-modal.js (wpp- -> wsmgr-).
export default class RenameModal extends Modal {
    private currentName: string;
    private onRename: (name: string) => void;
    private modalOptions: RenameModalOptions;
    private buttons: HTMLButtonElement[] = [];
    private focusedButtonIndex = -1;
    private renameKeyHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(app: App, currentName: string, onRename: (name: string) => void, options?: RenameModalOptions) {
        super(app);
        this.currentName = currentName;
        this.onRename = onRename;
        this.modalOptions = options || {};
    }

    onOpen(): void {
        const L = i18n.L;
        const contentEl = this.contentEl;
        const opts = this.modalOptions;
        this.titleEl.setText(opts.title || L.renameTitle);

        const input = contentEl.createEl('input', {
            type: 'text',
            value: this.currentName,
            placeholder: opts.placeholder || L.renamePlaceholder,
            cls: 'wsmgr-rename-input',
        });
        input.select();

        const btns = contentEl.createDiv({ cls: 'wsmgr-confirm-buttons' });
        const cancelBtn = btns.createEl('button', { text: L.cancel });
        cancelBtn.addEventListener('click', () => this.close());

        let skipBtn: HTMLButtonElement | null = null;
        if (opts.skipButtonText && opts.onSkip) {
            skipBtn = btns.createEl('button', { text: opts.skipButtonText });
            skipBtn.addEventListener('click', () => {
                opts.onSkip!();
                this.close();
            });
        }

        const renameBtn = btns.createEl('button', { text: opts.buttonText || L.rename, cls: 'mod-cta' });
        const doRename = (): void => {
            const newName = input.value.trim();
            if (!newName) {
                if (opts.onSkip) {
                    opts.onSkip();
                    this.close();
                    return;
                }
                if (opts.emptyNotice) new Notice(opts.emptyNotice);
                return;
            }
            if (newName === this.currentName) return;
            this.onRename(newName);
            this.close();
        };
        renameBtn.addEventListener('click', doRename);

        this.buttons = skipBtn ? [cancelBtn, skipBtn, renameBtn] : [cancelBtn, renameBtn];
        const lastBtnIdx = this.buttons.length - 1;
        this.focusedButtonIndex = -1;

        this.renameKeyHandler = (e: KeyboardEvent) => {
            if (e.isComposing) return;
            if (this.focusedButtonIndex === -1) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.focusedButtonIndex = lastBtnIdx;
                    this.updateRenameBtnFocus();
                    input.blur();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    doRename();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this.close();
                }
            } else {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.focusedButtonIndex = -1;
                    this.updateRenameBtnFocus();
                    input.focus();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    if (this.focusedButtonIndex > 0) {
                        this.focusedButtonIndex--;
                    } else {
                        this.focusedButtonIndex = -1;
                        this.updateRenameBtnFocus();
                        input.focus();
                        return;
                    }
                    this.updateRenameBtnFocus();
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    if (this.focusedButtonIndex < lastBtnIdx) {
                        this.focusedButtonIndex++;
                        this.updateRenameBtnFocus();
                    }
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    this.buttons[this.focusedButtonIndex].click();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this.close();
                }
            }
        };
        document.addEventListener('keydown', this.renameKeyHandler, true);
        setTimeout(() => input.focus(), 50);
    }

    private updateRenameBtnFocus(): void {
        this.buttons.forEach((btn, i) => btn.classList.toggle('wsmgr-btn-focused', i === this.focusedButtonIndex));
    }

    onClose(): void {
        if (this.renameKeyHandler) {
            document.removeEventListener('keydown', this.renameKeyHandler, true);
            this.renameKeyHandler = null;
        }
        this.contentEl.empty();
    }
}
