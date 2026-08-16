import { DATA_DIR } from "@main/utils/constants";
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron";
import { mkdir, open, readdir, rename, rm, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { basename, extname, join } from "path";

import { restoreBrowserWindow } from "./window";
import { AUDIO_EXTENSIONS, getAudioMimeType, getStoredAudioNames, isStoredAudioMetadataName, isStoredAudioName, loadStoredAudio, MAX_AUDIO_FILE_SIZE_BYTES, removeStoredAudio, storedAudioMetadataName, type CustomAudioKind, type ReadAudioFileResult } from "./audioStore";
import { serializeAudioMetadata } from "./audioMetadata";
import { AudioSelectionGeneration } from "./selectionState";

const AUDIO_DIR = join(DATA_DIR, "KeywordNotify", "audio");
const selectionInFlight = new Set<CustomAudioKind>();
const audioSelectionGeneration = new AudioSelectionGeneration();


function isCustomAudioKind(kind: unknown): kind is CustomAudioKind {
    return kind === "link" || kind === "mention";
}

function storedAudioName(kind: CustomAudioKind, extension: typeof AUDIO_EXTENSIONS[number]) {
    return `${kind}-${Date.now().toString().padStart(13, "0")}-${randomUUID()}${extension}`;
}


function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "The audio file could not be read.";
}

async function readValidatedAudioFile(path: string, fileName: string): Promise<ReadAudioFileResult> {
    const mimeType = getAudioMimeType(path);
    if (!mimeType) return { ok: false, error: "Use an .mp3, .wav, or .ogg audio file.", reason: "invalid" };

    const handle = await open(path, "r");
    try {
        const file = await handle.stat();
        if (!file.isFile()) return { ok: false, error: "The selected path is not a file.", reason: "invalid" };
        if (file.size > MAX_AUDIO_FILE_SIZE_BYTES) {
            return { ok: false, error: `The audio file exceeds the ${MAX_AUDIO_FILE_SIZE_BYTES / 1024 / 1024} MiB limit.`, reason: "invalid" };
        }

        const data = await handle.readFile();
        if (data.byteLength > MAX_AUDIO_FILE_SIZE_BYTES) {
            return { ok: false, error: `The audio file exceeds the ${MAX_AUDIO_FILE_SIZE_BYTES / 1024 / 1024} MiB limit.`, reason: "invalid" };
        }
        return { ok: true, data: new Uint8Array(data), mimeType, fileName };
    } finally {
        await handle.close();
    }
}

export function loadAudioFile(_: IpcMainInvokeEvent, kind: unknown): Promise<ReadAudioFileResult> {
    if (!isCustomAudioKind(kind)) return Promise.resolve({ ok: false, error: "Invalid custom audio kind.", reason: "invalid" });
    return loadStoredAudio(AUDIO_DIR, kind);
}

export async function selectAudioFile(event: IpcMainInvokeEvent, kind: unknown): Promise<ReadAudioFileResult> {
    if (!isCustomAudioKind(kind)) return { ok: false, error: "Invalid custom audio kind.", reason: "invalid" };
    if (selectionInFlight.has(kind)) return { ok: false, error: "An audio file picker is already open.", reason: "invalid" };

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) {
        return { ok: false, error: "The Discord window is unavailable.", reason: "invalid" };
    }

    const generation = audioSelectionGeneration.capture();
    selectionInFlight.add(kind);
    try {
        const selection = await dialog.showOpenDialog(window, {
            title: `Select ${kind} notification sound`,
            properties: ["openFile"],
            filters: [{ name: "Audio files", extensions: ["mp3", "wav", "ogg"] }]
        });
        if (!audioSelectionGeneration.isCurrent(generation)) {
            return { ok: false, error: "Audio file selection was cancelled.", reason: "cancelled" };
        }
        if (selection.canceled || selection.filePaths.length === 0) {
            return { ok: false, error: "Audio file selection was cancelled.", reason: "cancelled" };
        }

        const selectedPath = selection.filePaths[0];
        const result = await readValidatedAudioFile(selectedPath, basename(selectedPath));
        if (!result.ok) return result;
        if (!audioSelectionGeneration.isCurrent(generation)) {
            return { ok: false, error: "Audio file selection was cancelled.", reason: "cancelled" };
        }

        const extension = extname(selectedPath).toLowerCase() as typeof AUDIO_EXTENSIONS[number];
        await mkdir(AUDIO_DIR, { recursive: true });
        const finalName = storedAudioName(kind, extension);
        const finalPath = join(AUDIO_DIR, finalName);
        const metadataPath = join(AUDIO_DIR, storedAudioMetadataName(finalName));
        const temporaryPath = join(AUDIO_DIR, `.${finalName}.tmp`);
        const temporaryMetadataPath = `${temporaryPath}.json`;
        const committed = await audioSelectionGeneration.commit(
            generation,
            async () => {
                try {
                    await writeFile(temporaryPath, result.data, { flag: "wx" });
                    await writeFile(temporaryMetadataPath, serializeAudioMetadata(result.fileName), { flag: "wx" });
                    await rename(temporaryPath, finalPath);
                    await rename(temporaryMetadataPath, metadataPath);
                    return finalName;
                } catch (error) {
                    await Promise.all([
                        rm(finalPath, { force: true }),
                        rm(metadataPath, { force: true })
                    ]);
                    throw error;
                } finally {
                    await Promise.all([
                        rm(temporaryPath, { force: true }),
                        rm(temporaryMetadataPath, { force: true })
                    ]);
                }
            },
            audioName => removeStoredAudio(AUDIO_DIR, audioName)
        );
        if (!committed) return { ok: false, error: "Audio file selection was cancelled.", reason: "cancelled" };

        try {
            const oldNames = (await getStoredAudioNames(AUDIO_DIR, kind)).filter(name => name !== finalName);
            await Promise.all(oldNames.map(name => removeStoredAudio(AUDIO_DIR, name)));
        } catch { }
        return result;
    } catch (error) {
        return { ok: false, error: getErrorMessage(error), reason: "io" };
    } finally {
        selectionInFlight.delete(kind);
    }
}

export async function clearAudioFile(_: IpcMainInvokeEvent, kind: unknown) {
    if (!isCustomAudioKind(kind) || selectionInFlight.has(kind)) return false;

    selectionInFlight.add(kind);
    try {
        const names = await readdir(AUDIO_DIR).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
        });
        const artifacts = names.filter(name => isStoredAudioName(kind, name) || isStoredAudioMetadataName(kind, name));
        await Promise.all(artifacts.map(name => rm(join(AUDIO_DIR, name), { force: true })));
        return true;
    } catch {
        return false;
    } finally {
        selectionInFlight.delete(kind);
    }
}

export function invalidateAudioSelections() {
    audioSelectionGeneration.invalidate();
}

export function restoreWindow(event: IpcMainInvokeEvent) {
    return restoreBrowserWindow(BrowserWindow.fromWebContents(event.sender));
}
