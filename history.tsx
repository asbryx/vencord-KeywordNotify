import { DataStore } from "@api/index";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { useAwaiter } from "@utils/react";
import type { RenderModalProps } from "@vencord/discord-types";
import { ConfirmModal, Modal, openModal, useEffect, useState } from "@webpack/common";

import { splitNotificationText } from "./content";
import type { KeywordNotificationData } from "./notificationManager";
import { clearKeywordNotificationHistory, navigateToKeywordMessage } from "./notificationManager";
import { isDiscordMediaUrl, sanitizePersistedNotificationImage } from "./media";
import { sanitizeKeywordHistory } from "./state";

import { XPreview } from "./xPreviewView";



export const KEYWORD_HISTORY_KEY = "KeywordNotify_history";
export interface KeywordHistoryEntry extends KeywordNotificationData {
    pinned?: boolean;
}

async function getKeywordHistory() {
    const value = await DataStore.get<unknown>(KEYWORD_HISTORY_KEY);
    const history = sanitizeKeywordHistory(value);
    return Array.isArray(history) ? history as KeywordHistoryEntry[] : [];
}

function KeywordHistoryEntryCard({
    entry,
    onClose
}: {
    entry: KeywordHistoryEntry;
    onClose: () => void;
}) {
    const [imageFailed, setImageFailed] = useState(false);
    const bodySegments = entry.xPreview ? undefined : splitNotificationText(entry.body, entry.mentions);
    const image = sanitizePersistedNotificationImage(entry.imageUrl, entry.imageTargetUrl);
    useEffect(() => setImageFailed(false), [image?.previewUrl]);


    return (
        <article
            className="vc-keywordnotify-history-entry"
            data-x-preview={entry.xPreview != null}
            tabIndex={0}
            aria-label={`Open Discord message from ${entry.authorName}`}
            onClick={() => {
                navigateToKeywordMessage(entry);
                onClose();
            }}
            onKeyDown={event => {
                if (event.target !== event.currentTarget || event.key !== "Enter") return;
                event.preventDefault();
                navigateToKeywordMessage(entry);
                onClose();
            }}>
            {isDiscordMediaUrl(entry.avatarUrl) && <img className="vc-keywordnotify-avatar" src={entry.avatarUrl} alt="" />}
            <div className="vc-keywordnotify-history-content">
                <Flex className="vc-keywordnotify-history-header" justifyContent="space-between">
                    <div className="vc-keywordnotify-author">
                        <strong style={{ color: entry.authorColor }}>{entry.authorName}</strong>
                        {entry.senderType && (
                            <span className="vc-keywordnotify-sender-type" data-sender-type={entry.senderType}>
                                {entry.senderType === "bot" ? "BOT" : "USER"}
                            </span>
                        )}
                    </div>
                </Flex>
                <span className="vc-keywordnotify-history-location">{entry.location} · <time>{new Date(entry.timestamp).toLocaleString()}</time></span>
                {entry.xPreview ? <XPreview preview={entry.xPreview} image={image} /> : <>
                    <p className="vc-keywordnotify-history-body">{bodySegments!.map((segment, index) => segment.type === "link" ? (
                        <a
                            key={index}
                            href={segment.value}
                            onClick={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                VencordNative.native.openExternal(segment.value);
                            }}>
                            {segment.label ?? segment.value}
                        </a>
                    ) : segment.type === "mention" ? (
                        <span key={index} className="vc-keywordnotify-mention" data-mention-kind={segment.kind}>{segment.value}</span>
                    ) : segment.value)}</p>
                    {image && !imageFailed && (
                        <img
                            className="vc-keywordnotify-image"
                            src={image.previewUrl}
                            alt="Message attachment"
                            onError={() => setImageFailed(true)}
                            onClick={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                VencordNative.native.openExternal(image.targetUrl);
                            }}
                        />
                    )}
                </>}
            </div>
        </article>
    );
}

function KeywordHistoryModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [loadedHistory, , pending] = useAwaiter(getKeywordHistory, { fallbackValue: [] });
    const [updatedHistory, setUpdatedHistory] = useState<KeywordHistoryEntry[] | null>(null);
    const history = updatedHistory ?? loadedHistory;

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Keyword Notification History"
            actions={[{
                text: "Clear History",
                variant: "critical-primary",
                disabled: history.length === 0,
                onClick: () => openModal(confirmModalProps => (
                    <ConfirmModal
                        {...confirmModalProps}
                        title="Clear Keyword Notification History?"
                        subtitle={`This will permanently remove ${history.length} notification${history.length === 1 ? "" : "s"}.`}
                        confirmText="Clear History"
                        onConfirm={async () => {
                            await clearKeywordNotificationHistory();
                            setUpdatedHistory([]);
                        }}
                    />
                ))
            }]}>
            <div className="vc-keywordnotify-history">
                {pending && <div className="vc-keywordnotify-history-empty">Loading history…</div>}
                {!pending && history.length === 0 && (
                    <div className="vc-keywordnotify-history-empty">No keyword notifications yet.</div>
                )}
                {history.map(entry => (
                    <KeywordHistoryEntryCard
                        entry={entry}
                        key={entry.id}
                        onClose={modalProps.onClose}
                    />
                ))}
            </div>
        </Modal>
    );
}

export function openKeywordHistory() {
    openModal(modalProps => <KeywordHistoryModal modalProps={modalProps} />);
}

export function KeywordHistoryButton() {
    return <Button onClick={openKeywordHistory}>View Keyword Notification History</Button>;
}
