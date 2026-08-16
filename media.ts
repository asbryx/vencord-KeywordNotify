export interface NotificationImage {
    previewUrl: string;
    targetUrl: string;
}

export function isDiscordMediaUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;

    try {
        const url = new URL(value);
        if (url.protocol !== "https:") return false;
        const hostname = url.hostname.toLowerCase();
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

export function sanitizePersistedNotificationImage(
    previewUrl: unknown,
    targetUrl: unknown
): NotificationImage | undefined {
    if (!isDiscordMediaUrl(previewUrl) || isAnimatedMediaUrl(previewUrl) || isAnimatedMediaUrl(targetUrl)) return;
    return { previewUrl, targetUrl: isHttpUrl(targetUrl) ? targetUrl : previewUrl };
}
