import assert from "node:assert/strict";
import test from "node:test";

import { createNotificationSnapshotUpdater, mergeKeywordHistory, resolveLoadedKeywordEntries, sanitizeKeywordHistory, updateNotificationSnapshot } from "./state";

const validHistoryMetadata = {
    id: "keyword-valid-message",
    channelId: "channel-1",
    messageId: "valid-message",
    authorName: "Author",
    senderType: "user" as const,
    location: "Server · #channel",
    timestamp: 1_786_742_400_000
};

test("rejects keyword entries loaded by a stale lifecycle", () => {

    const entries = [{ regex: "mint", listIds: [], listType: "BlackList", ignoreCase: true }];
    assert.equal(resolveLoadedKeywordEntries(entries, 1, 2, 0, 0), null);
    assert.deepEqual(resolveLoadedKeywordEntries(entries, 2, 2, 0, 0), entries);
    assert.deepEqual(resolveLoadedKeywordEntries("invalid", 2, 2, 0, 0), []);
});

test("rejects keyword entries loaded before a same-lifecycle mutation", () => {
    const entries = [{ regex: "old", listIds: [], listType: "BlackList", ignoreCase: true }];

    assert.equal(resolveLoadedKeywordEntries(entries, 2, 2, 4, 5), null);
    assert.deepEqual(resolveLoadedKeywordEntries(entries, 2, 2, 5, 5), entries);
});

test("keeps history unchanged when delivery becomes stale", () => {

    const history = [{ id: "old", matchedPattern: "secret" }];
    const result = mergeKeywordHistory(history, { id: "new", matchedPattern: "secret" }, false, 50, false);
    assert.equal(result, history);
});

test("removes matched regex from new and existing history", () => {

    const snapshot = { content: "message", embeds: [], attachments: [] };
    const oldEntry = {
        ...validHistoryMetadata,
        id: "keyword-old",
        messageId: "old",
        snapshot,
        matchedPattern: "old-secret"
    };
    const newEntry = {
        ...validHistoryMetadata,
        id: "keyword-new",
        messageId: "new",
        snapshot,
        matchedPattern: "new-secret"
    };
    const result = mergeKeywordHistory([oldEntry], newEntry, true, 50, true);

    assert.deepEqual(result, [
        { ...newEntry, matchedPattern: undefined, pinned: true },
        { ...oldEntry, matchedPattern: undefined }
    ].map(({ matchedPattern: _, ...entry }) => entry));
});

test("sanitizes structured snapshots and removes invalid snapshots", () => {
    const structuredSnapshot = {
        content: "**message**",
        embeds: [{
            title: "Title",
            fields: [],
            media: [
                { kind: "image", previewUrl: "https://media.discordapp.net/image.png", targetUrl: "https://cdn.discordapp.com/image.png" },
                { kind: "image", previewUrl: "https://example.com/unsafe.png", targetUrl: "https://example.com/unsafe.png" }
            ],
            unknownEmbedField: "removed"
        }],
        attachments: [{ kind: "attachment", previewUrl: "https://example.com/unsafe.png", targetUrl: "https://example.com/unsafe.png" }],
        unknownSnapshotField: "removed"
    };
    const sanitizedSnapshot = {
        content: "**message**",
        embeds: [{
            sourceIndex: 0,
            title: "Title",
            fields: [],
            media: [{ kind: "image", previewUrl: "https://media.discordapp.net/image.png", targetUrl: "https://cdn.discordapp.com/image.png" }]
        }],
        attachments: []
    };

    assert.deepEqual(sanitizeKeywordHistory([
        { ...validHistoryMetadata, snapshot: structuredSnapshot, discordContext: "live", xPreview: { url: "https://x.com/example/status/1" } },
        { id: "invalid", snapshot: { content: "missing embeds" }, metadata: "retained" }
    ]), [
        { ...validHistoryMetadata, snapshot: sanitizedSnapshot }
    ]);
});

test("migrates legacy body and safe image fields into a snapshot", () => {
    const legacy = {
        ...validHistoryMetadata,
        id: "keyword-legacy-message",
        messageId: "legacy-message",
        body: "legacy **content**",
        imageUrl: "https://media.discordapp.net/image.png",
        imageTargetUrl: "https://cdn.discordapp.com/image.png",
        xPreview: { url: "https://x.com/example/status/1" },
        discordContext: "live",
        saved: true,
        pinned: true,
        metadata: "retained"
    };

    assert.deepEqual(sanitizeKeywordHistory([legacy]), [{
        ...validHistoryMetadata,
        id: "keyword-legacy-message",
        messageId: "legacy-message",
        snapshot: {
            content: "legacy **content**",
            embeds: [],
            attachments: [{
                kind: "attachment",
                previewUrl: "https://media.discordapp.net/image.png",
                targetUrl: "https://cdn.discordapp.com/image.png"
            }]
        },
        pinned: true,
    }]);
});

test("sanitizes optional History display fields", () => {
    const snapshot = { content: "message", embeds: [], attachments: [] };
    const valid = {
        ...validHistoryMetadata,
        guildId: "guild-1",
        avatarUrl: "https://cdn.discordapp.com/avatar.png",
        authorColor: "#23A55A",
        snapshot,
        pinned: false
    };
    const invalid = {
        ...validHistoryMetadata,
        id: "keyword-invalid-optionals",
        messageId: "invalid-optionals",
        guildId: "",
        avatarUrl: "https://example.com/avatar.png",
        authorColor: "url(javascript:alert(1))",
        snapshot,
        pinned: "true"
    };

    assert.deepEqual(sanitizeKeywordHistory([valid, invalid]), [
        valid,
        {
            ...validHistoryMetadata,
            id: "keyword-invalid-optionals",
            messageId: "invalid-optionals",
            snapshot
        }
    ]);
});

test("drops rows without complete navigation and display metadata", () => {
    const snapshot = { content: "message", embeds: [], attachments: [] };
    const valid = { ...validHistoryMetadata, snapshot };
    const invalidRows = [
        { snapshot },
        { ...valid, id: "" },
        { ...valid, channelId: "" },
        { ...valid, messageId: "" },
        { ...valid, authorName: "" },
        { ...valid, senderType: "system" },
        { ...valid, location: "" },
        { ...valid, timestamp: Number.NaN }
    ];

    assert.deepEqual(sanitizeKeywordHistory([...invalidRows, valid]), [valid]);
});

test("drops rows without renderable snapshots and trims History during startup", () => {
    const recent = [
        { ...validHistoryMetadata, id: "keyword-recent-1", messageId: "recent-1", snapshot: { content: "recent-1", embeds: [], attachments: [] } },
        { ...validHistoryMetadata, id: "keyword-recent-2", messageId: "recent-2", snapshot: { content: "recent-2", embeds: [], attachments: [] } }
    ];
    const invalidLegacySaved = { id: "saved", messageId: "saved", saved: true };

    assert.deepEqual(sanitizeKeywordHistory([...recent, invalidLegacySaved], 2), recent);
});

test("keeps only the newest entries within the History limit", () => {
    const recent = [
        { ...validHistoryMetadata, id: "keyword-recent-1", messageId: "recent-1", snapshot: { content: "recent-1", embeds: [], attachments: [] } },
        { ...validHistoryMetadata, id: "keyword-recent-2", messageId: "recent-2", snapshot: { content: "recent-2", embeds: [], attachments: [] } }
    ];
    const incoming = {
        ...validHistoryMetadata,
        id: "keyword-new",
        messageId: "new",
        snapshot: { content: "new", embeds: [], attachments: [] }
    };

    assert.deepEqual(
        mergeKeywordHistory(recent, incoming, true, 2, false),
        [
            { ...incoming, pinned: false },
            recent[0]
        ]
    );
    assert.deepEqual(mergeKeywordHistory(recent, incoming, true, 0, false), []);
});

test("enriches a notification snapshot without changing order or untouched rows", () => {
    const snapshot = {
        content: "message",
        embeds: [{ title: "Embed", fields: [], media: [] }],
        attachments: []
    };
    const notifications = [
        { id: "keyword-new", messageId: "new", durationMs: 4_000, snapshot },
        { id: "keyword-target", messageId: "target", durationMs: 9_000, snapshot },
        { id: "keyword-old", messageId: "old", durationMs: 2_000, snapshot }
    ];
    const update = {
        messageId: "target",
        embeds: [{
            sourceIndex: 0,
            fields: [],
            media: [{
                kind: "image" as const,
                previewUrl: "https://images-ext-1.discordapp.net/preview.jpg",
                targetUrl: "https://cdn.discordapp.com/preview.jpg"
            }]
        }],
        attachments: [{
            kind: "attachment" as const,
            previewUrl: "https://media.discordapp.net/attachment.png",
            targetUrl: "https://cdn.discordapp.com/attachment.png"
        }]
    };

    const result = updateNotificationSnapshot(notifications, update);

    assert.deepEqual(result, [
        notifications[0],
        {
            ...notifications[1],
            snapshot: {
                ...snapshot,
                embeds: [{ ...snapshot.embeds[0], sourceIndex: 0, media: update.embeds[0].media }],
                attachments: update.attachments
            }
        },
        notifications[2]
    ]);
    assert.equal(result[0], notifications[0]);
    assert.equal(result[2], notifications[2]);
    assert.equal(updateNotificationSnapshot(notifications, { ...update, messageId: "missing" }), notifications);
    const invalidSnapshot = [{ messageId: "target", metadata: "invalid snapshot" }];
    assert.equal(updateNotificationSnapshot(invalidSnapshot, update), invalidSnapshot);
    assert.deepEqual(createNotificationSnapshotUpdater(update, () => true)(notifications), result);
});

test("keeps history unchanged when lifecycle stops after snapshot update invocation", () => {
    const history = [{ messageId: "target", snapshot: { content: "message", embeds: [], attachments: [] } }];
    const update = { messageId: "target", embeds: [], attachments: [] };
    let isCurrent = true;
    const updater = createNotificationSnapshotUpdater(update, () => isCurrent);

    isCurrent = false;
    assert.equal(updater(history), history);
});
