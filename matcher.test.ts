import assert from "node:assert/strict";
import test from "node:test";

import { findKeywordMatch, getMessageText, ListType, matchesKeyword, type KeywordEntry, type KeywordMessage } from "./matcher";

const message = (overrides: Partial<KeywordMessage> = {}): KeywordMessage => ({
    author: { id: "author", bot: false },
    channel_id: "channel",
    content: "alpha keyword omega",
    embeds: [],
    ...overrides
});

const entry = (overrides: Partial<KeywordEntry> = {}): KeywordEntry => ({
    regex: "keyword",
    listIds: [],
    listType: ListType.BlackList,
    ignoreCase: false,
    ...overrides
});

test("continues after an empty entry", () => {
    assert.equal(matchesKeyword(message(), [entry({ regex: "" }), entry()], "guild", false), true);
});

test("handles invalid regex and ignoreCase", () => {
    assert.doesNotThrow(() => matchesKeyword(message(), [entry({ regex: "[" })], "guild", false));
    assert.equal(matchesKeyword(message(), [entry({ regex: "KEYWORD", ignoreCase: true })], "guild", false), true);
});

test("returns the matched entry metadata", () => {
    const match = findKeywordMatch(message(), [entry({ regex: "alpha" }), entry({ regex: "omega" })], "guild", false);

    assert.equal(match?.pattern, "alpha");
    assert.equal(match?.entryIndex, 0);
});

test("applies blacklist and whitelist IDs", () => {
    assert.equal(matchesKeyword(message(), [entry({ listIds: ["channel"] })], "guild", false), false);
    assert.equal(matchesKeyword(message(), [entry({ listType: ListType.Whitelist, listIds: ["guild"] })], "guild", false), true);
    assert.equal(matchesKeyword(message(), [entry({ listType: ListType.Whitelist, listIds: ["other"] })], "guild", false), false);
});

test("ignores bots unless a whitelist explicitly includes the bot", () => {
    const botMessage = message({ author: { id: "bot", bot: true } });
    assert.equal(matchesKeyword(botMessage, [entry()], "guild", true), false);
    assert.equal(matchesKeyword(botMessage, [entry({ listType: ListType.Whitelist, listIds: ["bot"] })], "guild", true), true);
});

test("matches nullable embed text safely", () => {
    const embedMessage = message({
        content: "",
        embeds: [{ title: null, description: "keyword", fields: null }, { fields: [{ name: null, value: "keyword" }] }]
    });

    assert.equal(matchesKeyword(embedMessage, [entry()], "guild", false), true);
    assert.doesNotThrow(() => matchesKeyword(message({ content: null, embeds: null }), [entry()], undefined, false));
});

test("matches embed author and footer text", () => {
    assert.equal(matchesKeyword(message({
        content: "",
        embeds: [{ author: { name: "keyword" } }]
    }), [entry()], "guild", false), true);
    assert.equal(matchesKeyword(message({
        content: "",
        embeds: [{ footer: { text: "keyword" } }]
    }), [entry()], "guild", false), true);
});

test("keeps structured embed details when message content only contains forwarding attribution", () => {
    const embedMessage = message({
        content: "-# ↗ Forwarded by 0xDjay",
        embeds: [{
            type: "rich",
            author: { name: "Mint" },
            rawTitle: "🆕 <:robinhood:1527021757301784728> Violet side 2 minted 4× Gogh Punks",
            rawDescription: "⏱ <t:1786768368:R>",
            fields: [{
                rawName: "👤 Minter",
                rawValue: "[Violet side 2](https://opensea.io/account/activity?activityTypes=mint)"
            }, {
                rawName: "🔎 NFTs IDs",
                rawValue: "`#2084` · `#2085` · `#2086` · `#2087`"
            }, {
                rawName: "🔗 Links",
                rawValue: "[OpenSea](https://opensea.io/assets/item) · [Transaction](https://explorer.test/tx/1)"
            }],
            footer: { text: "Powered by GE" }
        } as any]
    });

    assert.equal(getMessageText(embedMessage), [
        "-# ↗ Forwarded by 0xDjay",
        "Mint",
        "🆕 Violet side 2 minted 4× Gogh Punks",
        "⏱ <t:1786768368:R>",
        "👤 Minter",
        "[Violet side 2](https://opensea.io/account/activity?activityTypes=mint)",
        "🔎 NFTs IDs",
        "#2084 · #2085 · #2086 · #2087",
        "🔗 Links",
        "[OpenSea](https://opensea.io/assets/item) · [Transaction](https://explorer.test/tx/1)",
        "Powered by GE"
    ].join("\n"));
});

test("excludes animated-provider URLs without hiding other URL candidates", () => {
    const urlEntry = entry({
        regex: "https?:\\/\\/(?!(?:[^\\/\\s]+\\.)*(?:tenor\\.com|giphy\\.com)(?:[\\/:\\s]|$))(?![^\\s]*\\.gif(?:[?#][^\\s]*)?(?:\\s|$))[^\\s]+",
        ignoreCase: true
    });

    assert.equal(matchesKeyword(message({ content: "https://klipy.com/gifs/test" }), [urlEntry], "guild", false), false);
    assert.equal(matchesKeyword(message({ content: "https://static.klipy.com/gifs/test" }), [urlEntry], "guild", false), false);
    assert.equal(matchesKeyword(message({ content: "https://klipy.com/gifs/test https://example.com/item" }), [urlEntry], "guild", false), true);
    assert.equal(matchesKeyword(message({ content: "https://notklipy.com/gifs/test" }), [urlEntry], "guild", false), true);
});

test("rejects provider URL matches that consume only trailing whitespace", () => {
    assert.equal(matchesKeyword(message({
        content: "https://klipy.com/gifs/test "
    }), [entry({ regex: "https?:\\/\\/[^\\s]+\\s*", ignoreCase: true })], "guild", false), false);
});

test("rejects zero-width assertions that depend on provider URLs", () => {
    assert.equal(matchesKeyword(message({
        content: "https://klipy.com/gifs/test"
    }), [entry({ regex: "(?=.*klipy\\.com)" })], "guild", false), false);
    assert.equal(matchesKeyword(message({
        content: "https://klipy.com/gifs/test"
    }), [entry({ regex: "^(?=.*klipy\\.com)" })], "guild", false), false);
});

test("preserves prose matches around an excluded provider URL", () => {
    assert.equal(matchesKeyword(message({
        content: "mint https://klipy.com/gifs/test alert"
    }), [entry({ regex: "mint\\s+.*alert" })], "guild", false), true);
    assert.equal(matchesKeyword(message({
        content: "alphahttps://klipy.com/gifs/testomega"
    }), [entry({ regex: "alphaomega" })], "guild", false), false);
});
