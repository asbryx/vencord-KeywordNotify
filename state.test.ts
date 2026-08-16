import assert from "node:assert/strict";
import test from "node:test";

import { createNotificationImageUpdater, mergeKeywordHistory, resolveLoadedKeywordEntries, sanitizeKeywordHistory, updateNotificationImage } from "./state";

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

    const result = mergeKeywordHistory(
        [{ id: "old", matchedPattern: "old-secret" }],
        { id: "new", body: "message", matchedPattern: "new-secret" },
        true,
        50,
        true
    );

    assert.deepEqual(result, [
        { id: "new", body: "message", pinned: true },
        { id: "old" }
    ]);
});

test("removes live-only and legacy History fields", () => {
    const existing = { id: "old", messageId: "old", discordContext: "old context", saved: true };
    const incoming = { id: "new", messageId: "new", discordContext: "new context", saved: true };

    assert.deepEqual(mergeKeywordHistory([existing], incoming, true, 10, false), [
        { id: "new", messageId: "new", pinned: false },
        { id: "old", messageId: "old" }
    ]);
});

test("removes legacy Save state and trims History during startup", () => {
    const recent = [
        { id: "recent-1", messageId: "recent-1" },
        { id: "recent-2", messageId: "recent-2" }
    ];
    const legacySaved = { id: "saved", messageId: "saved", saved: true };

    assert.deepEqual(sanitizeKeywordHistory([...recent, legacySaved], 2), recent);
});
test("sanitizes existing persisted X previews while retaining records without a preview", () => {
    const result = mergeKeywordHistory([
        {
            id: "x-notification",
            messageId: "x-message",
            xPreview: {
                url: "https://twitter.com/actual_handle/status/42?ref=discord",
                authorName: "Display Name",
                handle: "actual_handle",
                text: "Persisted post"
            }
        },
        { id: "old-notification", messageId: "old-message" }
    ], { id: "new-notification", messageId: "new-message" }, true, 10, false);

    assert.deepEqual(result, [
        { id: "new-notification", messageId: "new-message", pinned: false },
        {
            id: "x-notification",
            messageId: "x-message",
            xPreview: {
                url: "https://x.com/actual_handle/status/42",
                authorName: "Display Name",
                handle: "actual_handle",
                text: "Persisted post"
            }
        },
        { id: "old-notification", messageId: "old-message" }
    ]);
});

test("keeps only the newest entries within the History limit", () => {
    const recent = [
        { id: "recent-1", messageId: "recent-1" },
        { id: "recent-2", messageId: "recent-2" }
    ];
    const legacySaved = { id: "saved", messageId: "saved", saved: true };

    assert.deepEqual(
        mergeKeywordHistory([...recent, legacySaved], { id: "new", messageId: "new" }, true, 2, false),
        [
            { id: "new", messageId: "new", pinned: false },
            recent[0]
        ]
    );
    assert.deepEqual(
        mergeKeywordHistory([...recent, legacySaved], { id: "new", messageId: "new" }, true, 0, false),
        []
    );
});

test("enriches an existing notification image without changing order or lifecycle state", () => {
    const notifications = [
        { id: "keyword-new", messageId: "new", durationMs: 4_000, pinSource: null },
        { id: "keyword-target", messageId: "target", durationMs: 9_000, pinSource: "manual" },
        { id: "keyword-old", messageId: "old", durationMs: 2_000, pinSource: null }
    ];

    const result = updateNotificationImage(notifications, "target", {
        generic: {
            previewUrl: "https://images-ext-1.discordapp.net/preview.jpg",
            targetUrl: "https://x.com/status/1"
        }
    });

    assert.deepEqual(result, [
        notifications[0],
        {
            ...notifications[1],
            imageUrl: "https://images-ext-1.discordapp.net/preview.jpg",
            imageTargetUrl: "https://x.com/status/1"
        },
        notifications[2]
    ]);
    assert.equal(result[0], notifications[0]);
    assert.equal(result[2], notifications[2]);
    assert.equal(updateNotificationImage(notifications, "missing", {
        generic: {
            previewUrl: "https://images-ext-1.discordapp.net/preview.jpg",
            targetUrl: "https://x.com/status/1"
        }
    }), notifications);
});

test("updates X notification media only from the same canonical status", () => {
    const xNotification = {
        messageId: "target",
        xPreview: { url: "https://x.com/actual_handle/status/42" }
    };
    const genericImage = {
        previewUrl: "https://media.discordapp.net/unrelated-attachment.png",
        targetUrl: "https://cdn.discordapp.com/unrelated-attachment.png"
    };
    const xImage = {
        previewUrl: "https://images-ext-1.discordapp.net/x-post.jpg",
        targetUrl: "https://x.com/actual_handle/status/42"
    };

    const xNotifications = [xNotification];
    assert.equal(updateNotificationImage(xNotifications, "target", { generic: genericImage }), xNotifications);
    assert.equal(updateNotificationImage(xNotifications, "target", {
        generic: genericImage,
        xPreview: { url: "https://x.com/other/status/99", image: xImage }
    }), xNotifications);
    assert.deepEqual(updateNotificationImage([xNotification], "target", {
        generic: genericImage,
        xPreview: { url: "https://x.com/actual_handle/status/42", image: xImage }
    }), [{ ...xNotification, imageUrl: xImage.previewUrl, imageTargetUrl: xImage.targetUrl }]);
    assert.deepEqual(createNotificationImageUpdater("target", {
        generic: genericImage,
        xPreview: { url: "https://x.com/actual_handle/status/42", image: xImage }
    }, () => true)([xNotification]), [{
        ...xNotification,
        imageUrl: xImage.previewUrl,
        imageTargetUrl: xImage.targetUrl
    }]);
});

test("updates persisted Twitter preview media from its canonical X status", () => {
    const notification = {
        messageId: "target",
        xPreview: { url: "https://twitter.com/actual_handle/status/42?ref=discord#post" }
    };
    const image = {
        previewUrl: "https://images-ext-1.discordapp.net/x-post.jpg",
        targetUrl: "https://x.com/actual_handle/status/42"
    };

    assert.deepEqual(updateNotificationImage([notification], "target", {
        xPreview: { url: "https://x.com/actual_handle/status/42", image }
    }), [{ ...notification, imageUrl: image.previewUrl, imageTargetUrl: image.targetUrl }]);
});

test("keeps history unchanged when lifecycle stops after update invocation", () => {
    const history = [{ messageId: "target" }];
    let isCurrent = true;
    const updater = createNotificationImageUpdater(
        "target",
        {
            generic: {
                previewUrl: "https://images-ext-1.discordapp.net/preview.jpg",
                targetUrl: "https://x.com/status/1"
            }
        },
        () => isCurrent
    );

    isCurrent = false;
    assert.equal(updater(history), history);
});
