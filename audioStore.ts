import { open, readFile, readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";

import { parseAudioMetadata } from "./audioMetadata";

export const MAX_AUDIO_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg"] as const;

export type CustomAudioKind = "link" | "mention";
export type AudioMimeType = "audio/mpeg" | "audio/wav" | "audio/ogg";
export type ReadAudioFileResult =
    | { ok: true; data: Uint8Array; mimeType: AudioMimeType; fileName: string; }
    | { ok: false; error: string; reason: "cancelled" | "missing" | "invalid" | "io"; };

export function getAudioMimeType(path: string): AudioMimeType | null {
    switch (extname(path).toLowerCase()) {
        case ".mp3": return "audio/mpeg";
        case ".wav": return "audio/wav";
        case ".ogg": return "audio/ogg";
        default: return null;
    }
}

export function isStoredAudioName(kind: CustomAudioKind, name: string) {
    return name.startsWith(`${kind}-`) && AUDIO_EXTENSIONS.some(extension => name.endsWith(extension));
}

export function storedAudioMetadataName(audioName: string) {
    return `${audioName}.json`;
}

export function isStoredAudioMetadataName(kind: CustomAudioKind, name: string) {
    return name.endsWith(".json") && isStoredAudioName(kind, name.slice(0, -5));
}

export async function getStoredAudioNames(directory: string, kind: CustomAudioKind) {
    try {
        return (await readdir(directory)).filter(name => isStoredAudioName(kind, name)).sort().reverse();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
}

export async function removeStoredAudio(directory: string, audioName: string) {
    await Promise.all([
        rm(join(directory, audioName), { force: true }),
        rm(join(directory, storedAudioMetadataName(audioName)), { force: true })
    ]);
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "The audio file could not be read.";
}

async function readStoredAudio(directory: string, audioName: string): Promise<ReadAudioFileResult | undefined> {
    const metadata = parseAudioMetadata(await readFile(join(directory, storedAudioMetadataName(audioName)), "utf8"));
    if (!metadata) return undefined;

    const mimeType = getAudioMimeType(audioName);
    if (!mimeType) return undefined;

    const handle = await open(join(directory, audioName), "r");
    try {
        const file = await handle.stat();
        if (!file.isFile() || file.size > MAX_AUDIO_FILE_SIZE_BYTES) return undefined;

        const data = await handle.readFile();
        if (data.byteLength > MAX_AUDIO_FILE_SIZE_BYTES) return undefined;
        return { ok: true, data: new Uint8Array(data), mimeType, fileName: metadata.fileName };
    } finally {
        await handle.close();
    }
}

export async function loadStoredAudio(directory: string, kind: CustomAudioKind): Promise<ReadAudioFileResult> {
    try {
        for (const audioName of await getStoredAudioNames(directory, kind)) {
            try {
                const result = await readStoredAudio(directory, audioName);
                if (result) return result;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                    return { ok: false, error: getErrorMessage(error), reason: "io" };
                }
            }
        }
    } catch (error) {
        return { ok: false, error: getErrorMessage(error), reason: "io" };
    }
    return { ok: false, error: "No custom audio file is selected.", reason: "missing" };
}
