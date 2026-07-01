// Runtime stub for the (types-only) `obsidian` package so Vitest can resolve
// imports. Individual tests override specific members via vi.mock('obsidian').
export class Notice {
    constructor(_message?: string, _timeout?: number) {}
    hide(): void {}
    setMessage(): this {
        return this;
    }
}

export function setIcon(_el: unknown, _iconName?: string): void {}
export function setTooltip(): void {}

export class Modal {
    app: unknown;
    contentEl: unknown = {};
    containerEl: unknown = {};
    titleEl: unknown = {};
    constructor(app: unknown) {
        this.app = app;
    }
    open(): void {}
    close(): void {}
    onOpen(): void {}
    onClose(): void {}
}

export class Menu {
    addItem(): this {
        return this;
    }
    addSeparator(): this {
        return this;
    }
    showAtMouseEvent(): void {}
    showAtPosition(): void {}
}

export class Setting {
    constructor(_containerEl?: unknown) {}
}
export class PluginSettingTab {
    constructor(_app?: unknown, _plugin?: unknown) {}
}
export class Plugin {}
export class App {}
export const Platform = {};
