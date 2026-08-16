import assert from "node:assert/strict";
import test from "node:test";

import { formatNotificationText, splitNotificationText } from "./content";

test("splits HTTP links into clickable segments", () => {
    assert.deepEqual(splitNotificationText("open https://example.com/item now"), [
        { type: "text", value: "open " },
        { type: "link", value: "https://example.com/item" },
        { type: "text", value: " now" }
    ]);
});

test("keeps trailing sentence punctuation outside a link", () => {
    assert.deepEqual(splitNotificationText("see https://example.com/item."), [
        { type: "text", value: "see " },
        { type: "link", value: "https://example.com/item" },
        { type: "text", value: "." }
    ]);
});

test("keeps closing delimiters outside a link", () => {
    assert.deepEqual(splitNotificationText("open (https://example.com/item), please"), [
        { type: "text", value: "open (" },
        { type: "link", value: "https://example.com/item" },
        { type: "text", value: "), please" }
    ]);
});

test("preserves balanced parentheses inside a link", () => {
    assert.deepEqual(splitNotificationText("open https://example.com/wiki/Test_(value) now"), [
        { type: "text", value: "open " },
        { type: "link", value: "https://example.com/wiki/Test_(value)" },
        { type: "text", value: " now" }
    ]);
});

test("renders Discord mentions with readable names", () => {
    const mentions = {
        users: { "10": "Alice" },
        roles: { "20": "Info" },
        channels: { "30": "announcements" }
    };

    assert.deepEqual(splitNotificationText("<@10> <@!10> <@&20> <#30>", mentions), [
        { type: "mention", kind: "user", value: "@Alice" },
        { type: "text", value: " " },
        { type: "mention", kind: "user", value: "@Alice" },
        { type: "text", value: " " },
        { type: "mention", kind: "role", value: "@Info" },
        { type: "text", value: " " },
        { type: "mention", kind: "channel", value: "#announcements" }
    ]);
    assert.equal(formatNotificationText("Ping <@&20> in <#30>", mentions), "Ping @Info in #announcements");
});

test("does not expose raw numeric IDs for unresolved mentions", () => {
    assert.equal(formatNotificationText("<@10> <@&20> <#30>"), "@unknown-user @unknown-role #unknown-channel");
});

test("renders embed markdown links as clickable labels", () => {
    assert.deepEqual(splitNotificationText("[OpenSea](https://opensea.io/assets/item) · [Transaction](https://explorer.test/tx/1)"), [
        { type: "link", value: "https://opensea.io/assets/item", label: "OpenSea" },
        { type: "text", value: " · " },
        { type: "link", value: "https://explorer.test/tx/1", label: "Transaction" }
    ]);
});

test("renders Discord relative timestamps as readable text", () => {
    assert.deepEqual(splitNotificationText("⏱ <t:1700000000:R>", {}, 1_700_000_180_000), [
        { type: "text", value: "⏱ " },
        { type: "text", value: "3 minutes ago" }
    ]);
});

test("preserves balanced parentheses in embed markdown links", () => {
    assert.deepEqual(splitNotificationText("[Wiki](https://example.com/Foo_(bar))"), [
        { type: "link", value: "https://example.com/Foo_(bar)", label: "Wiki" }
    ]);
});
