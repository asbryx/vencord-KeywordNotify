export interface RestorableBrowserWindow {
    isDestroyed(): boolean;
    isMinimized(): boolean;
    isVisible(): boolean;
    restore(): void;
    show(): void;
    focus(): void;
}

export function restoreBrowserWindow(window: RestorableBrowserWindow | null) {
    if (!window || window.isDestroyed()) return false;

    if (window.isMinimized()) window.restore();
    if (!window.isVisible()) window.show();
    window.focus();
    return true;
}
