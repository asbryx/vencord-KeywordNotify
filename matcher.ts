export enum ListType {
    BlackList = "BlackList",
    Whitelist = "Whitelist"
}

export interface KeywordEntry {
    regex: string;
    listIds: string[];
    listType: ListType;
    ignoreCase: boolean;
}

interface KeywordAuthor {
    id: string;
    bot?: boolean;
}

interface KeywordEmbedField {
    name?: string | null;
    value?: string | null;
    rawName?: string | null;
    rawValue?: string | null;
}

interface KeywordEmbed {
    url?: string | null;

    type?: string | null;
    title?: string | null;
    description?: string | null;
    rawTitle?: string | null;
    rawDescription?: string | null;
    author?: { name?: string | null; } | null;
    footer?: { text?: string | null; } | null;
    fields?: KeywordEmbedField[] | null;
    timestamp?: Date | string | number | null;
}

export interface KeywordMessage {
    author: KeywordAuthor;
    channel_id: string;
    content?: string | null;
    embeds?: KeywordEmbed[] | null;
}

const urlCandidatePattern = /https?:\/\/[^\s<>"'`]+/gi;
const trailingUrlPunctuationPattern = /[),.!?;:\]]+$/;
const animatedProviderDomains = ["klipy.com", "giphy.com", "tenor.com"];

interface TextRange {
    start: number;
    end: number;
}

function isAnimatedProviderUrl(url: string) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return animatedProviderDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

function getAnimatedProviderUrlRanges(text: string) {
    const ranges: TextRange[] = [];
    for (const match of text.matchAll(urlCandidatePattern)) {
        const candidate = match[0];
        const trailingPunctuation = candidate.match(trailingUrlPunctuationPattern)?.[0] ?? "";
        const url = trailingPunctuation ? candidate.slice(0, -trailingPunctuation.length) : candidate;
        if (!isAnimatedProviderUrl(url)) continue;

        const start = match.index;
        ranges.push({ start, end: start + url.length });
    }
    return ranges;
}

function maskTextRanges(text: string, ranges: TextRange[]) {
    let result = "";
    let cursor = 0;

    for (const range of ranges) {
        result += text.slice(cursor, range.start);
        result += " ".repeat(range.end - range.start);
        cursor = range.end;
    }
    return result + text.slice(cursor);
}

function hasMeaningfulTextOutsideRanges(text: string, start: number, end: number, ranges: TextRange[]) {
    let cursor = start;
    let intersectsBlockedRange = false;
    let remainder = "";

    for (const range of ranges) {
        const overlapStart = Math.max(start, range.start);
        const overlapEnd = Math.min(end, range.end);
        if (overlapStart >= overlapEnd) continue;

        intersectsBlockedRange = true;
        if (cursor < overlapStart) remainder += text.slice(cursor, overlapStart);
        cursor = Math.max(cursor, overlapEnd);
    }

    if (!intersectsBlockedRange) return true;
    if (cursor < end) remainder += text.slice(cursor, end);
    return /[\p{L}\p{N}\p{S}]/u.test(remainder);
}

function matches(text: string | null | undefined, regex: RegExp) {
    if (typeof text !== "string") return false;

    const blockedRanges = getAnimatedProviderUrlRanges(text);
    if (blockedRanges.length === 0) return regex.test(text);

    const searchRegex = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
    let neutralizedText: string | undefined;
    let match: RegExpExecArray | null;
    while ((match = searchRegex.exec(text)) != null) {
        const start = match.index;
        if (match[0].length === 0) {
            neutralizedText ??= maskTextRanges(text, blockedRanges);
            const neutralRegex = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ""));
            if (neutralRegex.test(neutralizedText)) return true;
            searchRegex.lastIndex++;
            continue;
        }
        if (hasMeaningfulTextOutsideRanges(text, start, start + match[0].length, blockedRanges)) return true;
    }
    return false;
}

function entryMatchesMessage(message: KeywordMessage, entry: KeywordEntry) {
    let regex: RegExp;
    try {
        regex = new RegExp(entry.regex, entry.ignoreCase ? "i" : "");
    } catch {
        return false;
    }

    if (matches(message.content, regex)) return true;

    for (const embed of message.embeds ?? []) {
        if (
            matches(embed.author?.name, regex)
            || matches(embed.title, regex)
            || matches(embed.description, regex)
            || matches(embed.rawTitle, regex)
            || matches(embed.rawDescription, regex)
            || matches(embed.footer?.text, regex)
        ) return true;

        for (const field of embed.fields ?? []) {
            if (
                matches(field.name, regex)
                || matches(field.value, regex)
                || matches(field.rawName, regex)
                || matches(field.rawValue, regex)
            ) return true;
        }
    }

    return false;
}

const customEmojiPattern = /<a?:[^:>]+:\d+>\s*/g;
const inlineCodePattern = /`([^`]+)`/g;

function formatEmbedText(value: string | null | undefined) {
    return value
        ?.replace(customEmojiPattern, "")
        .replace(inlineCodePattern, "$1")
        .trim();
}

function appendLine(lines: string[], value: string | null | undefined) {
    const formatted = formatEmbedText(value);
    if (formatted && !lines.includes(formatted)) lines.push(formatted);
}

export function getMessageText(message: KeywordMessage) {
    const lines: string[] = [];
    appendLine(lines, message.content);

    for (const embed of message.embeds ?? []) {
        appendLine(lines, embed.author?.name);
        appendLine(lines, embed.rawTitle || embed.title);
        appendLine(lines, embed.rawDescription || embed.description);

        for (const field of embed.fields ?? []) {
            appendLine(lines, field.rawName || field.name);
            appendLine(lines, field.rawValue || field.value);
        }
        appendLine(lines, embed.footer?.text);
    }

    return lines.join("\n") || "Matched a configured keyword.";
}

export interface KeywordMatch {
    pattern: string;
    entryIndex: number;
}

export function findKeywordMatch(
    message: KeywordMessage,
    entries: readonly KeywordEntry[],
    guildId: string | undefined,
    ignoreBots: boolean
): KeywordMatch | null {
    for (const [entryIndex, entry] of entries.entries()) {
        if (!entry.regex) continue;

        const listIds = Array.isArray(entry.listIds) ? entry.listIds : [];
        const listed = listIds.includes(message.channel_id)
            || listIds.includes(message.author.id)
            || (guildId != null && listIds.includes(guildId));
        const whitelistMode = entry.listType === ListType.Whitelist;

        if ((!whitelistMode && listed) || (whitelistMode && !listed)) continue;
        if (ignoreBots && message.author.bot && (!whitelistMode || !listIds.includes(message.author.id))) continue;
        if (entryMatchesMessage(message, entry)) return { pattern: entry.regex, entryIndex };
    }

    return null;
}

export function matchesKeyword(
    message: KeywordMessage,
    entries: readonly KeywordEntry[],
    guildId: string | undefined,
    ignoreBots: boolean
) {
    return findKeywordMatch(message, entries, guildId, ignoreBots) != null;
}
