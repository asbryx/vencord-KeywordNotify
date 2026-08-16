import type { MessageSnapshot, MessageSnapshotEmbed, MessageSnapshotMedia } from "./messageSnapshot";

export interface MessageContentViewModel {
    kind: "content";
    key: "content";
    markdown: string;
}

export interface MessageEmbedFieldViewModel {
    key: string;
    name: string;
    value: string;
    inline: boolean;
}

export interface MessageEmbedMediaViewModel extends MessageSnapshotMedia {
    key: string;
}

export interface MessageEmbedViewModel extends Omit<MessageSnapshotEmbed, "sourceIndex" | "fields" | "media"> {
    kind: "embed";
    key: string;
    fields: MessageEmbedFieldViewModel[];
    media: MessageEmbedMediaViewModel[];
}

export interface MessageAttachmentViewModel {
    kind: "attachment";
    key: string;
    media: MessageSnapshotMedia;
}

export type MessageViewModel = MessageContentViewModel | MessageEmbedViewModel | MessageAttachmentViewModel;

export function formatDiscordTimestamp(value: Date, now = new Date()): string {
    const time = value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    if (
        value.getFullYear() === now.getFullYear()
        && value.getMonth() === now.getMonth()
        && value.getDate() === now.getDate()
    ) {
        return `Today at ${time}`;
    }

    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (
        value.getFullYear() === yesterday.getFullYear()
        && value.getMonth() === yesterday.getMonth()
        && value.getDate() === yesterday.getDate()
    ) {
        return `Yesterday at ${time}`;
    }

    const date = value.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
    return `${date} at ${time}`;
}

export function getMillisecondsUntilNextLocalDay(now = new Date()): number {
    const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return nextDay.getTime() - now.getTime();
}

export function getMessageMediaLayout(media: MessageSnapshotMedia) {
    if (media.kind !== "thumbnail") return "full";
    if (
        media.width == null || media.height == null
        || !Number.isFinite(media.width) || !Number.isFinite(media.height)
        || media.width <= 0 || media.height <= 0
    ) return "compact";
    if (media.width > media.height) return "full";
    return media.width === media.height ? "square" : "portrait";
}

export function createMessageViewModel(snapshot: MessageSnapshot): MessageViewModel[] {
    const blocks: MessageViewModel[] = [];
    if (snapshot.content.length > 0) blocks.push({ kind: "content", key: "content", markdown: snapshot.content });

    snapshot.embeds.forEach((embed, embedIndex) => {
        const { sourceIndex: _, ...renderedEmbed } = embed;
        const key = `embed-${embedIndex}`;
        blocks.push({
            ...renderedEmbed,
            kind: "embed",
            key,
            fields: embed.fields.map((field, fieldIndex) => ({ ...field, key: `${key}-field-${fieldIndex}` })),
            media: (embed.media ?? []).map((media, mediaIndex) => ({ ...media, key: `${key}-media-${mediaIndex}` }))
        });
    });

    snapshot.attachments.forEach((media, attachmentIndex) => {
        blocks.push({ kind: "attachment", key: `attachment-${attachmentIndex}`, media });
    });
    return blocks;
}
