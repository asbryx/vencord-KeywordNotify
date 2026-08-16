import assert from "node:assert/strict";
import test from "node:test";

import { getMessageText, type KeywordMessage } from "./matcher";
import { extractXPreview, extractXPreviewSource, normalizeXPreviewTimestamp, parseXAuthor, sanitizePersistedXPreview } from "./xPreview";

function message(overrides: Partial<KeywordMessage> = {}): KeywordMessage {
    return {
        author: { id: "discord-sender" },
        channel_id: "channel",
        content: "Discord sender content must not become tweet text.",
        embeds: [],
        ...overrides
    };
}

test("recognizes a status URL and canonicalizes its host, query, hash, and timestamp", () => {
    const preview = extractXPreview(message({
        embeds: [{
            url: "http://mobile.twitter.com/actual_handle/status/123456?utm_source=discord#fragment",
            author: { name: "Display Name (@actual_handle) on X" },
            description: "A readable post from the normalized embed.",
            timestamp: new Date("2025-01-02T03:04:05.000Z")
        }]
    }));

    assert.deepEqual(preview, {
        url: "https://x.com/actual_handle/status/123456",
        authorName: "Display Name",
        handle: "actual_handle",
        text: "A readable post from the normalized embed.",
        timestamp: 1_735_787_045_000
    });
});

test("accepts valid string and numeric embed timestamps and rejects invalid values", () => {
    const stringTimestamp = extractXPreview(message({
        embeds: [{
            url: "https://x.com/actual_handle/status/43",
            timestamp: "2025-01-02T03:04:05.000Z"
        }]
    }));
    const numericTimestamp = extractXPreview(message({
        embeds: [{
            url: "https://x.com/actual_handle/status/44",
            timestamp: 1_735_787_045_000
        }]
    }));
    const invalidTimestamp = extractXPreview(message({
        embeds: [{
            url: "https://x.com/actual_handle/status/45",
            timestamp: "not-a-date"
        }]
    }));

    assert.equal(stringTimestamp?.timestamp, 1_735_787_045_000);
    assert.equal(numericTimestamp?.timestamp, 1_735_787_045_000);
    assert.equal(invalidTimestamp?.timestamp, undefined);
});

test("rejects invalid Date values and dates outside the ECMAScript range", () => {
    assert.equal(normalizeXPreviewTimestamp(new Date("invalid")), undefined);
    assert.equal(normalizeXPreviewTimestamp(8_700_000_000_000_000), undefined);
    assert.equal(normalizeXPreviewTimestamp(-1), undefined);
    assert.equal(normalizeXPreviewTimestamp(8_640_000_000_000_000), 8_640_000_000_000_000);
});

test("prefers normalized text over raw provider metadata", () => {
    const preview = extractXPreview(message({
        embeds: [{
            url: "https://x.com/actual_handle/status/42",
            author: { name: "Display Name (@actual_handle)" },
            description: "Normalized human-readable text",
            rawDescription: "raw provider metadata https://t.co/opaque"
        }]
    }));

    assert.equal(preview?.text, "Normalized human-readable text");
});

test("does not leak Discord sender content into structured tweet text", () => {
    const preview = extractXPreview(message({
        content: "Forwarded by Discord Sender. This must not be tweet text.",
        embeds: [{
            url: "https://x.com/actual_handle/status/42",
            author: { name: "Display Name (@actual_handle)" },
            description: "The post text comes from the X embed."
        }]
    }));

    assert.equal(preview?.text, "The post text comes from the X embed.");
});

test("keeps Discord sender context separate from the X preview", () => {
    const source = extractXPreviewSource(message({
        content: "https://x.com/actual_handle/status/42?s=46\n\nitu udah bisa mint blm sih??",
        embeds: [{
            url: "https://x.com/actual_handle/status/42",
            description: "The post text comes from the X embed."
        }]
    }));
    const urlOnlySource = extractXPreviewSource(message({
        content: "https://x.com/actual_handle/status/42?s=46",
        embeds: [{ url: "https://x.com/actual_handle/status/42" }]
    }));
    const autolinkOnlySource = extractXPreviewSource(message({
        content: "<https://x.com/actual_handle/status/42?s=46>",
        embeds: [{ url: "https://x.com/actual_handle/status/42" }]
    }));

    assert.equal(source?.discordContext, "itu udah bisa mint blm sih??");
    assert.equal(urlOnlySource?.discordContext, undefined);
    assert.equal(autolinkOnlySource?.discordContext, undefined);
    const wrappedContentSource = extractXPreviewSource(message({
        content: "<https://x.com/wrapped_handle/status/49?s=46>",
        embeds: []
    }));
    assert.equal(wrappedContentSource?.preview.url, "https://x.com/wrapped_handle/status/49");
});

test("parses common X author forms and falls back to the URL handle", () => {
    assert.deepEqual(parseXAuthor("Display Name (@actual_handle) on X", "url_handle"), {
        authorName: "Display Name",
        handle: "actual_handle"
    });
    assert.deepEqual(parseXAuthor("Display Name (@actual_handle)", "url_handle"), {
        authorName: "Display Name",
        handle: "actual_handle"
    });
    assert.deepEqual(parseXAuthor(undefined, "url_handle"), {
        authorName: "url_handle",
        handle: "url_handle"
    });
    assert.deepEqual(parseXAuthor("Display Name", "url_handle"), {
        authorName: "Display Name",
        handle: "url_handle"
    });
});

test("keeps twitter.com compatibility", () => {
    const preview = extractXPreview(message({
        embeds: [{
            url: "https://www.twitter.com/compatibility/status/99",
            description: "Compatible post"
        }]
    }));

    assert.equal(preview?.url, "https://x.com/compatibility/status/99");
});

test("falls back for malformed, non-status, and unsupported status URLs", () => {
    for (const url of [
        "https://example.com/actual_handle/status/42",
        "https://evilx.com/actual_handle/status/42",
        "https://constructor/actual_handle/status/42",
        "https://x.com/actual_handle/post/42",
        "https://x.com/actual_handle/status/not-a-number",
        "ftp://x.com/actual_handle/status/42",
        "https://x.com/actual_handle/status/42/extra",
        "https://x.com/actual_handle/status/42/",
        "https://x.com//status/42"
    ]) {
        assert.equal(extractXPreview(message({ embeds: [{ url, description: "Not promoted" }] })), undefined, url);
    }
});

test("does not render a status URL with a query as post text", () => {
    const preview = extractXPreview(message({
        embeds: [{
            url: "https://x.com/actual_handle/status/42",
            rawDescription: "https://twitter.com/actual_handle/status/42?ref=discord#preview"
        }]
    }));

    assert.deepEqual(preview, {
        url: "https://x.com/actual_handle/status/42",
        authorName: "actual_handle",
        handle: "actual_handle"
    });
});

test("removes an inline raw status URL from structured post text", () => {
    const preview = extractXPreview(message({
        embeds: [{
            url: "https://x.com/actual_handle/status/42",
            description: "Readable post text https://twitter.com/actual_handle/status/42?ref=discord"
        }]
    }));

    assert.equal(preview?.text, "Readable post text");
});

test("associates the structured preview with its matching embed", () => {
    const source = extractXPreviewSource(message({
        embeds: [
            { url: "https://example.com/unrelated", description: "Other embed" },
            { url: "https://x.com/actual_handle/status/42", description: "Status embed" }
        ]
    }));

    assert.equal(source?.embedIndex, 1);
    assert.equal(source?.preview.text, "Status embed");
});

test("strips standalone and inline X status URLs from extracted quote text", () => {
    const standalone = extractXPreview(message({
        embeds: [{
            url: "https://x.com/actual_handle/status/42",
            fields: [{
                name: "Quoted post",
                value: "Quoted Name (@quoted_handle)\nhttps://twitter.com/quoted_handle/status/77?ref=discord#quote"
            }]
        }]
    }));
    const inline = extractXPreview(message({
        embeds: [{
            url: "https://x.com/actual_handle/status/42",
            fields: [{
                name: "Quoted post",
                value: "Quoted Name (@quoted_handle)\nQuoted content https://x.com/quoted_handle/status/77?ref=discord"
            }]
        }]
    }));

    assert.equal(standalone?.quote, undefined);
    assert.deepEqual(inline?.quote, {
        authorName: "Quoted Name",
        handle: "quoted_handle",
        text: "Quoted content"
    });
});

test("keeps generic body behavior when no valid X status exists", () => {
    const genericMessage = message({
        content: "A normal Discord notification.",
        embeds: [{ title: "Rich title", description: "Rich description" }]
    });

    assert.equal(extractXPreview(genericMessage), undefined);
    assert.equal(getMessageText(genericMessage), "A normal Discord notification.\nRich title\nRich description");
});

test("sanitizes persisted preview data, timestamps, quotes, and older records", () => {
    assert.deepEqual(sanitizePersistedXPreview({
        url: "https://twitter.com/actual_handle/status/42?ref=discord",
        authorName: "Display Name",
        handle: "actual_handle",
        text: "Persisted post",
        timestamp: 1_735_787_045_000,
        quote: {
            authorName: "Quoted Name",
            handle: "quoted_handle",
            text: "https://x.com/quoted_handle/status/77?ref=discord"
        }
    }), {
        url: "https://x.com/actual_handle/status/42",
        authorName: "Display Name",
        handle: "actual_handle",
        text: "Persisted post",
        timestamp: 1_735_787_045_000
    });
    assert.deepEqual(sanitizePersistedXPreview({
        url: "https://x.com/actual_handle/status/42",
        authorName: "Display Name",
        handle: "actual_handle",
        text: "https://twitter.com/actual_handle/status/42?ref=discord",
        timestamp: Number.NaN
    }), {
        url: "https://x.com/actual_handle/status/42",
        authorName: "Display Name",
        handle: "actual_handle"
    });
    assert.deepEqual(sanitizePersistedXPreview({
        url: "https://x.com/actual_handle/status/42",
        authorName: "Display Name",
        handle: "actual_handle",
        quote: {
            authorName: "Quoted Name",
            handle: "quoted_handle",
            text: "Quoted text https://twitter.com/quoted_handle/status/77?ref=discord"
        }
    }), {
        url: "https://x.com/actual_handle/status/42",
        authorName: "Display Name",
        handle: "actual_handle",
        quote: {
            authorName: "Quoted Name",
            handle: "quoted_handle",
            text: "Quoted text"
        }
    });
    assert.equal(sanitizePersistedXPreview({ url: "https://x.com/actual_handle/status/not-a-number" }), undefined);
    assert.equal(sanitizePersistedXPreview(undefined), undefined);
});
