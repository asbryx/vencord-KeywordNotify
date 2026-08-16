interface AudioMetadata {
    fileName: string;
}

function isSafeBaseName(value: unknown): value is string {
    return typeof value === "string"
        && value.length > 0
        && value !== "."
        && value !== ".."
        && !value.includes("/")
        && !value.includes("\\")
        && !value.includes("\0");
}

export function serializeAudioMetadata(fileName: string) {
    if (!isSafeBaseName(fileName)) throw new TypeError("Invalid audio file name.");
    return JSON.stringify({ fileName } satisfies AudioMetadata);
}

export function parseAudioMetadata(value: string): AudioMetadata | undefined {
    try {
        const parsed = JSON.parse(value) as { fileName?: unknown; };
        return isSafeBaseName(parsed?.fileName) ? { fileName: parsed.fileName } : undefined;
    } catch {
        return undefined;
    }
}
