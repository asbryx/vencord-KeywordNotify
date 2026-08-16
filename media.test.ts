import assert from "node:assert/strict";
import test from "node:test";

import { isDiscordMediaUrl, sanitizePersistedNotificationImage } from "./media";

test("accepts only HTTPS Discord URLs for persisted image sources", () => {
    assert.equal(isDiscordMediaUrl("https://cdn.discordapp.com/avatar.png"), true);
    assert.equal(isDiscordMediaUrl("https://images-ext-1.discordapp.net/preview.png"), true);
    assert.equal(isDiscordMediaUrl("http://cdn.discordapp.com/avatar.png"), false);
    assert.equal(isDiscordMediaUrl("file://discord.com/avatar.png"), false);
    assert.equal(isDiscordMediaUrl("https://evil-discordapp.net/avatar.png"), false);
    assert.equal(isDiscordMediaUrl(undefined), false);
});

test("sanitizes persisted preview and target URLs", () => {
    assert.equal(sanitizePersistedNotificationImage(
        "file://discord.com/share/image.png",
        "https://example.com/post"
    ), undefined);
    assert.deepEqual(sanitizePersistedNotificationImage(
        "https://media.discordapp.net/image.png",
        "file://server/share/post"
    ), {
        previewUrl: "https://media.discordapp.net/image.png",
        targetUrl: "https://media.discordapp.net/image.png"
    });
    assert.deepEqual(sanitizePersistedNotificationImage(
        "https://media.discordapp.net/image.png",
        "https://example.com/post"
    ), {
        previewUrl: "https://media.discordapp.net/image.png",
        targetUrl: "https://example.com/post"
    });
});

test("rejects animated persisted media", () => {
    assert.equal(sanitizePersistedNotificationImage(
        "https://images-ext-1.discordapp.net/klipy-preview.jpg",
        "https://klipy.com/gifs/example"
    ), undefined);
    assert.equal(sanitizePersistedNotificationImage(
        "https://media.discordapp.net/animated.gif",
        "https://cdn.discordapp.com/animated.gif"
    ), undefined);
});
