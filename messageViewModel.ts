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
