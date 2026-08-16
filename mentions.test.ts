import assert from "node:assert/strict";
import test from "node:test";

import { isSpecificMention, resolveUserMentionNames } from "./mentions";

test("resolves hydrated mention IDs through the user lookup", () => {
    const lookups: string[] = [];
    assert.deepEqual(resolveUserMentionNames(["123"], id => {
        lookups.push(id);
        return id === "123" ? "Alice" : undefined;
    }), { "123": "Alice" });
    assert.deepEqual(lookups, ["123"]);
});

test("prefers names embedded in raw MESSAGE_CREATE mention objects", () => {
    assert.deepEqual(resolveUserMentionNames([
        { id: "123", global_name: "Alice Global", username: "alice" },
        { id: "456", globalName: "Bob Global", username: "bob" },
        { id: "789", username: "charlie" }
    ], () => "store-name"), {
        "123": "Alice Global",
        "456": "Bob Global",
        "789": "charlie"
    });
});

test("falls back to lookup for object mentions without a usable name", () => {
    assert.deepEqual(resolveUserMentionNames([
        { id: "123" },
        null,
        5,
        { username: "missing-id" }
    ], id => id === "123" ? "Alice" : undefined), { "123": "Alice" });
});

test("detects direct and dynamically owned role mentions", () => {
    assert.equal(isSpecificMention({ mentions: [{ id: "me" }] }, "me", []), true);
    assert.equal(isSpecificMention({ mentions: ["me"] }, "me", []), true);
    assert.equal(isSpecificMention({ mention_roles: ["info"] }, "me", ["info", "alpha"]), true);
    assert.equal(isSpecificMention({ mentionRoles: ["alpha"] }, "me", ["info", "alpha"]), true);
});

test("rejects unrelated roles and everyone mentions", () => {
    assert.equal(isSpecificMention({ mentions: [{ id: "other" }] }, "me", ["info"]), false);
    assert.equal(isSpecificMention({ mention_roles: ["other"] }, "me", ["info"]), false);
    assert.equal(isSpecificMention({ mention_everyone: true }, "me", ["info"]), false);
});
