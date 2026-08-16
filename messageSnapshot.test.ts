import assert from "node:assert/strict";
import test from "node:test";

import { createMessageSnapshot, createMessageSnapshotMediaUpdate, formatMessageSnapshotText, sanitizeMessageSnapshot, updateMessageSnapshotMedia } from "./messageSnapshot";

const embedImage = {
    width: 1200,
    height: 630,
    proxyURL: "https://images-ext-1.discordapp.net/embed-image.jpg",
    url: "https://example.com/embed-image.jpg",
    description: "Collection activity preview"
};

const richMessage = {
    content: "-# ↗ Forwarded by 0xDjay",
    attachments: [{
        id: "attachment-1",
        filename: "receipt.png",
        content_type: "image/png",
        width: 640,
        height: 360,
        proxy_url: "https://media.discordapp.net/receipt.png",
        url: "https://cdn.discordapp.com/receipt.png"
    }],
    embeds: [{
        type: "rich",
        url: "https://example.com/activity/1",
        color: "#23a55a",
        author: {
            name: "Market Tracker",
            url: "https://example.com/tracker",
            iconProxyURL: "https://images-ext-1.discordapp.net/tracker.png",
            iconURL: "https://example.com/tracker.png"
        },
        rawTitle: "3 items swept from Gogh Punks",
        rawDescription: "**Collection activity increased** during the last two minutes.",
        fields: [{
            rawName: "Collection",
            rawValue: "[Gogh Punks](https://example.com/collection)",
            inline: true
        }, {
            rawName: "Buyer",
            rawValue: "[0x71a…91e](https://example.com/buyer)",
            inline: true
        }, {
            rawName: "Details",
            rawValue: "Total price: **1.24 ETH**",
            inline: false
        }],
        image: embedImage,
        thumbnail: {
            width: 128,
            height: 128,
            proxyURL: "https://images-ext-1.discordapp.net/thumb.jpg",
            url: "https://example.com/thumb.jpg"
        },
        footer: {
            text: "Powered by GE",
            iconProxyURL: "https://images-ext-1.discordapp.net/footer.png",
            iconURL: "https://example.com/footer.png"
        },
        timestamp: new Date("2026-08-14T21:20:00.000Z")
    }]
};

test("creates a serializable snapshot without flattening Discord message structure", () => {
    const snapshot = createMessageSnapshot(richMessage);

    assert.deepEqual(snapshot, {
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
                width: 1200,
                height: 630,
                description: "Collection activity preview"
            }, {
                kind: "thumbnail",
                previewUrl: "https://images-ext-1.discordapp.net/thumb.jpg",
                targetUrl: "https://example.com/activity/1",
                width: 128,
                height: 128
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
            width: 640,
            height: 360,
            description: "receipt.png"
        }]
    });
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

test("sanitizes persisted snapshots and rejects unsafe media", () => {
    assert.deepEqual(sanitizeMessageSnapshot({
        content: "hello",
        embeds: [{
            sourceIndex: 0,
            type: "rich",
            title: "Title",
            fields: [{ name: "Field", value: "Value", inline: true }],
            media: [{
                kind: "image",
                previewUrl: "file://discord.com/private.png",
                targetUrl: "javascript:alert(1)"
            }]
        }],
        attachments: [{
            kind: "attachment",
            previewUrl: "https://media.discordapp.net/safe.png",
            targetUrl: "javascript:alert(1)",
            width: 10.8,
            height: -4,
            description: "safe"
        }]
    }), {
        content: "hello",
        embeds: [{
            sourceIndex: 0,
            type: "rich",
            title: "Title",
            fields: [{ name: "Field", value: "Value", inline: true }],
            media: []
        }],
        attachments: [{
            kind: "attachment",
            previewUrl: "https://media.discordapp.net/safe.png",
            targetUrl: "https://media.discordapp.net/safe.png",
            width: 10,
            description: "safe"
        }]
    });
    assert.deepEqual(sanitizeMessageSnapshot({
        content: "invalid source index",
        embeds: [{ sourceIndex: -1, title: "Title", fields: [] }],
        attachments: []
    }), {
        content: "invalid source index",
        embeds: [{ sourceIndex: 0, title: "Title", fields: [] }],
        attachments: []
    });
    assert.equal(sanitizeMessageSnapshot({ embeds: "broken" }), undefined);
});

test("rejects animated media metadata with static-looking URLs", () => {
    const update = createMessageSnapshotMediaUpdate({
        id: "message-animated-metadata",
        embeds: [{
            rawTitle: "Animated flag",
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/flag-poster.jpg",
                url: "https://example.com/flag-poster.jpg",
                srcIsAnimated: true
            }
        }, {
            rawTitle: "GIF MIME",
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/mime-poster.jpg",
                url: "https://example.com/mime-poster.jpg",
                contentType: "image/gif"
            }
        }, {
            rawTitle: "GIF filename",
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/name-poster.jpg",
                url: "https://example.com/name-poster.jpg",
                filename: "preview.GIF"
            }
        }, {
            type: "gifv",
            rawTitle: "GIFV embed",
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/gifv-poster.jpg",
                url: "https://example.com/gifv-poster.jpg"
            }
        }],
        attachments: [{
            filename: "animated.gif",
            content_type: "image/gif",
            proxy_url: "https://media.discordapp.net/attachment-poster.jpg",
            url: "https://cdn.discordapp.com/attachment-poster.jpg"
        }]
    });

    assert.deepEqual(update, {
        messageId: "message-animated-metadata",
        embeds: [
            { sourceIndex: 0, title: "Animated flag", fields: [] },
            { sourceIndex: 1, title: "GIF MIME", fields: [] },
            { sourceIndex: 2, title: "GIF filename", fields: [] },
            { sourceIndex: 3, type: "gifv", title: "GIFV embed", fields: [] }
        ],
        attachments: []
    });
});

test("keeps the first persisted embed for duplicate effective source indices", () => {
    const sanitized = sanitizeMessageSnapshot({
        content: "message",
        embeds: [
            { sourceIndex: 0, title: "First", fields: [] },
            { sourceIndex: 0, title: "Second", fields: [] }
        ],
        attachments: []
    });

    assert.deepEqual(sanitized, {
        content: "message",
        embeds: [{ sourceIndex: 0, title: "First", fields: [] }],
        attachments: []
    });
    const update = createMessageSnapshotMediaUpdate({
        id: "message-duplicate-index",
        embeds: [{
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/current.jpg",
                url: "https://example.com/current.jpg"
            }
        }]
    });
    assert.equal(updateMessageSnapshotMedia(sanitized!, update!).embeds[0]?.title, "First");
});

test("keeps the first embed for fallback and explicit source index collisions", () => {
    assert.deepEqual(sanitizeMessageSnapshot({
        content: "fallback first",
        embeds: [
            { title: "Fallback zero", fields: [] },
            { sourceIndex: 0, title: "Explicit zero", fields: [] }
        ],
        attachments: []
    }), {
        content: "fallback first",
        embeds: [{ sourceIndex: 0, title: "Fallback zero", fields: [] }],
        attachments: []
    });
    assert.deepEqual(sanitizeMessageSnapshot({
        content: "explicit first",
        embeds: [
            { sourceIndex: 1, title: "Explicit one", fields: [] },
            { title: "Fallback one", fields: [] }
        ],
        attachments: []
    }), {
        content: "explicit first",
        embeds: [{ sourceIndex: 1, title: "Explicit one", fields: [] }],
        attachments: []
    });
});

test("normalizes fallback source indices before persisted embed compaction", () => {
    assert.deepEqual(sanitizeMessageSnapshot({
        content: "message",
        embeds: [
            { fields: [] },
            { title: "Retained second", fields: [] }
        ],
        attachments: []
    }), {
        content: "message",
        embeds: [{ sourceIndex: 1, title: "Retained second", fields: [] }],
        attachments: []
    });
});

test("updates ordered embed and attachment media without changing text structure", () => {
    const snapshot = createMessageSnapshot({
        content: "message",
        attachments: [],
        embeds: [{
            type: "rich",
            rawTitle: "Title",
            fields: [{ rawName: "Field", rawValue: "Value", inline: false }]
        }]
    });
    const update = createMessageSnapshotMediaUpdate({
        id: "message-1",
        attachments: [{
            id: "attachment-1",
            filename: "late.png",
            content_type: "image/png",
            proxy_url: "https://media.discordapp.net/late.png",
            url: "https://cdn.discordapp.com/late.png"
        }],
        embeds: [{
            type: "rich",
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/late-embed.png",
                url: "https://example.com/late-embed.png"
            }
        }]
    });

    assert.equal(update?.messageId, "message-1");
    assert.deepEqual(updateMessageSnapshotMedia(snapshot, update!), {
        content: "message",
        embeds: [{
            sourceIndex: 0,
            type: "rich",
            title: "Title",
            fields: [{ name: "Field", value: "Value", inline: false }],
            media: [{
                kind: "image",
                previewUrl: "https://images-ext-1.discordapp.net/late-embed.png",
                targetUrl: "https://example.com/late-embed.png"
            }]
        }],
        attachments: [{
            kind: "attachment",
            previewUrl: "https://media.discordapp.net/late.png",
            targetUrl: "https://cdn.discordapp.com/late.png",
            description: "late.png"
        }]
    });
});

test("removes stale media from a matching updated embed", () => {
    const snapshot = createMessageSnapshot({
        content: "message",
        attachments: [],
        embeds: [{
            type: "rich",
            rawTitle: "Retained title",
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/old.png",
                url: "https://example.com/old.png"
            }
        }]
    });
    const update = createMessageSnapshotMediaUpdate({
        id: "message-removed-media",
        attachments: [],
        embeds: [{ type: "rich", rawTitle: "Current title", fields: [] }]
    });

    assert.deepEqual(updateMessageSnapshotMedia(snapshot, update!), {
        content: "message",
        embeds: [{
            sourceIndex: 0,
            type: "rich",
            title: "Retained title",
            fields: []
        }],
        attachments: []
    });
});

test("removes stale attachments when the updated array is empty", () => {
    const snapshot = createMessageSnapshot({
        content: "message",
        embeds: [],
        attachments: [{
            filename: "old.png",
            content_type: "image/png",
            proxy_url: "https://media.discordapp.net/old.png",
            url: "https://cdn.discordapp.com/old.png"
        }]
    });
    const update = createMessageSnapshotMediaUpdate({
        id: "message-removed-attachment",
        embeds: [],
        attachments: []
    });

    assert.deepEqual(updateMessageSnapshotMedia(snapshot, update!), {
        content: "message",
        embeds: [],
        attachments: []
    });
});

test("preserves snapshot media when update arrays are absent", () => {
    const snapshot = createMessageSnapshot({
        content: "message",
        embeds: [{ rawTitle: "Embed", fields: [] }],
        attachments: [{
            filename: "retained.png",
            content_type: "image/png",
            proxy_url: "https://media.discordapp.net/retained.png",
            url: "https://cdn.discordapp.com/retained.png"
        }]
    });
    const update = createMessageSnapshotMediaUpdate({ id: "message-partial-update" });

    assert.deepEqual(update, { messageId: "message-partial-update" });
    assert.equal(updateMessageSnapshotMedia(snapshot, update!), snapshot);
});

test("removes stale embeds when the updated array is empty", () => {
    const snapshot = createMessageSnapshot({
        content: "message",
        embeds: [{ rawTitle: "Removed embed", fields: [] }],
        attachments: []
    });
    const update = createMessageSnapshotMediaUpdate({
        id: "message-removed-embed",
        embeds: [],
        attachments: []
    });

    assert.deepEqual(updateMessageSnapshotMedia(snapshot, update!), {
        content: "message",
        embeds: [],
        attachments: []
    });
});

test("keeps delayed media aligned after filtering an earlier source embed", () => {
    const snapshot = createMessageSnapshot({
        content: "message",
        attachments: [],
        embeds: [
            { type: "rich" },
            { type: "rich", rawTitle: "Retained second embed", fields: [] }
        ]
    });
    const update = createMessageSnapshotMediaUpdate({
        id: "message-filtered-embed",
        attachments: [],
        embeds: [{
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/first-source.png",
                url: "https://example.com/first-source.png"
            }
        }, {
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/second-source.png",
                url: "https://example.com/second-source.png"
            }
        }]
    });

    assert.deepEqual(updateMessageSnapshotMedia(snapshot, update!), {
        content: "message",
        embeds: [{
            sourceIndex: 0,
            fields: [],
            media: [{
                kind: "image",
                previewUrl: "https://images-ext-1.discordapp.net/first-source.png",
                targetUrl: "https://example.com/first-source.png"
            }]
        }, {
            sourceIndex: 1,
            type: "rich",
            title: "Retained second embed",
            fields: [],
            media: [{
                kind: "image",
                previewUrl: "https://images-ext-1.discordapp.net/second-source.png",
                targetUrl: "https://example.com/second-source.png"
            }]
        }],
        attachments: []
    });
});

test("adds an embed that first appears in a delayed update", () => {
    const snapshot = createMessageSnapshot({
        content: "https://example.com/delayed",
        attachments: [],
        embeds: []
    });
    const update = createMessageSnapshotMediaUpdate({
        id: "message-delayed-embed",
        attachments: [],
        embeds: [{ type: "rich" }, {
            type: "rich",
            url: "https://example.com/delayed",
            rawTitle: "Delayed link preview",
            rawDescription: "Preview details",
            fields: [],
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/delayed.png",
                url: "https://example.com/delayed.png"
            }
        }]
    });

    assert.deepEqual(updateMessageSnapshotMedia(snapshot, update!), {
        content: "https://example.com/delayed",
        embeds: [{
            sourceIndex: 1,
            type: "rich",
            url: "https://example.com/delayed",
            title: "Delayed link preview",
            description: "Preview details",
            fields: [],
            media: [{
                kind: "image",
                previewUrl: "https://images-ext-1.discordapp.net/delayed.png",
                targetUrl: "https://example.com/delayed"
            }]
        }],
        attachments: []
    });
});

test("builds native notification text from structured content", () => {
    const snapshot = createMessageSnapshot(richMessage);
    assert.equal(formatMessageSnapshotText(snapshot), [
        "↗ Forwarded by 0xDjay",
        "3 items swept from Gogh Punks",
        "Collection activity increased during the last two minutes.",
        "Collection: Gogh Punks",
        "Buyer: 0x71a…91e",
        "Details: Total price: 1.24 ETH"
    ].join("\n"));
});
