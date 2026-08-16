import type { KeywordEntry } from "./matcher";
import { getCanonicalXStatusUrl, sanitizePersistedXPreview } from "./xPreview";


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

function removeTransientHistoryFields(value: unknown) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return value;

    const record = value as Record<string, unknown>;
    if (
        !Object.prototype.hasOwnProperty.call(record, "matchedPattern")
        && !Object.prototype.hasOwnProperty.call(record, "discordContext")
        && !Object.prototype.hasOwnProperty.call(record, "saved")
    ) return value;

    const { matchedPattern: _matchedPattern, discordContext: _discordContext, saved: _saved, ...rest } = record;
    return rest;
}

function sanitizeHistoryEntry(value: unknown) {
    const withoutTransientFields = removeTransientHistoryFields(value);
    if (withoutTransientFields == null || typeof withoutTransientFields !== "object" || Array.isArray(withoutTransientFields)) return withoutTransientFields;

    const entry = withoutTransientFields as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(entry, "xPreview")) return withoutTransientFields;

    const xPreview = sanitizePersistedXPreview(entry.xPreview);
    if (xPreview) return { ...entry, xPreview };

    const { xPreview: _xPreview, ...rest } = entry;
    return rest;
}

export function sanitizeKeywordHistory(value: unknown, historyLimit?: number) {
    if (!Array.isArray(value)) return value;

    let changed = false;
    const sanitized = value.map(entry => {
        const result = sanitizeHistoryEntry(entry);
        if (result !== entry) changed = true;
        return result;
    });
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
    return removeTransientHistoryFields({ ...data, pinned: Boolean(pinned) });
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
    return retainKeywordHistory([entry, ...removeHistoryMessage(history, messageId)], historyLimit);
}


interface NotificationImage {
    previewUrl: string;
    targetUrl: string;
}

interface NotificationImageUpdate {
    generic?: NotificationImage;
    xPreview?: { url: string; image: NotificationImage; };
}

interface NotificationWithImage {
    messageId: string;
    imageUrl?: string;
    imageTargetUrl?: string;
    xPreview?: { url: string; };
}

export function updateNotificationImage<T extends NotificationWithImage>(
    notifications: T[],
    messageId: string,
    update: NotificationImageUpdate
): T[] {
    const index = notifications.findIndex(notification => notification.messageId === messageId);
    if (index === -1) return notifications;

    const notification = notifications[index];
    const storedXPreviewUrl = getCanonicalXStatusUrl(notification.xPreview?.url);
    const updateXPreviewUrl = getCanonicalXStatusUrl(update.xPreview?.url);
    const selectedImage = notification.xPreview
        ? storedXPreviewUrl != null && storedXPreviewUrl === updateXPreviewUrl ? update.xPreview?.image : undefined
        : update.generic;
    if (!selectedImage || (notification.imageUrl === selectedImage.previewUrl && notification.imageTargetUrl === selectedImage.targetUrl)) return notifications;

    const updated = notifications.slice();
    updated[index] = {
        ...notification,
        imageUrl: selectedImage.previewUrl,
        imageTargetUrl: selectedImage.targetUrl
    };
    return updated;
}

export function createNotificationImageUpdater<T extends NotificationWithImage>(
    messageId: string,
    image: NotificationImageUpdate,
    isCurrent: () => boolean
) {
    return (history: T[]) => isCurrent() ? updateNotificationImage(history, messageId, image) : history;
}
