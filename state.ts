import type { KeywordEntry } from "./matcher";
import { isDiscordMediaUrl } from "./media";
import { sanitizeMessageSnapshot, updateMessageSnapshotMedia } from "./messageSnapshot";
import type { MessageSnapshot, MessageSnapshotMediaUpdate } from "./messageSnapshot";

export function resolveLoadedKeywordEntries(
    value: unknown,
    loadGeneration: number,
    currentGeneration: number,
    loadMutationRevision: number,
    currentMutationRevision: number
): KeywordEntry[] | null {
    if (loadGeneration !== currentGeneration || loadMutationRevision !== currentMutationRevision) return null;
    return Array.isArray(value) ? value as KeywordEntry[] : [];
}


function createLegacyMessageSnapshot(value: Record<string, unknown>) {
    if (typeof value.body !== "string") return;

    const hasImage = Object.prototype.hasOwnProperty.call(value, "imageUrl")
        || Object.prototype.hasOwnProperty.call(value, "imageTargetUrl");

    return sanitizeMessageSnapshot({
        content: value.body,
        embeds: [],
        attachments: hasImage ? [{
            kind: "attachment",
            previewUrl: value.imageUrl,
            targetUrl: value.imageTargetUrl
        }] : []
    });
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function hasValidHistoryMetadata(value: Record<string, unknown>) {
    return isNonEmptyString(value.id)
        && isNonEmptyString(value.channelId)
        && isNonEmptyString(value.messageId)
        && isNonEmptyString(value.authorName)
        && (value.senderType === "bot" || value.senderType === "user")
        && isNonEmptyString(value.location)
        && typeof value.timestamp === "number"
        && Number.isFinite(value.timestamp);
}

function isSafeAuthorColor(value: unknown): value is string {
    return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

function sanitizeHistoryEntry(value: unknown) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return;

    const record = value as Record<string, unknown>;
    if (!hasValidHistoryMetadata(record)) return;
    const snapshot = Object.prototype.hasOwnProperty.call(record, "snapshot")
        ? sanitizeMessageSnapshot(record.snapshot)
        : createLegacyMessageSnapshot(record);
    if (!snapshot) return;

    return {
        id: record.id as string,
        channelId: record.channelId as string,
        ...(isNonEmptyString(record.guildId) ? { guildId: record.guildId } : {}),
        messageId: record.messageId as string,
        authorName: record.authorName as string,
        ...(isDiscordMediaUrl(record.avatarUrl) ? { avatarUrl: record.avatarUrl } : {}),
        ...(isSafeAuthorColor(record.authorColor) ? { authorColor: record.authorColor } : {}),
        senderType: record.senderType as "bot" | "user",
        location: record.location as string,
        snapshot,
        timestamp: record.timestamp as number,
        ...(typeof record.pinned === "boolean" ? { pinned: record.pinned } : {})
    };
}

export function sanitizeKeywordHistory(value: unknown, historyLimit?: number) {
    if (!Array.isArray(value)) return value;

    let changed = false;
    const sanitized: object[] = [];
    for (const entry of value) {
        const result = sanitizeHistoryEntry(entry);
        if (result == null) {
            changed = true;
            continue;
        }
        if (result !== entry) changed = true;
        sanitized.push(result);
    }
    const retained = historyLimit == null ? sanitized : retainKeywordHistory(sanitized, historyLimit);
    return changed || retained.length !== value.length ? retained : value;
}

interface KeywordHistoryRecord {
    messageId?: unknown;
    pinned?: unknown;
}

function getHistoryMessageId(value: unknown) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return;
    const { messageId } = value as KeywordHistoryRecord;
    return typeof messageId === "string" ? messageId : undefined;
}

function retainKeywordHistory(history: unknown[], historyLimit: number) {
    const recentLimit = Number.isFinite(historyLimit) ? Math.max(0, Math.floor(historyLimit)) : 0;
    return history.slice(0, recentLimit);
}

function removeHistoryMessage(history: unknown[], messageId: string | undefined) {
    return messageId == null ? history : history.filter(entry => getHistoryMessageId(entry) !== messageId);
}

function createKeywordHistoryEntry(data: object, pinned: boolean) {
    return sanitizeHistoryEntry({ ...data, pinned: Boolean(pinned) });
}

export function mergeKeywordHistory(
    oldValue: unknown,
    data: object,
    isCurrent: boolean,
    historyLimit: number,
    pinned: boolean
) {
    if (!isCurrent) return oldValue;

    const sanitized = sanitizeKeywordHistory(oldValue);
    const history = Array.isArray(sanitized) ? sanitized : [];
    const messageId = getHistoryMessageId(data);
    const entry = createKeywordHistoryEntry(data, pinned);
    return retainKeywordHistory(entry ? [entry, ...removeHistoryMessage(history, messageId)] : history, historyLimit);
}

interface NotificationWithSnapshot {
    messageId: string;
    snapshot?: MessageSnapshot;
}

export function updateNotificationSnapshot<T extends NotificationWithSnapshot>(
    notifications: T[],
    update: MessageSnapshotMediaUpdate
): T[] {
    const index = notifications.findIndex(notification => notification.messageId === update.messageId);
    if (index === -1) return notifications;

    const notification = notifications[index];
    if (!notification.snapshot) return notifications;

    const snapshot = updateMessageSnapshotMedia(notification.snapshot, update);
    const updated = notifications.slice();
    updated[index] = { ...notification, snapshot };
    return updated;
}

export function createNotificationSnapshotUpdater<T extends NotificationWithSnapshot>(
    update: MessageSnapshotMediaUpdate,
    isCurrent: () => boolean
) {
    return (history: T[]) => isCurrent() ? updateNotificationSnapshot(history, update) : history;
}
