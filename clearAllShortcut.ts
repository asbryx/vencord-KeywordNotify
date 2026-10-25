export const CLEAR_ALL_DOUBLE_TAP_MS = 400;

export interface ClearAllKeyEvent {
    key: string;
    code?: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    repeat?: boolean;
    defaultPrevented?: boolean;
    target?: unknown;
}

export type ClearAllShortcutAction = "clear" | "arm" | "none";

export interface ClearAllShortcutResult {
    action: ClearAllShortcutAction;
    lastEscapeAt: number;
}

function isTypingTarget(target: unknown) {
    if (!target || typeof target !== "object") return false;
    const element = target as {
        tagName?: unknown;
        isContentEditable?: unknown;
        getAttribute?: (name: string) => string | null;
    };
    const tagName = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return true;
    if (element.isContentEditable === true) return true;
    return typeof element.getAttribute === "function" && element.getAttribute("role") === "textbox";
}

export function isClearAllShortcut(event: ClearAllKeyEvent) {
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return false;
    return event.key.toLowerCase() === "x" || event.code === "KeyX";
}

export function resolveClearAllShortcut(
    event: ClearAllKeyEvent,
    lastEscapeAt: number,
    now: number
): ClearAllShortcutResult {
    if (event.defaultPrevented || event.repeat) return { action: "none", lastEscapeAt };

    if (isClearAllShortcut(event)) return { action: "clear", lastEscapeAt: 0 };

    if (event.key !== "Escape" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return { action: "none", lastEscapeAt };
    }

    if (isTypingTarget(event.target)) return { action: "none", lastEscapeAt: 0 };

    if (lastEscapeAt !== 0 && now - lastEscapeAt <= CLEAR_ALL_DOUBLE_TAP_MS) {
        return { action: "clear", lastEscapeAt: 0 };
    }

    return { action: "arm", lastEscapeAt: now };
}
