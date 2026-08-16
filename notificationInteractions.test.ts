import assert from "node:assert/strict";
import test from "node:test";

import { handleNotificationCardAction, routeNestedNotificationInteraction } from "./notificationInteractions";

test("right-click prevents the Discord context menu and closes without navigation", () => {
    let prevented = 0;
    let removed = 0;
    let navigated = 0;

    handleNotificationCardAction("dismiss", {
        remove: () => removed++,
        navigate: () => navigated++
    }, { preventDefault: () => prevented++ });

    assert.equal(prevented, 1);
    assert.equal(removed, 1);
    assert.equal(navigated, 0);
});

test("left-click navigates before closing the notification", () => {
    const calls: string[] = [];
    handleNotificationCardAction("open", {
        navigate: () => calls.push("navigate"),
        remove: () => calls.push("remove")
    });
    assert.deepEqual(calls, ["navigate", "remove"]);
});

test("nested media click stays local while nested right-click reaches the card", () => {
    let stoppedClicks = 0;
    let stoppedContextMenus = 0;
    const nestedTarget = { closest: (selector: string) => selector === "a, button" ? {} as Element : null };

    routeNestedNotificationInteraction({
        type: "click",
        target: nestedTarget as unknown as EventTarget,
        stopPropagation: () => stoppedClicks++
    });
    routeNestedNotificationInteraction({
        type: "contextmenu",
        target: nestedTarget as unknown as EventTarget,
        stopPropagation: () => stoppedContextMenus++
    });

    assert.equal(stoppedClicks, 1);
    assert.equal(stoppedContextMenus, 0);
});
