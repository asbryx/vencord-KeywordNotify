import assert from "node:assert/strict";
import test from "node:test";

import { restoreBrowserWindow, type RestorableBrowserWindow } from "./window";

function makeWindow(state: { destroyed?: boolean; minimized?: boolean; visible?: boolean; } = {}) {
    const calls: string[] = [];
    const window: RestorableBrowserWindow = {
        isDestroyed: () => state.destroyed ?? false,
        isMinimized: () => state.minimized ?? false,
        isVisible: () => state.visible ?? true,
        restore: () => calls.push("restore"),
        show: () => calls.push("show"),
        focus: () => calls.push("focus")
    };
    return { window, calls };
}

test("restores, shows, and focuses a minimized hidden Discord window", () => {
    const { window, calls } = makeWindow({ minimized: true, visible: false });
    assert.equal(restoreBrowserWindow(window), true);
    assert.deepEqual(calls, ["restore", "show", "focus"]);
});

test("only focuses an already visible Discord window", () => {
    const { window, calls } = makeWindow();
    assert.equal(restoreBrowserWindow(window), true);
    assert.deepEqual(calls, ["focus"]);
});

test("ignores a destroyed Discord window", () => {
    const { window, calls } = makeWindow({ destroyed: true });
    assert.equal(restoreBrowserWindow(window), false);
    assert.deepEqual(calls, []);
});
