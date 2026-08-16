import { sanitizePersistedNotificationImage } from "./media";

export type MessageSnapshotMediaKind = "image" | "thumbnail" | "attachment";

export interface MessageSnapshotMedia {
    kind: MessageSnapshotMediaKind;
    previewUrl: string;
    targetUrl: string;
    width?: number;
    height?: number;
    description?: string;
}

export interface MessageSnapshotField {
    name: string;
    value: string;
    inline: boolean;
}

export interface MessageSnapshotEmbed {
    sourceIndex?: number;
    type?: string;
    url?: string;
    color?: string;
    author?: {
        name: string;
        url?: string;
        iconUrl?: string;
    };
    title?: string;
    description?: string;
    fields: MessageSnapshotField[];
    media?: MessageSnapshotMedia[];
    footer?: {
        text: string;
        iconUrl?: string;
    };
    timestamp?: number;
}

export interface MessageSnapshot {
    content: string;
    embeds: MessageSnapshotEmbed[];
    attachments: MessageSnapshotMedia[];
}

interface SourceMedia {
    width?: unknown;
    height?: unknown;
    url?: unknown;
    proxyURL?: unknown;
    proxy_url?: unknown;
    description?: unknown;
    contentType?: unknown;
    content_type?: unknown;
    filename?: unknown;
    srcIsAnimated?: unknown;
}

interface SourceEmbed {
    type?: unknown;
    url?: unknown;
    color?: unknown;
    author?: unknown;
    footer?: unknown;
    timestamp?: unknown;
    title?: unknown;
    rawTitle?: unknown;
    description?: unknown;
    rawDescription?: unknown;
    fields?: unknown;
    image?: unknown;
    images?: unknown;
    thumbnail?: unknown;
}

interface SourceMessage {
    id?: unknown;
    content?: unknown;
    embeds?: unknown;
    attachments?: unknown;
}

export interface MessageSnapshotMediaUpdate {
    messageId: string;
    embeds?: Array<MessageSnapshotEmbed | undefined>;
    attachments?: MessageSnapshotMedia[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getHttpUrl(value: unknown) {
    const string = getString(value);
    if (!string) return;
    try {
        const protocol = new URL(string).protocol;
        return protocol === "https:" || protocol === "http:" ? string : undefined;
    } catch {
        return;
    }
}

function getDimension(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function getTimestamp(value: unknown) {
    const timestamp = value instanceof Date ? value.getTime() : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) ? timestamp : undefined;
}

function getColor(value: unknown) {
    return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : undefined;
}

function getProxyUrl(media: SourceMedia) {
    return getString(media.proxyURL) ?? getString(media.proxy_url) ?? getString(media.url);
}

function hasAnimatedMediaMetadata(media: SourceMedia) {
    const contentType = getString(media.content_type) ?? getString(media.contentType);
    const filename = getString(media.filename);
    return media.srcIsAnimated === true
        || contentType?.toLowerCase().startsWith("image/gif") === true
        || /\.(?:gif|gifv)$/i.test(filename ?? "");
}

function createMedia(value: unknown, kind: MessageSnapshotMediaKind, targetUrl?: unknown, fallbackDescription?: unknown) {
    if (!isRecord(value)) return;
    const media = value as SourceMedia;
    if (hasAnimatedMediaMetadata(media)) return;
    const previewUrl = getProxyUrl(media);
    if (!previewUrl) return;
    const sanitized = sanitizePersistedNotificationImage(previewUrl, getHttpUrl(targetUrl) ?? getHttpUrl(media.url) ?? previewUrl);
    if (!sanitized) return;

    const width = getDimension(media.width);
    const height = getDimension(media.height);
    const description = getString(media.description) ?? getString(fallbackDescription);
    return {
        kind,
        ...sanitized,
        ...(width == null ? {} : { width }),
        ...(height == null ? {} : { height }),
        ...(description == null ? {} : { description })
    } satisfies MessageSnapshotMedia;
}

function createEmbedMedia(embed: SourceEmbed) {
    if (getString(embed.type)?.toLowerCase() === "gifv") return [];
    const media: MessageSnapshotMedia[] = [];
    const append = (value: unknown, kind: MessageSnapshotMediaKind) => {
        const item = createMedia(value, kind, embed.url);
        if (item && !media.some(existing => existing.previewUrl === item.previewUrl)) media.push(item);
    };

    append(embed.image, "image");
    if (Array.isArray(embed.images)) for (const image of embed.images) append(image, "image");
    append(embed.thumbnail, "thumbnail");
    return media;
}

function createAttachmentMedia(value: unknown) {
    if (!isRecord(value)) return;
    const contentType = getString(value.content_type) ?? getString(value.contentType);
    if (!contentType?.toLowerCase().startsWith("image/")) return;
    return createMedia(value, "attachment", value.url, value.filename);
}

function createAuthor(value: unknown) {
    if (!isRecord(value)) return;
    const name = getString(value.name);
    if (!name) return;
    const url = getHttpUrl(value.url);
    const iconUrl = sanitizePersistedNotificationImage(value.iconProxyURL ?? value.proxy_icon_url ?? value.iconURL ?? value.icon_url, undefined)?.previewUrl;
    return {
        name,
        ...(url == null ? {} : { url }),
        ...(iconUrl == null ? {} : { iconUrl })
    };
}

function createFooter(value: unknown) {
    if (!isRecord(value)) return;
    const text = getString(value.text);
    if (!text) return;
    const iconUrl = sanitizePersistedNotificationImage(value.iconProxyURL ?? value.proxy_icon_url ?? value.iconURL ?? value.icon_url, undefined)?.previewUrl;
    return { text, ...(iconUrl == null ? {} : { iconUrl }) };
}

function createFields(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap(field => {
        if (!isRecord(field)) return [];
        const name = getString(field.rawName) ?? getString(field.name);
        const fieldValue = getString(field.rawValue) ?? getString(field.value);
        if (!name || !fieldValue) return [];
        return [{ name, value: fieldValue, inline: field.inline === true }];
    });
}

function createEmbed(value: unknown, sourceIndex: number): MessageSnapshotEmbed | undefined {
    if (!isRecord(value)) return;
    const embed = value as SourceEmbed;
    const type = getString(embed.type);
    const url = getHttpUrl(embed.url);
    const color = getColor(embed.color);
    const author = createAuthor(embed.author);
    const title = getString(embed.rawTitle) ?? getString(embed.title);
    const description = getString(embed.rawDescription) ?? getString(embed.description);
    const fields = createFields(embed.fields);
    const media = createEmbedMedia(embed);
    const footer = createFooter(embed.footer);
    const timestamp = getTimestamp(embed.timestamp);

    if (!author && !title && !description && fields.length === 0 && media.length === 0 && !footer) return;
    return {
        sourceIndex,
        ...(type == null ? {} : { type }),
        ...(url == null ? {} : { url }),
        ...(color == null ? {} : { color }),
        ...(author == null ? {} : { author }),
        ...(title == null ? {} : { title }),
        ...(description == null ? {} : { description }),
        fields,
        ...(media.length === 0 ? {} : { media }),
        ...(footer == null ? {} : { footer }),
        ...(timestamp == null ? {} : { timestamp })
    };
}

export function createMessageSnapshot(message: SourceMessage): MessageSnapshot {
    return {
        content: typeof message.content === "string" ? message.content : "",
        embeds: Array.isArray(message.embeds)
            ? message.embeds.flatMap((embed, sourceIndex) => createEmbed(embed, sourceIndex) ?? [])
            : [],
        attachments: Array.isArray(message.attachments) ? message.attachments.flatMap(attachment => createAttachmentMedia(attachment) ?? []) : []
    };
}

function sanitizeMedia(value: unknown): MessageSnapshotMedia | undefined {
    if (!isRecord(value)) return;
    const kind = value.kind;
    if (kind !== "image" && kind !== "thumbnail" && kind !== "attachment") return;
    const sanitized = sanitizePersistedNotificationImage(value.previewUrl, value.targetUrl);
    if (!sanitized) return;
    const width = getDimension(value.width);
    const height = getDimension(value.height);
    const description = getString(value.description);
    return {
        kind,
        ...sanitized,
        ...(width == null ? {} : { width }),
        ...(height == null ? {} : { height }),
        ...(description == null ? {} : { description })
    };
}

function sanitizeEmbed(value: unknown): MessageSnapshotEmbed | undefined {
    if (!isRecord(value)) return;
    const sourceIndex = typeof value.sourceIndex === "number" && Number.isSafeInteger(value.sourceIndex) && value.sourceIndex >= 0
        ? value.sourceIndex
        : undefined;
    const type = getString(value.type);
    const url = getHttpUrl(value.url);
    const color = getColor(value.color);
    const author = createAuthor(value.author);
    const title = getString(value.title);
    const description = getString(value.description);
    const fields = createFields(value.fields);
    const hadMedia = Object.prototype.hasOwnProperty.call(value, "media");
    const media = Array.isArray(value.media) ? value.media.flatMap(item => sanitizeMedia(item) ?? []) : [];
    const footer = createFooter(value.footer);
    const timestamp = getTimestamp(value.timestamp);
    if (!author && !title && !description && fields.length === 0 && media.length === 0 && !footer) return;
    return {
        ...(sourceIndex == null ? {} : { sourceIndex }),
        ...(type == null ? {} : { type }),
        ...(url == null ? {} : { url }),
        ...(color == null ? {} : { color }),
        ...(author == null ? {} : { author }),
        ...(title == null ? {} : { title }),
        ...(description == null ? {} : { description }),
        fields,
        ...(!hadMedia && media.length === 0 ? {} : { media }),
        ...(footer == null ? {} : { footer }),
        ...(timestamp == null ? {} : { timestamp })
    };
}

export function sanitizeMessageSnapshot(value: unknown): MessageSnapshot | undefined {
    if (!isRecord(value) || !Array.isArray(value.embeds)) return;
    const sourceIndexes = new Set<number>();
    const embeds = value.embeds.flatMap((embed, index) => {
        const sanitized = sanitizeEmbed(embed);
        if (!sanitized) return [];
        const sourceIndex = sanitized.sourceIndex ?? index;
        if (sourceIndexes.has(sourceIndex)) return [];
        sourceIndexes.add(sourceIndex);
        return [{ ...sanitized, sourceIndex }];
    });
    return {
        content: typeof value.content === "string" ? value.content : "",
        embeds,
        attachments: Array.isArray(value.attachments) ? value.attachments.flatMap(media => sanitizeMedia(media) ?? []) : []
    };
}

export function createMessageSnapshotMediaUpdate(value: unknown): MessageSnapshotMediaUpdate | undefined {
    if (!isRecord(value)) return;
    const messageId = getString(value.id);
    if (!messageId) return;
    const embeds = Array.isArray(value.embeds)
        ? value.embeds.map((embed, sourceIndex) => createEmbed(embed, sourceIndex))
        : undefined;
    const attachments = Array.isArray(value.attachments)
        ? value.attachments.flatMap(attachment => createAttachmentMedia(attachment) ?? [])
        : undefined;
    return {
        messageId,
        ...(embeds == null ? {} : { embeds }),
        ...(attachments == null ? {} : { attachments })
    };
}

export function updateMessageSnapshotMedia(snapshot: MessageSnapshot, update: MessageSnapshotMediaUpdate): MessageSnapshot {
    if (update.embeds == null && update.attachments == null) return snapshot;

    let embeds = snapshot.embeds;
    if (update.embeds != null) {
        const existingBySourceIndex = new Map<number, MessageSnapshotEmbed>();
        snapshot.embeds.forEach((embed, index) => existingBySourceIndex.set(embed.sourceIndex ?? index, embed));
        embeds = update.embeds.flatMap((updated, sourceIndex) => {
            if (!updated) return [];
            const existing = existingBySourceIndex.get(sourceIndex);
            if (!existing) return [updated];

            const { media: _, ...withoutMedia } = existing;
            return [{
                ...withoutMedia,
                sourceIndex: updated.sourceIndex ?? sourceIndex,
                ...(updated.media?.length ? { media: updated.media } : {})
            }];
        });
    }

    return {
        ...snapshot,
        embeds,
        ...(update.attachments == null ? {} : { attachments: update.attachments })
    };
}

function plainText(value: string) {
    return value
        .replace(/\[([^\]\n]+)]\((https?:\/\/(?:[^\s()]|\([^()\s]*\))+)\)/g, "$1")
        .replace(/<a?:([^:>]+):\d+>/g, ":$1:")
        .replace(/\*\*|__|~~|`/g, "")
        .replace(/^-#\s*/gm, "")
        .trim();
}

export function formatMessageSnapshotText(snapshot: MessageSnapshot) {
    const lines: string[] = [];
    const append = (value: string | undefined) => {
        const formatted = value && plainText(value);
        if (formatted) lines.push(formatted);
    };
    append(snapshot.content);
    for (const embed of snapshot.embeds) {
        append(embed.title);
        append(embed.description);
        for (const field of embed.fields) append(`${plainText(field.name)}: ${plainText(field.value)}`);
    }
    return lines.join("\n") || "Matched a configured keyword.";
}
