import { evaluatePatternAgainstTexts, regexWorkerGuard, type RegexWorkerGuard } from "./regexGuard";

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

function collectMessageTexts(message: KeywordMessage): string[] {
    const texts: string[] = [];
    if (typeof message.content === "string") texts.push(message.content);

    for (const embed of message.embeds ?? []) {
        const candidates = [
            embed.author?.name,
            embed.title,
            embed.description,
            embed.rawTitle,
            embed.rawDescription,
            embed.footer?.text
        ];
        for (const field of embed.fields ?? []) {
            candidates.push(field.name, field.value, field.rawName, field.rawValue);
        }
        for (const candidate of candidates) {
            if (typeof candidate === "string" && candidate.length > 0) texts.push(candidate);
        }
    }

    return texts;
}

export function entryAllowsMessage(
    message: KeywordMessage,
    entry: KeywordEntry,
    guildId: string | undefined,
    ignoreBots: boolean
) {
    if (!entry.regex) return false;

    const listIds = Array.isArray(entry.listIds) ? entry.listIds : [];
    const listed = listIds.includes(message.channel_id)
        || listIds.includes(message.author.id)
        || (guildId != null && listIds.includes(guildId));
    const whitelistMode = entry.listType === ListType.Whitelist;

    if ((!whitelistMode && listed) || (whitelistMode && !listed)) return false;
    if (ignoreBots && message.author.bot && (!whitelistMode || !listIds.includes(message.author.id))) return false;
    return true;
}

function entryMatchesMessage(message: KeywordMessage, entry: KeywordEntry) {
    return evaluatePatternAgainstTexts(entry.regex, entry.ignoreCase ? "i" : "", collectMessageTexts(message)).matched;
}

export function findKeywordMatch(
    message: KeywordMessage,
    entries: readonly KeywordEntry[],
    guildId: string | undefined,
    ignoreBots: boolean
): KeywordMatch | null {
    for (const [entryIndex, entry] of entries.entries()) {
        if (!entryAllowsMessage(message, entry, guildId, ignoreBots)) continue;
        if (entryMatchesMessage(message, entry)) return { pattern: entry.regex, entryIndex };
    }

    return null;
}

export async function findKeywordMatchAsync(
    message: KeywordMessage,
    entries: readonly KeywordEntry[],
    guildId: string | undefined,
    ignoreBots: boolean,
    guard: RegexWorkerGuard = regexWorkerGuard
): Promise<KeywordMatch | null> {
    const candidates: { entry: KeywordEntry; entryIndex: number; }[] = [];
    for (const [entryIndex, entry] of entries.entries()) {
        if (entryAllowsMessage(message, entry, guildId, ignoreBots)) candidates.push({ entry, entryIndex });
    }
    if (candidates.length === 0) return null;

    const texts = collectMessageTexts(message);
    const results = await guard.run(candidates.map(candidate => ({
        pattern: candidate.entry.regex,
        flags: candidate.entry.ignoreCase ? "i" : "",
        texts
    })));

    for (let index = 0; index < candidates.length; index++) {
        if (results[index]?.matched) return { pattern: candidates[index].entry.regex, entryIndex: candidates[index].entryIndex };
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
