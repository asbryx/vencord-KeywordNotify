import { Parser, useEffect, useState } from "@webpack/common";
import type { CSSProperties } from "react";

import { createMessageViewModel, formatDiscordTimestamp, getMessageMediaLayout, getMillisecondsUntilNextLocalDay, type MessageEmbedViewModel } from "./messageViewModel";
import type { MessageSnapshot, MessageSnapshotMedia } from "./messageSnapshot";
import { routeNestedNotificationInteraction } from "./notificationInteractions";

interface MessageSnapshotViewProps {
    snapshot: MessageSnapshot;
    channelId: string;
    messageId: string;
}

interface MarkdownContext {
    channelId: string;
    messageId: string;
    allowLinks: true;
    allowHeading: true;
    allowList: true;
    allowEmojiLinks: true;
}

type EmbedStyle = CSSProperties & {
    "--vc-keywordnotify-embed-color"?: string;
};

const SAFE_EMBED_COLOR = /^#[\da-f]{6}$/i;

function isHttpUrl(value: string) {
    try {
        const protocol = new URL(value).protocol;
        return protocol === "https:" || protocol === "http:";
    } catch {
        return false;
    }
}

function openExternal(event: React.MouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    routeNestedNotificationInteraction(event);
    if (isHttpUrl(url)) VencordNative.native.openExternal(url);
}


function parseMarkdown(value: string, inline: boolean, context: MarkdownContext) {
    return Parser.parse(value, inline, context);
}

function FailableImage({
    src,
    alt,
    className,
    width,
    height
}: {
    src: string;
    alt: string;
    className: string;
    width?: number;
    height?: number;
}) {
    const [failed, setFailed] = useState(false);
    if (failed) return null;

    return (
        <img
            className={className}
            src={src}
            alt={alt}
            width={width}
            height={height}
            onError={() => setFailed(true)}
        />
    );
}

function MessageMedia({ media }: { media: MessageSnapshotMedia; }) {
    const [failed, setFailed] = useState(false);
    if (failed) return null;

    const label = media.description
        ? `Open ${media.description}`
        : media.kind === "attachment" ? "Open message attachment" : "Open embed media";

    return (
        <button
            type="button"
            className="vc-keywordnotify-message-media"
            data-kind={media.kind}
            data-layout={getMessageMediaLayout(media)}
            aria-label={label}
            onClick={event => {
                routeNestedNotificationInteraction(event);
                if (isHttpUrl(media.targetUrl)) VencordNative.native.openExternal(media.targetUrl);
            }}>
            <img
                className="vc-keywordnotify-message-media-image"
                src={media.previewUrl}
                alt={media.description ?? ""}
                width={media.width}
                height={media.height}
                onError={() => setFailed(true)}
            />
        </button>
    );
}

function EmbedAuthor({ author }: { author: NonNullable<MessageEmbedViewModel["author"]>; }) {
    const contents = <>
        {author.iconUrl && (
            <FailableImage
                key={author.iconUrl}
                className="vc-keywordnotify-message-embed-author-icon"
                src={author.iconUrl}
                alt=""
            />
        )}
        <span>{author.name}</span>
    </>;

    return author.url ? (
        <a
            className="vc-keywordnotify-message-embed-author"
            href={author.url}
            onClick={event => openExternal(event, author.url!)}>
            {contents}
        </a>
    ) : <div className="vc-keywordnotify-message-embed-author">{contents}</div>;
}

function EmbedTitle({ embed, context }: { embed: MessageEmbedViewModel; context: MarkdownContext; }) {
    if (!embed.title) return null;
    const contents = parseMarkdown(embed.title, true, context);

    return embed.url ? (
        <a
            className="vc-keywordnotify-message-embed-title"
            href={embed.url}
            onClick={event => openExternal(event, embed.url!)}>
            {contents}
        </a>
    ) : <div className="vc-keywordnotify-message-embed-title">{contents}</div>;
}

function MessageEmbed({ embed, context }: { embed: MessageEmbedViewModel; context: MarkdownContext; }) {
    const embedStyle: EmbedStyle | undefined = embed.color && SAFE_EMBED_COLOR.test(embed.color)
        ? { "--vc-keywordnotify-embed-color": embed.color }
        : undefined;
    const timestamp = embed.timestamp == null ? undefined : new Date(embed.timestamp);
    const validTimestamp = timestamp && Number.isFinite(timestamp.getTime()) ? timestamp : undefined;

    return (
        <section className="vc-keywordnotify-message-embed" style={embedStyle}>
            {embed.author && <EmbedAuthor author={embed.author} />}
            <EmbedTitle embed={embed} context={context} />
            {embed.description && (
                <div className="vc-keywordnotify-message-embed-description vc-keywordnotify-message-markdown">
                    {parseMarkdown(embed.description, false, context)}
                </div>
            )}
            {embed.fields.length > 0 && (
                <div className="vc-keywordnotify-message-embed-fields">
                    {embed.fields.map(field => (
                        <section
                            key={field.key}
                            className="vc-keywordnotify-message-embed-field"
                            data-inline={field.inline}>
                            <div className="vc-keywordnotify-message-embed-field-name vc-keywordnotify-message-markdown">
                                {parseMarkdown(field.name, true, context)}
                            </div>
                            <div className="vc-keywordnotify-message-embed-field-value vc-keywordnotify-message-markdown">
                                {parseMarkdown(field.value, false, context)}
                            </div>
                        </section>
                    ))}
                </div>
            )}
            {embed.media.length > 0 && (
                <div className="vc-keywordnotify-message-embed-media">
                    {embed.media.map(media => <MessageMedia key={`${media.key}:${media.previewUrl}`} media={media} />)}
                </div>
            )}
            {(embed.footer || validTimestamp) && (
                <footer className="vc-keywordnotify-message-embed-footer">
                    {embed.footer?.iconUrl && (
                        <FailableImage
                            key={embed.footer.iconUrl}
                            className="vc-keywordnotify-message-embed-footer-icon"
                            src={embed.footer.iconUrl}
                            alt=""
                        />
                    )}
                    {embed.footer?.text && <span>{embed.footer.text}</span>}
                    {embed.footer && validTimestamp && <span aria-hidden="true">•</span>}
                    {validTimestamp && (
                        <time dateTime={validTimestamp.toISOString()}>{formatDiscordTimestamp(validTimestamp)}</time>
                    )}
                </footer>
            )}
        </section>
    );
}

export function MessageSnapshotView({ snapshot, channelId, messageId }: MessageSnapshotViewProps) {
    const [timestampRevision, setTimestampRevision] = useState(0);
    const hasTimestamp = snapshot.embeds.some(embed => {
        const timestamp = embed.timestamp == null ? undefined : new Date(embed.timestamp);
        return timestamp != null && Number.isFinite(timestamp.getTime());
    });
    useEffect(() => {
        if (!hasTimestamp) return;
        const timer = window.setTimeout(
            () => setTimestampRevision(current => current + 1),
            getMillisecondsUntilNextLocalDay()
        );
        return () => window.clearTimeout(timer);
    }, [hasTimestamp, timestampRevision]);

    const context: MarkdownContext = {
        channelId,
        messageId,
        allowLinks: true,
        allowHeading: true,
        allowList: true,
        allowEmojiLinks: true
    };
    const blocks = createMessageViewModel(snapshot);

    return (
        <div className="vc-keywordnotify-message" onClick={routeNestedNotificationInteraction}>
            {blocks.map(block => {
                if (block.kind === "content") return (
                    <div key={block.key} className="vc-keywordnotify-message-content vc-keywordnotify-message-markdown">
                        {parseMarkdown(block.markdown, false, context)}
                    </div>
                );
                if (block.kind === "embed") return <MessageEmbed key={block.key} embed={block} context={context} />;
                return (
                    <div key={block.key} className="vc-keywordnotify-message-attachment">
                        <MessageMedia key={block.media.previewUrl} media={block.media} />
                    </div>
                );
            })}
        </div>
    );
}
