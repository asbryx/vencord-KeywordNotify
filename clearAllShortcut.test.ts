import assert from "node:assert/strict";
import test from "node:test";

import { CLEAR_ALL_DOUBLE_TAP_MS, isClearAllShortcut, resolveClearAllShortcut } from "./clearAllShortcut";

const chatInput = { tagName: "TEXTAREA" };
const editableDiv = { tagName: "DIV", isContentEditable: true, getAttribute: () => null };
const textbox = { tagName: "DIV", getAttribute: (name: string) => name === "role" ? "textbox" : null };
const messageText = { tagName: "SPAN" };

test("ctrl+shift+x clears immediately and resets the escape timer", () => {
    assert.deepEqual(
        resolveClearAllShortcut({ key: "x", ctrlKey: true, shiftKey: true, target: messageText }, 1_000, 2_000),
        { action: "clear", lastEscapeAt: 0 }
    );
    assert.equal(isClearAllShortcut({ key: "X", ctrlKey: true, shiftKey: true }), true);
    assert.equal(isClearAllShortcut({ key: "x", ctrlKey: true }), false);
    assert.equal(isClearAllShortcut({ key: "x", ctrlKey: true, shiftKey: true, altKey: true }), false);
});

test("ctrl+shift+x is ignored while a key is repeating or already handled", () => {
    assert.deepEqual(
        resolveClearAllShortcut({ key: "x", ctrlKey: true, shiftKey: true, repeat: true }, 0, 10),
        { action: "none", lastEscapeAt: 0 }
    );
    assert.deepEqual(
        resolveClearAllShortcut({ key: "x", ctrlKey: true, shiftKey: true, defaultPrevented: true }, 0, 10),
        { action: "none", lastEscapeAt: 0 }
    );
});

test("double escape inside the window clears, a single escape only arms", () => {
    const first = resolveClearAllShortcut({ key: "Escape", target: messageText }, 0, 1_000);
    assert.deepEqual(first, { action: "arm", lastEscapeAt: 1_000 });

    const second = resolveClearAllShortcut({ key: "Escape", target: messageText }, first.lastEscapeAt, 1_300);
    assert.deepEqual(second, { action: "clear", lastEscapeAt: 0 });
});

test("a slow second escape re-arms instead of clearing", () => {
    const first = resolveClearAllShortcut({ key: "Escape", target: messageText }, 0, 1_000);
    const second = resolveClearAllShortcut(
        { key: "Escape", target: messageText },
        first.lastEscapeAt,
        1_000 + CLEAR_ALL_DOUBLE_TAP_MS + 1
    );
    assert.deepEqual(second, { action: "arm", lastEscapeAt: 1_000 + CLEAR_ALL_DOUBLE_TAP_MS + 1 });
});

test("escape never clears while the user is typing", () => {
    for (const target of [chatInput, editableDiv, textbox]) {
        assert.deepEqual(
            resolveClearAllShortcut({ key: "Escape", target }, 900, 1_000),
            { action: "none", lastEscapeAt: 0 }
        );
    }
});

test("modified escape keys and other keys are left alone", () => {
    assert.deepEqual(
        resolveClearAllShortcut({ key: "Escape", ctrlKey: true, target: messageText }, 900, 1_000),
        { action: "none", lastEscapeAt: 900 }
    );
    assert.deepEqual(
        resolveClearAllShortcut({ key: "Escape", shiftKey: true, target: messageText }, 900, 1_000),
        { action: "none", lastEscapeAt: 900 }
    );
    assert.deepEqual(
        resolveClearAllShortcut({ key: "a", target: messageText }, 900, 1_000),
        { action: "none", lastEscapeAt: 900 }
    );
});
