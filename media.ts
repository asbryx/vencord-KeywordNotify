import { getCanonicalXStatusUrlFromEmbed } from "./xPreview";

interface NotificationMedia {
    proxyURL?: string;
    proxy_url?: string;
    url?: string;
    contentType?: string;
    srcIsAnimated?: boolean;
}

interface NotificationAttachment extends NotificationMedia {
    content_type?: string;
    filename?: string;
}

interface NotificationEmbed {
    type?: string;
    url?: string;
    title?: string;
    description?: string;
    rawTitle?: string;
    rawDescription?: string;
    fields?: Array<{
        value?: string;
        rawValue?: string;
    }>;
    image?: NotificationMedia;
    images?: NotificationMedia[];
    thumbnail?: NotificationMedia;
}

interface NotificationMediaSource {
    attachments?: NotificationAttachment[];
    embeds?: NotificationEmbed[];
}

interface NotificationImageUpdate {
    messageId: string;
    image: NotificationImage;
}

export interface NotificationImage {
    previewUrl: string;
    targetUrl: string;
}

export function isDiscordMediaUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") return false;
        const hostname = url.hostname;
        return hostname === "discord.com"
            || hostname.endsWith(".discord.com")
            || hostname === "discordapp.com"
            || hostname.endsWith(".discordapp.com")
            || hostname === "discordapp.net"
            || hostname.endsWith(".discordapp.net");
    } catch {
        return false;
    }
}

function isHttpUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    try {
        const protocol = new URL(value).protocol;
        return protocol === "https:" || protocol === "http:";
    } catch {
        return false;
    }
}

const ANIMATED_MEDIA_HOSTS = new Set(["giphy.com", "klipy.com", "tenor.com"]);

function isAnimatedMediaUrl(value: unknown) {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase();
        return [...ANIMATED_MEDIA_HOSTS].some(host => hostname === host || hostname.endsWith(`.${host}`))
            || /\.(?:gif|gifv)(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
    } catch {
        return false;
    }
}


function isAnimatedMedia(media: NotificationMedia | undefined) {
    return media?.srcIsAnimated === true
        || (typeof media?.contentType === "string" && media.contentType.toLowerCase() === "image/gif")
        || isAnimatedMediaUrl(media?.url)
        || isAnimatedMediaUrl(media?.proxyURL)
        || isAnimatedMediaUrl(media?.proxy_url);
}

function isAnimatedAttachment(attachment: NotificationAttachment) {
    return (typeof attachment.content_type === "string" && attachment.content_type.toLowerCase() === "image/gif")
        || (typeof attachment.filename === "string" && /\.gif$/i.test(attachment.filename))
        || isAnimatedMedia(attachment);
}

function getEmbedMedia(embed: NotificationEmbed) {
    return [embed.image, ...(Array.isArray(embed.images) ? embed.images : []), embed.thumbnail]
        .filter(candidate => candidate != null && typeof candidate === "object" && !Array.isArray(candidate)) as NotificationMedia[];
}

function isAnimatedEmbed(embed: NotificationEmbed) {
    return (typeof embed.type === "string" && embed.type.toLowerCase() === "gifv")
        || isAnimatedMediaUrl(embed.url)
        || getEmbedMedia(embed).some(isAnimatedMedia);
}

export function sanitizePersistedNotificationImage(previewUrl: unknown, targetUrl: unknown): NotificationImage | undefined {
    if (!isDiscordMediaUrl(previewUrl) || isAnimatedMediaUrl(previewUrl) || isAnimatedMediaUrl(targetUrl)) return undefined;
    return { previewUrl, targetUrl: isHttpUrl(targetUrl) ? targetUrl : previewUrl };
}

function getPreviewUrl(media: NotificationMedia | undefined) {
    const proxyUrl = media?.proxyURL || media?.proxy_url;
    if (proxyUrl && isDiscordMediaUrl(proxyUrl)) return proxyUrl;
    if (media?.url && isDiscordMediaUrl(media.url)) return media.url;
    return undefined;
}

export function selectNotificationImage(source: NotificationMediaSource): NotificationImage | undefined {
    const attachment = source.attachments?.find(candidate =>
        typeof candidate.content_type === "string" && candidate.content_type.startsWith("image/")
        && !isAnimatedAttachment(candidate)
        && getPreviewUrl(candidate)
    );
    if (attachment) {
        const previewUrl = getPreviewUrl(attachment)!;
        return sanitizePersistedNotificationImage(previewUrl, attachment.url || previewUrl);
    }

    for (const embed of source.embeds ?? []) {
        if (isAnimatedEmbed(embed)) continue;
        const media = getEmbedMedia(embed).find(candidate => getPreviewUrl(candidate));
        if (!media) continue;

        const previewUrl = getPreviewUrl(media)!;
        return sanitizePersistedNotificationImage(previewUrl, embed.url || media.url || previewUrl);
    }
    return undefined;
}

export function selectXPreviewImage(embeds: readonly NotificationEmbed[] | undefined, embedIndex: number): NotificationImage | undefined {
    if (!Number.isInteger(embedIndex) || embedIndex < 0) return undefined;
    const embed = embeds?.[embedIndex];
    if (!embed || isAnimatedEmbed(embed)) return undefined;

    const media = getEmbedMedia(embed).find(candidate => getPreviewUrl(candidate));
    if (!media) return undefined;

    const previewUrl = getPreviewUrl(media)!;
    const targetUrl = getCanonicalXStatusUrlFromEmbed(embed) ?? embed.url ?? media.url ?? previewUrl;
    return sanitizePersistedNotificationImage(previewUrl, targetUrl);
}

export function selectXPreviewImageUpdate(value: unknown): { messageId: string; xPreviewUrl: string; image: NotificationImage; } | undefined {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const message = value as { id?: unknown; embeds?: unknown; };
    if (typeof message.id !== "string" || message.id.length === 0 || !Array.isArray(message.embeds)) return undefined;

    for (const embed of message.embeds ?? []) {
        const xPreviewUrl = getCanonicalXStatusUrlFromEmbed(embed);
        if (!xPreviewUrl) continue;
        const image = selectXPreviewImage([embed], 0);
        if (image) return {
            messageId: message.id,
            xPreviewUrl,
            image: { ...image, targetUrl: xPreviewUrl }
        };
    }
    return undefined;
}

export function selectNotificationImageUpdate(value: unknown): NotificationImageUpdate | undefined {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const message = value as { id?: unknown; attachments?: unknown; embeds?: unknown; };
    if (typeof message.id !== "string" || message.id.length === 0) return undefined;

    const attachments = Array.isArray(message.attachments)
        ? message.attachments.filter(candidate => candidate != null && typeof candidate === "object" && !Array.isArray(candidate)) as NotificationAttachment[]
        : undefined;
    const embeds = Array.isArray(message.embeds)
        ? message.embeds.filter(candidate => candidate != null && typeof candidate === "object" && !Array.isArray(candidate)) as NotificationEmbed[]
        : undefined;
    const image = selectNotificationImage({ attachments, embeds });
    return image ? { messageId: message.id, image } : undefined;
}
