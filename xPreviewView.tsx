import { TextButton } from "@components/Button";
import { useEffect, useRef, useState } from "@webpack/common";

import type { NotificationImage } from "./media";
import { normalizeXPreviewTimestamp, type XPreview as XPreviewData } from "./xPreview";

interface XPreviewProps {
    preview: XPreviewData;
    image?: NotificationImage;
}

function ExpandableXText({ children, className }: { children: string; className: string; }) {
    const textRef = useRef<HTMLParagraphElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [overflows, setOverflows] = useState(false);

    useEffect(() => {
        setExpanded(false);
    }, [children]);

    useEffect(() => {
        if (expanded) return;

        const text = textRef.current;
        if (!text) return;
        const updateOverflow = () => setOverflows(text.scrollHeight > text.clientHeight + 1);
        updateOverflow();
        const observer = new ResizeObserver(updateOverflow);
        observer.observe(text);
        return () => observer.disconnect();
    }, [children, expanded]);

    return (
        <div className="vc-keywordnotify-x-expandable">
            <p ref={textRef} className={className} data-collapsed={!expanded}>{children}</p>
            {overflows && (
                <TextButton
                    className="vc-keywordnotify-x-expand"
                    variant="link"
                    aria-expanded={expanded}
                    onClick={event => {
                        event.stopPropagation();
                        setExpanded(value => !value);
                    }}>
                    {expanded ? "Show less" : "Show more"}
                </TextButton>
            )}
        </div>
    );
}

export function XPreview({ preview, image }: XPreviewProps) {
    const [imageFailed, setImageFailed] = useState(false);
    useEffect(() => setImageFailed(false), [image?.previewUrl]);
    const timestamp = normalizeXPreviewTimestamp(preview.timestamp);
    const postTime = timestamp == null ? undefined : new Date(timestamp).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });

    return (
        <section className="vc-keywordnotify-x-preview" aria-label={`X post by ${preview.authorName}`}>
            <header className="vc-keywordnotify-x-header">
                <span className="vc-keywordnotify-x-brand" aria-hidden="true">X</span>
                <div className="vc-keywordnotify-x-author">
                    <strong>{preview.authorName}</strong>
                    <span>
                        <a
                            href={preview.url}
                            onClick={event => {
                                event.preventDefault();
                                event.stopPropagation();
                                VencordNative.native.openExternal(preview.url);
                            }}>
                            @{preview.handle}
                        </a>
                        {postTime && <> · <time dateTime={new Date(timestamp!).toISOString()}>{postTime}</time></>}
                    </span>
                </div>
            </header>
            {preview.text && <ExpandableXText className="vc-keywordnotify-x-text" >{preview.text}</ExpandableXText>}
            {preview.quote && (
                <blockquote className="vc-keywordnotify-x-quote">
                    <strong>{preview.quote.authorName} <span>@{preview.quote.handle}</span></strong>
                    <ExpandableXText className="vc-keywordnotify-x-quote-text">{preview.quote.text}</ExpandableXText>
                </blockquote>
            )}
            {image && !imageFailed && (
                <button
                    type="button"
                    className="vc-keywordnotify-x-media"
                    aria-label="Open post media"
                    onClick={event => {
                        event.stopPropagation();
                        VencordNative.native.openExternal(image.targetUrl);
                    }}>
                    <img src={image.previewUrl} alt="Post media" onError={() => setImageFailed(true)} />
                </button>
            )}
        </section>
    );
}
