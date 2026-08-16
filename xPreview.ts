import type { KeywordMessage } from "./matcher";

export interface XQuotePreview {
    authorName: string;
    handle: string;
    text: string;
}

export interface XPreview {
    url: string;
    authorName: string;
    handle: string;
    text?: string;
    quote?: XQuotePreview;
    timestamp?: number;
}

export interface XPreviewSource {
    preview: XPreview;
    embedIndex: number;
    discordContext?: string;
}

interface XStatusUrl {
    url: string;
    handle: string;
}

interface XEmbedField {
    name?: string | null;
    value?: string | null;
    rawName?: string | null;
    rawValue?: string | null;
}

interface XEmbed {
    url?: string | null;
    title?: string | null;
    description?: string | null;
    rawTitle?: string | null;
    rawDescription?: string | null;
    author?: { name?: string | null; } | null;
    fields?: XEmbedField[] | null;
    timestamp?: Date | string | number | null;
}

const X_STATUS_HOSTS: Record<string, true> = {
    "x.com": true,
    "www.x.com": true,
    "mobile.x.com": true,
    "twitter.com": true,
    "www.twitter.com": true,
    "mobile.twitter.com": true
};
const xHandlePattern = /^[A-Za-z0-9_]+$/;
const statusUrlPattern = /<?https?:\/\/[^\s<>"'`]+>?/gi;
const trailingUrlPunctuationPattern = /[),.!?;:\]]+$/;
const xAuthorPattern = /^(.*?)\s*\(@([A-Za-z0-9_]+)\)(?:\s+on\s+X)?$/i;
const xHandleOnlyPattern = /^@([A-Za-z0-9_]+)$/;
const quoteFieldPattern = /\b(?:quoted|quote)\s+(?:post|tweet)\b|\bquote\b/i;
const MAX_ECMASCRIPT_DATE_MS = 8_640_000_000_000_000;


function asText(value: unknown) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function trimUrlCandidate(value: string) {
    return value.replace(trailingUrlPunctuationPattern, "");
}

function getXStatusUrl(value: unknown): XStatusUrl | undefined {
    if (typeof value !== "string") return undefined;

    const candidate = value.startsWith("<") && value.endsWith(">") ? value.slice(1, -1) : value;
    let parsed: URL;
    try {
        parsed = new URL(trimUrlCandidate(candidate));
    } catch {
        return undefined;
    }
    if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        || !Object.prototype.hasOwnProperty.call(X_STATUS_HOSTS, parsed.hostname.toLowerCase())
    ) return undefined;
    if (parsed.pathname.endsWith("/")) return undefined;

    const path = parsed.pathname.split("/").filter(Boolean);
    const [handle, statusSegment, id] = path;
    if (path.length !== 3 || !handle || statusSegment !== "status" || !/^\d+$/.test(id) || !xHandlePattern.test(handle)) return undefined;

    return {
        url: `https://x.com/${handle}/status/${id}`,
        handle
    };
}

function getXStatusUrlFromText(value: unknown) {
    if (typeof value !== "string") return undefined;
    for (const candidate of value.matchAll(statusUrlPattern)) {
        const status = getXStatusUrl(candidate[0]);
        if (status) return status;
    }
    return undefined;
}

export function getCanonicalXStatusUrl(value: unknown) {
    return getXStatusUrl(value)?.url;
}

export function normalizeXPreviewTimestamp(value: unknown) {
    const timestamp = value instanceof Date
        ? value.getTime()
        : typeof value === "string"
            ? Date.parse(value)
            : value;
    if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAX_ECMASCRIPT_DATE_MS) return undefined;
    return new Date(timestamp).getTime() === timestamp ? timestamp : undefined;
}


export function parseXAuthor(value: unknown, fallbackHandle: string) {
    const author = asText(value);
    const parsed = author?.match(xAuthorPattern);
    if (parsed) {
        const authorName = parsed[1].trim();
        return {
            authorName: authorName || parsed[2],
            handle: parsed[2]
        };
    }

    const handleOnly = author?.match(xHandleOnlyPattern);
    if (handleOnly) return { authorName: handleOnly[1], handle: handleOnly[1] };
    return { authorName: author ?? fallbackHandle, handle: fallbackHandle };
}

function getTextCandidate(value: unknown) {
    const text = asText(value);
    if (!text) return undefined;
    const withoutStatusUrls = text.replace(statusUrlPattern, candidate => getXStatusUrl(candidate) ? "" : candidate).trim();
    return withoutStatusUrls ? withoutStatusUrls.replace(/[ \t]{2,}/g, " ") : undefined;
}

function getFieldValue(field: XEmbedField) {
    return asText(field.value) ?? asText(field.rawValue);
}

function getQuote(field: XEmbedField, fallbackHandle: string): XQuotePreview | undefined {
    if (!quoteFieldPattern.test(field.name ?? field.rawName ?? "")) return undefined;
    const value = getFieldValue(field);
    if (!value) return undefined;

    const [authorLine, ...textLines] = value.split("\n");
    const text = getTextCandidate(textLines.join("\n"));
    if (!text) return undefined;
    const author = parseXAuthor(authorLine, fallbackHandle);
    return { ...author, text };
}

function getPreviewText(embed: XEmbed) {
    const normalizedField = embed.fields?.find(field => /\b(?:post|tweet|text|content)\b/i.test(field.name ?? ""));
    return getTextCandidate(embed.description)
        ?? getTextCandidate(normalizedField?.value)
        ?? getTextCandidate(embed.title)
        ?? getTextCandidate(embed.rawDescription)
        ?? getTextCandidate(normalizedField?.rawValue)
        ?? getTextCandidate(embed.rawTitle);
}

function getEmbedStatusUrl(embed: XEmbed) {
    return getXStatusUrl(embed.url)
        ?? getXStatusUrlFromText(embed.description)
        ?? getXStatusUrlFromText(embed.title)
        ?? getXStatusUrlFromText(embed.rawDescription)
        ?? getXStatusUrlFromText(embed.rawTitle)
        ?? (Array.isArray(embed.fields)
            ? embed.fields.map(field => field != null && typeof field === "object" && !Array.isArray(field)
                ? getXStatusUrlFromText(field.value) ?? getXStatusUrlFromText(field.rawValue)
                : undefined).find(Boolean)
            : undefined);
}
export function getCanonicalXStatusUrlFromEmbed(value: unknown) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
    return getEmbedStatusUrl(value as XEmbed)?.url;
}

export function extractXPreviewSource(message: KeywordMessage): XPreviewSource | undefined {
    const discordContext = getTextCandidate(message.content);
    const embeds = message.embeds as XEmbed[] | null | undefined;
    for (const [embedIndex, embed] of (embeds ?? []).entries()) {
        const status = getEmbedStatusUrl(embed);
        if (!status) continue;

        const author = parseXAuthor(embed.author?.name, status.handle);
        const text = getPreviewText(embed);
        const quote = embed.fields?.map(field => getQuote(field, status.handle)).find(Boolean);
        const timestamp = normalizeXPreviewTimestamp(embed.timestamp);

        return {
            embedIndex,
            ...(discordContext ? { discordContext } : {}),
            preview: {
                url: status.url,
                authorName: author.authorName,
                handle: author.handle,
                ...(text ? { text } : {}),
                ...(quote ? { quote } : {}),
                ...(timestamp != null ? { timestamp } : {})
            }
        };
    }

    const status = getXStatusUrlFromText(message.content);
    if (!status) return undefined;
    return {
        embedIndex: -1,
        ...(discordContext ? { discordContext } : {}),
        preview: {
            url: status.url,
            authorName: status.handle,
            handle: status.handle
        }
    };
}

export function extractXPreview(message: KeywordMessage): XPreview | undefined {
    return extractXPreviewSource(message)?.preview;
}

function sanitizeQuote(value: unknown, fallbackHandle: string): XQuotePreview | undefined {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const quote = value as Partial<XQuotePreview>;
    const text = getTextCandidate(quote.text);
    if (!text) return undefined;
    const author = parseXAuthor(
        asText(quote.authorName) && asText(quote.handle) ? `${quote.authorName} (@${quote.handle})` : undefined,
        fallbackHandle
    );
    return { ...author, text };
}

export function sanitizePersistedXPreview(value: unknown): XPreview | undefined {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const preview = value as Partial<XPreview>;
    const status = getXStatusUrl(preview.url);
    if (!status) return undefined;
    const author = parseXAuthor(
        asText(preview.authorName) && asText(preview.handle) ? `${preview.authorName} (@${preview.handle})` : undefined,
        status.handle
    );

    const text = getTextCandidate(preview.text);
    const quote = sanitizeQuote(preview.quote, status.handle);
    const timestamp = normalizeXPreviewTimestamp(preview.timestamp);
    return {
        url: status.url,
        authorName: author.authorName,
        handle: author.handle,
        ...(text ? { text } : {}),
        ...(quote ? { quote } : {}),
        ...(timestamp != null ? { timestamp } : {})
    };
}
