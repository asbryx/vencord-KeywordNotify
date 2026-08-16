import assert from "node:assert/strict";
import test from "node:test";

import { isDiscordMediaUrl, sanitizePersistedNotificationImage, selectNotificationImage, selectNotificationImageUpdate, selectXPreviewImage, selectXPreviewImageUpdate } from "./media";

test("prefers attachment proxy URLs", () => {
    assert.deepEqual(selectNotificationImage({
        attachments: [{
            content_type: "image/png",
            proxy_url: "https://media.discordapp.net/proxy.png",
            url: "https://cdn.discordapp.com/original.png"
        }],
        embeds: []
    }), {
        previewUrl: "https://media.discordapp.net/proxy.png",
        targetUrl: "https://cdn.discordapp.com/original.png"
    });
});

test("uses Discord embed proxies instead of blocked external media", () => {
    assert.deepEqual(selectNotificationImage({
        attachments: [],
        embeds: [{
            url: "https://x.com/post/1",
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/proxy.jpg",
                url: "https://jf.x.com/blocked.jpg"
            }
        }]
    }), {
        previewUrl: "https://images-ext-1.discordapp.net/proxy.jpg",
        targetUrl: "https://x.com/post/1"
    });
});

test("uses proxied thumbnails when an embed has no image", () => {
    assert.deepEqual(selectNotificationImage({
        attachments: [],
        embeds: [{
            url: "https://x.com/post/2",
            thumbnail: {
                proxy_url: "https://images-ext-2.discordapp.net/thumb.jpg",
                url: "https://jf.x.com/blocked-thumb.jpg"
            }
        }]
    }), {
        previewUrl: "https://images-ext-2.discordapp.net/thumb.jpg",
        targetUrl: "https://x.com/post/2"
    });
});

test("does not render an unproxied external embed image", () => {
    assert.equal(selectNotificationImage({
        attachments: [],
        embeds: [{ image: { url: "https://jf.x.com/blocked.jpg" } }]
    }), undefined);
});

test("rejects non-HTTPS Discord-looking preview URLs", () => {
    for (const previewUrl of [
        "file://discord.com/share/image.png",
        "data://discord.com/share/image.png",
        "javascript://discord.com/share/image.png",
        "http://cdn.discordapp.com/share/image.png"
    ]) {
        assert.equal(selectNotificationImage({
            attachments: [{ content_type: "image/png", url: previewUrl }],
            embeds: []
        }), undefined, previewUrl);
    }
});

test("sanitizes persisted preview and target URLs", () => {
    assert.equal(sanitizePersistedNotificationImage("file://discord.com/share/image.png", "https://example.com/post"), undefined);
    assert.deepEqual(
        sanitizePersistedNotificationImage("https://media.discordapp.net/image.png", "file://server/share/post"),
        {
            previewUrl: "https://media.discordapp.net/image.png",
            targetUrl: "https://media.discordapp.net/image.png"
        }
    );
    assert.deepEqual(
        sanitizePersistedNotificationImage("https://media.discordapp.net/image.png", "https://example.com/post"),
        {
            previewUrl: "https://media.discordapp.net/image.png",
            targetUrl: "https://example.com/post"
        }
    );
});

test("accepts only HTTPS Discord URLs for persisted image sources", () => {
    assert.equal(isDiscordMediaUrl("https://cdn.discordapp.com/avatar.png"), true);
    assert.equal(isDiscordMediaUrl("http://cdn.discordapp.com/avatar.png"), false);
    assert.equal(isDiscordMediaUrl("file://discord.com/avatar.png"), false);
    assert.equal(isDiscordMediaUrl(undefined), false);
});

test("falls back to the safe proxy for unsafe live media targets", () => {
    assert.deepEqual(selectNotificationImage({
        attachments: [{
            content_type: "image/png",
            proxy_url: "https://media.discordapp.net/proxy.png",
            url: "file://server/share/image.png"
        }],
        embeds: []
    }), {
        previewUrl: "https://media.discordapp.net/proxy.png",
        targetUrl: "https://media.discordapp.net/proxy.png"
    });

    assert.deepEqual(selectNotificationImage({
        attachments: [],
        embeds: [{
            url: "javascript:alert(1)",
            image: { proxyURL: "https://images-ext-1.discordapp.net/proxy.jpg" }
        }]
    }), {
        previewUrl: "https://images-ext-1.discordapp.net/proxy.jpg",
        targetUrl: "https://images-ext-1.discordapp.net/proxy.jpg"
    });
});

test("hides animated GIF previews while leaving static media eligible", () => {
    for (const source of [
        {
            attachments: [{
                content_type: "image/gif",
                proxy_url: "https://media.discordapp.net/animated.gif",
                url: "https://cdn.discordapp.com/animated.gif"
            }],
            embeds: []
        },
        {
            attachments: [],
            embeds: [{
                url: "https://klipy.com/gifs/example",
                image: { proxyURL: "https://images-ext-1.discordapp.net/klipy.jpg" }
            }]
        },
        {
            attachments: [],
            embeds: [{
                type: "gifv",
                url: "https://example.com/animation",
                thumbnail: { proxyURL: "https://images-ext-1.discordapp.net/animated.jpg" }
            }]
        },
        {
            attachments: [],
            embeds: [{
                url: "https://example.com/animation",
                image: {
                    proxyURL: "https://images-ext-1.discordapp.net/animated.jpg",
                    srcIsAnimated: true
                }
            }]
        }
    ]) {
        assert.equal(selectNotificationImage(source), undefined);
    }

    assert.deepEqual(selectNotificationImage({
        attachments: [],
        embeds: [{
            type: "video",
            url: "https://x.com/status/1",
            image: { proxyURL: "https://images-ext-1.discordapp.net/static-video-poster.jpg" }
        }]
    }), {
        previewUrl: "https://images-ext-1.discordapp.net/static-video-poster.jpg",
        targetUrl: "https://x.com/status/1"
    });
});

test("selects media only from the structured X preview embed", () => {
    const embeds = [{
        url: "https://example.com/unrelated",
        image: {
            proxyURL: "https://images-ext-1.discordapp.net/unrelated.jpg",
            url: "https://example.com/unrelated.jpg"
        }
    }, {
        url: "https://x.com/actual_handle/status/42",
        image: {
            proxyURL: "https://images-ext-1.discordapp.net/x-post.jpg",
            url: "https://pbs.twimg.com/x-post.jpg"
        }
    }];

    assert.deepEqual(selectXPreviewImage(embeds, 1), {
        previewUrl: "https://images-ext-1.discordapp.net/x-post.jpg",
        targetUrl: "https://x.com/actual_handle/status/42"
    });
    assert.equal(selectXPreviewImage(embeds, 2), undefined);
    assert.equal(selectXPreviewImage([], 0), undefined);
});

test("targets the canonical X post for initial media from a description status URL", () => {
    assert.deepEqual(selectXPreviewImage([{
        description: "Post: https://twitter.com/description_handle/status/43?ref=discord",
        image: {
            proxyURL: "https://images-ext-1.discordapp.net/initial-x-post.jpg",
            url: "https://pbs.twimg.com/initial-x-post.jpg"
        }
    }], 0), {
        previewUrl: "https://images-ext-1.discordapp.net/initial-x-post.jpg",
        targetUrl: "https://x.com/description_handle/status/43"
    });
});

test("targets canonical X posts for every supported embed status source", () => {
    const cases = [{
        name: "title",
        embed: { title: "Post https://twitter.com/title_handle/status/44?ref=discord" },
        targetUrl: "https://x.com/title_handle/status/44"
    }, {
        name: "rawDescription",
        embed: { rawDescription: "Post https://twitter.com/raw_description/status/45?ref=discord" },
        targetUrl: "https://x.com/raw_description/status/45"
    }, {
        name: "rawTitle",
        embed: { rawTitle: "Post https://twitter.com/raw_title/status/46?ref=discord" },
        targetUrl: "https://x.com/raw_title/status/46"
    }, {
        name: "field value",
        embed: { fields: [{ value: "Post https://twitter.com/field_value/status/47?ref=discord" }] },
        targetUrl: "https://x.com/field_value/status/47"
    }, {
        name: "field rawValue",
        embed: { fields: [{ rawValue: "Post https://twitter.com/field_raw/status/48?ref=discord" }] },
        targetUrl: "https://x.com/field_raw/status/48"
    }];

    for (const { name, embed, targetUrl } of cases) {
        const image = {
            proxyURL: `https://images-ext-1.discordapp.net/${name.replaceAll(" ", "-")}.jpg`,
            url: `https://pbs.twimg.com/${name.replaceAll(" ", "-")}.jpg`
        };
        const expectedImage = { previewUrl: image.proxyURL, targetUrl };

        assert.deepEqual(selectXPreviewImage([{ ...embed, image }], 0), expectedImage, `${name} initial`);
        assert.deepEqual(selectXPreviewImageUpdate({
            id: `${name}-message`,
            embeds: [{ ...embed, image }]
        }), {
            messageId: `${name}-message`,
            xPreviewUrl: targetUrl,
            image: expectedImage
        }, `${name} delayed`);
    }
});

test("does not associate an attachment with an X preview embed", () => {
    const attachments = [{
        content_type: "image/png",
        proxy_url: "https://media.discordapp.net/unrelated-attachment.png",
        url: "https://cdn.discordapp.com/unrelated-attachment.png"
    }];
    const embeds = [{ url: "https://x.com/actual_handle/status/42" }];

    assert.equal(selectXPreviewImage(embeds, 0), undefined);
    assert.deepEqual(selectNotificationImage({ attachments, embeds }), {
        previewUrl: "https://media.discordapp.net/unrelated-attachment.png",
        targetUrl: "https://cdn.discordapp.com/unrelated-attachment.png"
    });
});

test("extracts delayed X media only from a valid X status embed", () => {
    assert.deepEqual(selectXPreviewImageUpdate({
        id: "message",
        attachments: [{
            content_type: "image/png",
            proxy_url: "https://media.discordapp.net/unrelated-attachment.png"
        }],
        embeds: [{
            url: "https://example.com/unrelated",
            image: { proxyURL: "https://images-ext-1.discordapp.net/unrelated.jpg" }
        }, {
            url: "https://x.com/actual_handle/status/42",
            image: { proxyURL: "https://images-ext-1.discordapp.net/x-post.jpg" }
        }]
    }), {
        messageId: "message",
        xPreviewUrl: "https://x.com/actual_handle/status/42",
        image: {
            previewUrl: "https://images-ext-1.discordapp.net/x-post.jpg",
            targetUrl: "https://x.com/actual_handle/status/42"
        }
    });
    assert.equal(selectXPreviewImageUpdate({
        id: "message",
        attachments: [{
            content_type: "image/png",
            proxy_url: "https://media.discordapp.net/unrelated-attachment.png"
        }],
        embeds: [{
            url: "https://example.com/unrelated",
            image: { proxyURL: "https://images-ext-1.discordapp.net/unrelated.jpg" }
        }]
    }), undefined);
    assert.deepEqual(selectXPreviewImageUpdate({
        id: "description-message",
        embeds: [{
            description: "Post: https://twitter.com/description_handle/status/43?ref=discord",
            image: {
                proxyURL: "https://images-ext-1.discordapp.net/delayed-x-post.jpg",
                url: "https://pbs.twimg.com/delayed-x-post.jpg"
            }
        }]
    }), {
        messageId: "description-message",
        xPreviewUrl: "https://x.com/description_handle/status/43",
        image: {
            previewUrl: "https://images-ext-1.discordapp.net/delayed-x-post.jpg",
            targetUrl: "https://x.com/description_handle/status/43"
        }
    });
});

test("handles malformed delayed X media payloads safely", () => {
    const malformedPayloads = [{
        id: "message",
        embeds: {}
    }, {
        id: "message",
        embeds: [{ fields: {} }]
    }, {
        id: "message",
        embeds: [{
            description: "https://x.com/actual_handle/status/42",
            images: {}
        }]
    }, {
        id: "message",
        embeds: [{ fields: [null, 1, {}] }]
    }];

    for (const payload of malformedPayloads) {
        assert.doesNotThrow(() => selectXPreviewImageUpdate(payload));
        assert.equal(selectXPreviewImageUpdate(payload), undefined);
    }
});

test("hides animated media restored from notification history", () => {
    assert.equal(sanitizePersistedNotificationImage(
        "https://images-ext-1.discordapp.net/klipy-preview.jpg",
        "https://klipy.com/gifs/example"
    ), undefined);
    assert.equal(sanitizePersistedNotificationImage(
        "https://media.discordapp.net/animated.gif",
        "https://cdn.discordapp.com/animated.gif"
    ), undefined);
});

test("handles partial MESSAGE_UPDATE payloads safely", () => {
    assert.doesNotThrow(() => selectNotificationImageUpdate(undefined));
    assert.equal(selectNotificationImageUpdate(undefined), undefined);
    assert.equal(selectNotificationImageUpdate({}), undefined);
    assert.equal(selectNotificationImageUpdate({ id: "message" }), undefined);
    const malformedPayloads = [{
        id: "message",
        embeds: {}
    }, {
        id: "message",
        attachments: [null]
    }, {
        id: "message",
        embeds: [null]
    }, {
        id: "message",
        attachments: [{
            content_type: 1,
            proxy_url: "https://media.discordapp.net/malformed-attachment.png"
        }]
    }, {
        id: "message",
        attachments: [{
            content_type: "image/png",
            contentType: 1,
            filename: 1,
            proxy_url: "https://media.discordapp.net/malformed-media.png"
        }]
    }, {
        id: "message",
        embeds: [{
            type: 1,
            image: {
                contentType: 1,
                proxyURL: "https://images-ext-1.discordapp.net/malformed-embed.png"
            }
        }]
    }];

    for (const payload of malformedPayloads) {
        assert.doesNotThrow(() => selectNotificationImageUpdate(payload));
    }
    assert.deepEqual(selectNotificationImageUpdate({
        id: "message",
        embeds: [{
            url: "https://x.com/status/1",
            image: { proxyURL: "https://images-ext-1.discordapp.net/static.jpg" }
        }]
    }), {
        messageId: "message",
        image: {
            previewUrl: "https://images-ext-1.discordapp.net/static.jpg",
            targetUrl: "https://x.com/status/1"
        }
    });
});