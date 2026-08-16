import assert from "node:assert/strict";
import test from "node:test";

import { createMessageViewModel, formatDiscordTimestamp, getMessageMediaLayout, getMillisecondsUntilNextLocalDay } from "./messageViewModel";
import type { MessageSnapshot } from "./messageSnapshot";

const snapshot: MessageSnapshot = {
    content: "-# ↗ Forwarded by 0xDjay",
    embeds: [{
        sourceIndex: 0,
        type: "rich",
        url: "https://example.com/activity/1",
        color: "#23a55a",
        author: {
            name: "Market Tracker",
            url: "https://example.com/tracker",
            iconUrl: "https://images-ext-1.discordapp.net/tracker.png"
        },
        title: "3 items swept from Gogh Punks",
        description: "**Collection activity increased** during the last two minutes.",
        fields: [{
            name: "Collection",
            value: "[Gogh Punks](https://example.com/collection)",
            inline: true
        }, {
            name: "Buyer",
            value: "[0x71a…91e](https://example.com/buyer)",
            inline: true
        }, {
            name: "Details",
            value: "Total price: **1.24 ETH**",
            inline: false
        }],
        media: [{
            kind: "image",
            previewUrl: "https://images-ext-1.discordapp.net/embed-image.jpg",
            targetUrl: "https://example.com/activity/1",
            description: "Collection activity preview"
        }, {
            kind: "thumbnail",
            previewUrl: "https://images-ext-1.discordapp.net/thumb.jpg",
            targetUrl: "https://example.com/activity/1"
        }],
        footer: {
            text: "Powered by GE",
            iconUrl: "https://images-ext-1.discordapp.net/footer.png"
        },
        timestamp: 1786742400000
    }],
    attachments: [{
        kind: "attachment",
        previewUrl: "https://media.discordapp.net/receipt.png",
        targetUrl: "https://cdn.discordapp.com/receipt.png",
        description: "receipt.png"
    }]
};

test("preserves original Discord hierarchy and ordered fields", () => {
    const model = createMessageViewModel(snapshot);

    assert.deepEqual(model.map(block => block.kind), ["content", "embed", "attachment"]);
    assert.deepEqual(model[0], {
        kind: "content",
        key: "content",
        markdown: snapshot.content
    });
    assert.deepEqual(model[1], {
        kind: "embed",
        key: "embed-0",
        type: "rich",
        url: "https://example.com/activity/1",
        color: "#23a55a",
        author: snapshot.embeds[0].author,
        title: snapshot.embeds[0].title,
        description: snapshot.embeds[0].description,
        fields: [{
            key: "embed-0-field-0",
            name: "Collection",
            value: "[Gogh Punks](https://example.com/collection)",
            inline: true
        }, {
            key: "embed-0-field-1",
            name: "Buyer",
            value: "[0x71a…91e](https://example.com/buyer)",
            inline: true
        }, {
            key: "embed-0-field-2",
            name: "Details",
            value: "Total price: **1.24 ETH**",
            inline: false
        }],
        media: [{ key: "embed-0-media-0", ...snapshot.embeds[0].media![0] }, { key: "embed-0-media-1", ...snapshot.embeds[0].media![1] }],
        footer: snapshot.embeds[0].footer,
        timestamp: snapshot.embeds[0].timestamp
    });
    assert.deepEqual(model[2], {
        kind: "attachment",
        key: "attachment-0",
        media: snapshot.attachments[0]
    });
});

test("keeps embed media grouped inside its embed instead of flattening it", () => {
    const model = createMessageViewModel(snapshot);
    const embed = model[1];
    assert.equal(embed.kind, "embed");
    if (embed.kind !== "embed") return;

    assert.equal(embed.media.length, 2);
    assert.equal(model.filter(block => block.kind === "attachment").length, 1);
    assert.equal(embed.fields[0].inline, true);
    assert.equal(embed.fields[2].inline, false);
});

test("uses full layout for landscape Discord thumbnails", () => {
    assert.equal(getMessageMediaLayout({
        kind: "thumbnail",
        previewUrl: "https://images-ext-1.discordapp.net/opengraph-image",
        targetUrl: "https://opensea.io/collection/sad-cat-/overview",
        width: 1200,
        height: 630
    }), "full");
});

test("classifies square and portrait thumbnails for larger proportional layouts", () => {
    assert.equal(getMessageMediaLayout({
        kind: "thumbnail",
        previewUrl: "https://images-ext-1.discordapp.net/avatar.png",
        targetUrl: "https://example.com",
        width: 96,
        height: 96
    }), "square");
    assert.equal(getMessageMediaLayout({
        kind: "thumbnail",
        previewUrl: "https://images-ext-1.discordapp.net/portrait.png",
        targetUrl: "https://example.com",
        width: 800,
        height: 1200
    }), "portrait");
    assert.equal(getMessageMediaLayout({
        kind: "thumbnail",
        previewUrl: "https://images-ext-1.discordapp.net/unknown.png",
        targetUrl: "https://example.com"
    }), "compact");
    assert.equal(getMessageMediaLayout({
        kind: "image",
        previewUrl: "https://images-ext-1.discordapp.net/image.png",
        targetUrl: "https://example.com"
    }), "full");
});

test("formats embed timestamps with Discord day labels and no seconds", () => {
    const now = new Date(2026, 7, 16, 20, 30, 45);

    assert.equal(formatDiscordTimestamp(new Date(2026, 7, 16, 14, 48, 18), now), "Today at 2:48 PM");
    assert.equal(formatDiscordTimestamp(new Date(2026, 7, 15, 23, 20, 59), now), "Yesterday at 11:20 PM");
    assert.equal(formatDiscordTimestamp(new Date(2026, 7, 14, 9, 15, 33), now), "8/14/2026 at 9:15 AM");
    assert.equal(
        formatDiscordTimestamp(new Date(2025, 11, 31, 23, 59), new Date(2026, 0, 1, 0, 1)),
        "Yesterday at 11:59 PM"
    );
});

test("schedules a timestamp refresh at the next local calendar day", () => {
    assert.equal(getMillisecondsUntilNextLocalDay(new Date(2025, 11, 31, 23, 59, 59, 900)), 100);
});
