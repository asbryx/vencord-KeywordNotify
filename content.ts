export type NotificationMentionKind = "user" | "role" | "channel";

export type NotificationTextSegment =
    | { type: "text"; value: string; }
    | { type: "link"; value: string; label?: string; }
    | { type: "mention"; kind: NotificationMentionKind; value: string; };

export interface NotificationMentions {
    users?: Record<string, string>;
    roles?: Record<string, string>;
    channels?: Record<string, string>;
}

const contentPattern = /\[([^\]\n]+)]\((https?:\/\/(?:[^\s()]|\([^()\s]*\))+)\)|https?:\/\/[^\s<>"']+|<t:(\d+):R>|<@&\d+>|<@!?\d+>|<#\d+>/g;
const trailingSentencePunctuationPattern = /[.!?,;:]+$/;

function trimTrailingUrlPunctuation(value: string) {
    let url = value.replace(trailingSentencePunctuationPattern, "");
    const delimiterPairs = [["(", ")"], ["[", "]"], ["{", "}"]] as const;

    for (const [open, close] of delimiterPairs) {
        while (url.endsWith(close) && url.split(close).length > url.split(open).length) {
            url = url.slice(0, -1);
        }
    }

    return url;
}

function resolveMention(value: string, mentions: NotificationMentions): NotificationTextSegment {
    const id = value.match(/\d+/)?.[0];
    if (value.startsWith("<@&")) {
        return { type: "mention", kind: "role", value: `@${id && mentions.roles?.[id] || "unknown-role"}` };
    }
    if (value.startsWith("<#")) {
        return { type: "mention", kind: "channel", value: `#${id && mentions.channels?.[id] || "unknown-channel"}` };
    }
    return { type: "mention", kind: "user", value: `@${id && mentions.users?.[id] || "unknown-user"}` };
}

function formatRelativeTimestamp(timestampSeconds: number, nowMs: number) {
    const elapsedSeconds = Math.round((nowMs - timestampSeconds * 1000) / 1000);
    const future = elapsedSeconds < 0;
    const absoluteSeconds = Math.abs(elapsedSeconds);
    const [amount, unit] = absoluteSeconds < 60
        ? [absoluteSeconds, "second"]
        : absoluteSeconds < 3_600
            ? [Math.round(absoluteSeconds / 60), "minute"]
            : absoluteSeconds < 86_400
                ? [Math.round(absoluteSeconds / 3_600), "hour"]
                : [Math.round(absoluteSeconds / 86_400), "day"];
    const suffix = amount === 1 ? unit : `${unit}s`;
    return future ? `in ${amount} ${suffix}` : `${amount} ${suffix} ago`;
}

export function splitNotificationText(
    text: string,
    mentions: NotificationMentions = {},
    nowMs = Date.now()
): NotificationTextSegment[] {
    const segments: NotificationTextSegment[] = [];
    let textStart = 0;

    for (const match of text.matchAll(contentPattern)) {
        const matchStart = match.index!;
        const matchedValue = match[0];
        const markdownUrl = match[2];
        const value = matchedValue.startsWith("http") ? trimTrailingUrlPunctuation(matchedValue) : matchedValue;

        if (textStart < matchStart) segments.push({ type: "text", value: text.slice(textStart, matchStart) });
        if (markdownUrl) segments.push({ type: "link", value: markdownUrl, label: match[1] });
        else if (value.startsWith("http")) segments.push({ type: "link", value });
        else if (match[3]) segments.push({ type: "text", value: formatRelativeTimestamp(Number(match[3]), nowMs) });
        else segments.push(resolveMention(value, mentions));

        textStart = matchStart + (markdownUrl || match[3] || !matchedValue.startsWith("http") ? matchedValue.length : value.length);
    }

    if (textStart < text.length || segments.length === 0) {
        segments.push({ type: "text", value: text.slice(textStart) });
    }
    return segments;
}

export function formatNotificationText(text: string, mentions: NotificationMentions = {}) {
    return splitNotificationText(text, mentions).map(segment => segment.value).join("");
}
