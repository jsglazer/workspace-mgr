import { App, Modal } from 'obsidian';
import * as i18n from '../i18n';

// Ported from the reference plugin's modals/unsaved-switch-modal.js (wpp- -> wsmgr-).
export default class UnsavedSwitchModal extends Modal {
    private message: string;
    private onSaveAndSwitch: () => void;
    private onSwitchWithoutSaving: () => void;
    private onCancel: () => void;
    private didResolve = false;
    private buttons: HTMLButtonElement[] = [];
    private focusedButtonIndex = 1;
    private keyHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(
        app: App,
        message: string,
        onSaveAndSwitch: () => void,
        onSwitchWithoutSaving: () => void,
        onCancel?: () => void,
    ) {
        super(app);
        this.message = message;
        this.onSaveAndSwitch = onSaveAndSwitch;
        this.onSwitchWithoutSaving = onSwitchWithoutSaving;
        this.onCancel = onCancel || (() => {});
    }

    onOpen(): void {
        const L = i18n.L;
        this.containerEl.style.zIndex = '10001';
        const contentEl = this.contentEl;
        contentEl.createEl('p', { text: this.message });
        const btns = contentEl.createDiv({ cls: 'wsmgr-confirm-buttons' });

        const finish = (callback?: () => void): void => {
            if (this.didResolve) return;
            this.didResolve = true;
            if (callback) callback();
        };

        const cancelBtn = btns.createEl('button', { text: L.cancel });
        cancelBtn.addEventListener('click', () => {
            finish(this.onCancel);
            this.close();
        });
        const saveAndSwitchBtn = btns.createEl('button', { text: L.saveAndSwitch, cls: 'mod-cta' });
        saveAndSwitchBtn.addEventListener('click', () => {
            finish(this.onSaveAndSwitch);
            this.close();
        });
        const switchWithoutSavingBtn = btns.createEl('button', { text: L.switchWithoutSaving, cls: 'mod-warning' });
        switchWithoutSavingBtn.addEventListener('click', () => {
            finish(this.onSwitchWithoutSaving);
            this.close();
        });

        this.buttons = [cancelBtn, saveAndSwitchBtn, switchWithoutSavingBtn];
        this.focusedButtonIndex = 1;
        this.updateButtonFocus();

        this.keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.focusedButtonIndex = (this.focusedButtonIndex - 1 + this.buttons.length) % this.buttons.length;
                this.updateButtonFocus();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                this.focusedButtonIndex = (this.focusedButtonIndex + 1) % this.buttons.length;
                this.updateButtonFocus();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const btn = this.buttons[this.focusedButtonIndex];
                if (btn) btn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                finish(this.onCancel);
                this.close();
            }
        };
        document.addEventListener('keydown', this.keyHandler, true);
    }

    private updateButtonFocus(): void {
        this.buttons.forEach((btn, i) => btn.classList.toggle('wsmgr-btn-focused', i === this.focusedButtonIndex));
    }

    onClose(): void {
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler, true);
            this.keyHandler = null;
        }
        if (!this.didResolve) {
            this.didResolve = true;
            this.onCancel();
        }
        this.contentEl.empty();
    }
}
