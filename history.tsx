import { DataStore } from "@api/index";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { useAwaiter } from "@utils/react";
import type { RenderModalProps } from "@vencord/discord-types";
import { ConfirmModal, Modal, openModal, useState } from "@webpack/common";

import type { KeywordNotificationData } from "./notificationManager";
import { clearKeywordNotificationHistory, navigateToKeywordMessage } from "./notificationManager";
import { isDiscordMediaUrl } from "./media";
import { MessageSnapshotView } from "./messageView";
import { sanitizeKeywordHistory } from "./state";



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


    return (
        <article
            className="vc-keywordnotify-history-entry"
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
                <MessageSnapshotView
                    snapshot={entry.snapshot}
                    channelId={entry.channelId}
                    messageId={entry.messageId}
                />
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
