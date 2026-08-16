import { DataStore } from "@api/index";
import { Button } from "@components/Button";
import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { createRoot, MessageActions, NavigationRouter, useEffect, useRef, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

import { playCustomAudio } from "./audio";
import type * as NativeHandlers from "./native";
import type { MessageSnapshot, MessageSnapshotMediaUpdate } from "./messageSnapshot";
import { formatMessageSnapshotText } from "./messageSnapshot";
import { MessageSnapshotView } from "./messageView";
import { handleNotificationCardAction } from "./notificationInteractions";
import { createNotificationSnapshotUpdater, mergeKeywordHistory, sanitizeKeywordHistory, updateNotificationSnapshot } from "./state";
import { enforceNotificationCapacity, NativeNotificationTracker, NotificationHistoryPersistence, SerialTaskQueue } from "./notificationState";


const Native = VencordNative.pluginHelpers.KeywordNotify as PluginNative<typeof NativeHandlers>;

const logger = new Logger("KeywordNotify");
const NotificationSound = findByPropsLazy("playNotificationSound") as {
    playNotificationSound(sound: string, volume: number): void;
};

export const KEYWORD_HISTORY_KEY = "KeywordNotify_history";

export interface KeywordNotificationData {
    id: string;
    channelId: string;
    guildId?: string;
    messageId: string;
    authorName: string;
    avatarUrl?: string;
    authorColor?: string;
    senderType: "bot" | "user";
    location: string;
    snapshot: MessageSnapshot;

    timestamp: number;
}

export interface KeywordNotificationOptions {
    durationMs: number;
    historyLimit: number;
    pinWhenUnfocused: boolean;
    soundEnabled: boolean;
    soundVolume: number;
}

interface ActiveNotification extends KeywordNotificationData {
    pinSource: "manual" | "unfocused" | null;
    durationMs: number;
}


let activeNotifications: ActiveNotification[] = [];
let root: Root | undefined;
let container: HTMLDivElement | undefined;
let listeningForFocus = false;
let deliveryGeneration = 0;
let managerRunning = true;
const nativeNotifications = new NativeNotificationTracker<Notification>();
const historyQueue = new SerialTaskQueue();
const historyPersistence = new NotificationHistoryPersistence();

function handleWindowFocus() {
    const hadAutoPinned = activeNotifications.some(notification => notification.pinSource === "unfocused");
    if (!hadAutoPinned) return;

    activeNotifications = enforceNotificationCapacity(activeNotifications.map(notification =>
        notification.pinSource === "unfocused" ? { ...notification, pinSource: null } : notification
    ));
    renderNotifications();
}

function renderNotifications() {
    if (!container) {
        container = document.createElement("div");
        container.id = "vc-keywordnotify-container";
        document.body.append(container);
        root = createRoot(container);
    }
    if (!listeningForFocus) {
        window.addEventListener("focus", handleWindowFocus);
        listeningForFocus = true;
    }

    root!.render(
        <div className="vc-keywordnotify-stack">
            {activeNotifications.map(notification => (
                <KeywordNotificationCard key={notification.id} notification={notification} />
            ))}
        </div>
    );
}

function removeNotification(id: string) {
    activeNotifications = activeNotifications.filter(notification => notification.id !== id);
    renderNotifications();
}

function setPinned(id: string, pinned: boolean) {
    activeNotifications = activeNotifications.map(notification =>
        notification.id === id ? { ...notification, pinSource: pinned ? "manual" : null } : notification
    );
    renderNotifications();
}


export function navigateToKeywordMessage(notification: Pick<KeywordNotificationData, "guildId" | "channelId" | "messageId">) {
    window.focus();
    NavigationRouter.transitionTo(`/channels/${notification.guildId ?? "@me"}/${notification.channelId}/${notification.messageId}`);
    window.setTimeout(() => {
        MessageActions.jumpToMessage({
            channelId: notification.channelId,
            messageId: notification.messageId,
            flash: true,
            jumpType: "ANIMATED"
        });
    }, 250);
}

function KeywordNotificationCard({ notification }: { notification: ActiveNotification; }) {
    const [remainingMs, setRemainingMs] = useState(notification.durationMs);
    const remainingRef = useRef(notification.durationMs);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);

    const pinned = notification.pinSource != null;
    useEffect(() => {
        remainingRef.current = notification.durationMs;
        setRemainingMs(notification.durationMs);
    }, [notification.durationMs]);

    useEffect(() => {
        if (pinned || hovered || focused || notification.durationMs === 0) return;

        const startedAt = Date.now();
        const startingRemaining = remainingRef.current;
        const timer = window.setInterval(() => {
            const remaining = Math.max(0, startingRemaining - (Date.now() - startedAt));
            remainingRef.current = remaining;
            setRemainingMs(remaining);
            if (remaining === 0) {
                window.clearInterval(timer);
                removeNotification(notification.id);
            }
        }, 100);

        return () => window.clearInterval(timer);
    }, [notification.id, pinned, hovered, focused, notification.durationMs]);

    const progress = notification.durationMs === 0 ? 100 : remainingMs / notification.durationMs * 100;
    const deliveredAt = new Date(notification.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return (
        <article
            className="vc-keywordnotify-card"
            data-notification-id={notification.id}
            data-pinned={pinned}
            tabIndex={0}
            aria-label={`Open Discord message from ${notification.authorName}`}
            onClick={() => handleNotificationCardAction("open", {
                navigate: () => navigateToKeywordMessage(notification),
                remove: () => removeNotification(notification.id)
            })}
            onContextMenu={event => handleNotificationCardAction("dismiss", {
                navigate: () => navigateToKeywordMessage(notification),
                remove: () => removeNotification(notification.id)
            }, event)}
            onKeyDown={event => {
                if (event.target !== event.currentTarget || event.key !== "Enter") return;
                event.preventDefault();
                navigateToKeywordMessage(notification);
                removeNotification(notification.id);
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={event => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                setFocused(false);
            }}>
            <header className="vc-keywordnotify-card-header">
                {notification.avatarUrl && <img className="vc-keywordnotify-avatar" src={notification.avatarUrl} alt="" />}
                <div className="vc-keywordnotify-heading">
                    <div className="vc-keywordnotify-author">
                        <strong style={{ color: notification.authorColor }}>{notification.authorName}</strong>
                        <span className="vc-keywordnotify-sender-type" data-sender-type={notification.senderType}>
                            {notification.senderType === "bot" ? "BOT" : "USER"}
                        </span>
                    </div>
                    <span>{notification.location} · <time>{deliveredAt}</time></span>
                </div>
                <div className="vc-keywordnotify-controls">
                    <Button
                        size="iconOnly"
                        variant={pinned ? "primary" : "none"}
                        aria-label={pinned ? "Unpin notification" : "Pin notification"}
                        title={pinned ? "Unpin notification" : "Pin notification"}
                        onClick={event => {
                            event.stopPropagation();
                            setPinned(notification.id, !pinned);
                        }}>
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M15 3a3 3 0 0 1 3 3v4.17l2.12 2.12A1 1 0 0 1 19.41 14H13v5.59l1.71 1.7A1 1 0 0 1 13.29 22L12 20.71 10.71 22a1 1 0 0 1-1.42-1.41L11 18.88V14H4.59a1 1 0 0 1-.71-1.71L6 10.17V6a3 3 0 0 1 3-3h6Zm0 2H9a1 1 0 0 0-1 1v5c0 .27-.11.52-.29.71L7 12h10l-.71-.29A1 1 0 0 1 16 11V6a1 1 0 0 0-1-1Z" />
                        </svg>
                    </Button>
                    <Button
                        size="iconOnly"
                        variant="none"
                        aria-label="Close notification"
                        title="Close notification"
                        onClick={event => {
                            event.stopPropagation();
                            removeNotification(notification.id);
                        }}>
                        ×
                    </Button>
                </div>
            </header>
            <MessageSnapshotView
                snapshot={notification.snapshot}
                channelId={notification.channelId}
                messageId={notification.messageId}
            />
            {!pinned && notification.durationMs !== 0 && (
                <div className="vc-keywordnotify-progress" style={{ width: `${progress}%` }} />
            )}
        </article>
    );
}

export function startKeywordNotificationManager(historyLimit: number) {
    managerRunning = true;
    const generation = deliveryGeneration;
    let sanitizedHistory: unknown;
    void historyQueue.enqueue(async () => {
        await DataStore.update<unknown>(KEYWORD_HISTORY_KEY, oldValue => {
            sanitizedHistory = managerRunning && generation === deliveryGeneration
                ? sanitizeKeywordHistory(oldValue, historyLimit)
                : oldValue;
            return sanitizedHistory;
        });
        if (managerRunning && generation === deliveryGeneration) historyPersistence.sync(sanitizedHistory);
    }).catch(error => logger.error("Failed to sanitize notification history", error));
}
export function clearKeywordNotificationHistory() {
    return historyQueue.enqueue(async () => {
        await DataStore.update<unknown>(KEYWORD_HISTORY_KEY, () => []);
        historyPersistence.reset([]);
    });
}


export async function showNativeKeywordNotification(data: KeywordNotificationData, generation = deliveryGeneration) {
    if (document.hasFocus() || typeof Notification === "undefined") return;

    const permission = Notification.permission === "granted"
        ? "granted"
        : Notification.permission !== "denied"
            ? await Notification.requestPermission()
            : "denied";
    if (!managerRunning || generation !== deliveryGeneration || permission !== "granted" || document.hasFocus()) return;

    const nativeNotification = new Notification(`${data.authorName} · ${data.location}`, {
        body: formatMessageSnapshotText(data.snapshot),
        icon: data.avatarUrl,
        silent: true
    });
    nativeNotifications.track(nativeNotification);
    nativeNotification.onclose = () => nativeNotifications.forget(nativeNotification);
    nativeNotification.onclick = async () => {
        if (!nativeNotifications.consume(nativeNotification, managerRunning && generation === deliveryGeneration)) return;
        try {
            await Native.restoreWindow();
            if (managerRunning && generation === deliveryGeneration) navigateToKeywordMessage(data);
        } catch (error) {
            logger.error("Failed to restore Discord window", error);
        }
    };
}

export function deliverKeywordNotification(data: KeywordNotificationData, options: KeywordNotificationOptions) {
    if (!managerRunning) return;
    const generation = deliveryGeneration;
    const shouldPin = !document.hasFocus() && options.pinWhenUnfocused;
    const nextNotifications = [
        {
            ...data,
            pinSource: shouldPin ? "unfocused" as const : null,
            durationMs: options.durationMs,
        },
        ...activeNotifications.filter(notification => notification.id !== data.id)
    ];
    activeNotifications = enforceNotificationCapacity(nextNotifications);
    renderNotifications();

    historyPersistence.begin(data.messageId);
    let persistedHistory: unknown;
    void historyQueue.enqueue(async () => {
        await DataStore.update<unknown>(KEYWORD_HISTORY_KEY, oldValue => {
            persistedHistory = mergeKeywordHistory(
                oldValue,
                data,
                managerRunning && generation === deliveryGeneration,
                options.historyLimit,
                shouldPin
            );
            return persistedHistory;
        });
        if (managerRunning && generation === deliveryGeneration) {
            historyPersistence.complete(data.messageId, persistedHistory);
        } else {
            historyPersistence.cancel(data.messageId);
        }
    }).catch(error => {
        historyPersistence.cancel(data.messageId);
        logger.error("Failed to save notification history", error);
    });

    if (options.soundEnabled) {
        void playCustomAudio("link", options.soundVolume).then(customSoundStarted => {
            if (customSoundStarted || !managerRunning || generation !== deliveryGeneration) return;
            try {
                NotificationSound.playNotificationSound("message1", Math.min(1, Math.max(0, options.soundVolume / 100)));
            } catch (error) {
                logger.error("Failed to play notification sound", error);
            }
        });
    }

    void showNativeKeywordNotification(data, generation)
        .catch(error => logger.error("Failed to show native keyword notification", error));
}

export function enrichKeywordNotificationSnapshot(update: MessageSnapshotMediaUpdate) {
    if (!managerRunning) return;
    const generation = deliveryGeneration;
    const updatedNotifications = updateNotificationSnapshot(activeNotifications, update);
    if (updatedNotifications !== activeNotifications) {
        activeNotifications = updatedNotifications;
        renderNotifications();
    }

    const historyUpdate = historyPersistence.enqueueUpdate(update.messageId, historyQueue, async () => {
        if (!managerRunning || generation !== deliveryGeneration) return;
        await DataStore.update<unknown>(KEYWORD_HISTORY_KEY, oldValue => {
            if (!Array.isArray(oldValue)) return oldValue;
            return createNotificationSnapshotUpdater(
                update,
                () => managerRunning && generation === deliveryGeneration
            )(oldValue as KeywordNotificationData[]);
        });
    });
    void historyUpdate?.catch(error => logger.error("Failed to enrich notification history", error));
}

export function stopKeywordNotificationManager() {
    managerRunning = false;
    ++deliveryGeneration;
    nativeNotifications.closeAll();
    activeNotifications = [];
    historyPersistence.reset();
    if (listeningForFocus) {
        window.removeEventListener("focus", handleWindowFocus);
        listeningForFocus = false;
    }
    root?.unmount();
    container?.remove();
    root = undefined;
    container = undefined;
}
