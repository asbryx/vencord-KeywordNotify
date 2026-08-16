import type { AudioMimeType, CustomAudioKind, ReadAudioFileResult } from "./audioStore";

const logger = {
    error(message: string) {
        console.error(`[KeywordNotify] ${message}`);
    }
};

interface NativeHelper {
    loadAudioFile(kind: CustomAudioKind): Promise<ReadAudioFileResult>;
    selectAudioFile(kind: CustomAudioKind): Promise<ReadAudioFileResult>;
    clearAudioFile(kind: CustomAudioKind): Promise<boolean>;
    invalidateAudioSelections?(): Promise<void>;
}

function getNativeHelper(): NativeHelper | undefined {
    return globalThis.VencordNative?.pluginHelpers.KeywordNotify as unknown as NativeHelper | undefined;
}

export type { CustomAudioKind } from "./audioStore";

export interface MentionSoundSettings {
    enabled: boolean;
    volume: number;
}


interface ActiveAudioPlayback {
    player: HTMLAudioElement;
    source?: MediaElementAudioSourceNode;
    gain?: GainNode;
}

interface AudioCacheEntry {
    requestId: number;
    url?: string;
    activePlayers: Set<ActiveAudioPlayback>;
}

const audioCache: Record<CustomAudioKind, AudioCacheEntry> = {
    link: { requestId: 0, activePlayers: new Set() },
    mention: { requestId: 0, activePlayers: new Set() }
};

let audioGeneration = 0;
let sharedAudioContext: AudioContext | undefined;
const audioMutationOwners = new Map<CustomAudioKind, object>();

export function getAudioMimeType(path: string): AudioMimeType | null {
    switch (path.slice(path.lastIndexOf(".")).toLowerCase()) {
        case ".mp3": return "audio/mpeg";
        case ".wav": return "audio/wav";
        case ".ogg": return "audio/ogg";
        default: return null;
    }
}


function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function getAudioLevels(volume: number) {
    const normalized = Math.min(300, Math.max(0, volume)) / 100;
    return {
        elementVolume: Math.min(1, normalized),
        gain: Math.max(1, normalized)
    };
}

function normalizeVolume(volume: number) {
    return getAudioLevels(volume).elementVolume;
}

function releasePlayback(entry: AudioCacheEntry, playback: ActiveAudioPlayback) {
    if (!entry.activePlayers.delete(playback)) return;
    playback.player.pause();
    playback.source?.disconnect();
    playback.gain?.disconnect();
}

function releaseAudio(kind: CustomAudioKind) {
    const entry = audioCache[kind];
    for (const playback of [...entry.activePlayers]) releasePlayback(entry, playback);
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.url = undefined;
}

export function isCustomAudioLoaded(kind: CustomAudioKind) {
    return audioCache[kind].url != null;
}

export function reconcileAudioFileName(current: string, loaded: string | undefined) {
    return loaded ?? current;
}

async function applyAudioResult(kind: CustomAudioKind, requestId: number, result: ReadAudioFileResult, clearOnMissing: boolean) {
    const entry = audioCache[kind];
    if (requestId !== entry.requestId) return undefined;
    if (!result.ok) {
        if (clearOnMissing && result.reason === "missing") releaseAudio(kind);
        if (result.reason !== "missing" && result.reason !== "cancelled") {
            logger.error(`Failed to load custom ${kind} sound: ${result.error}`);
        }
        return undefined;
    }

    const url = URL.createObjectURL(new Blob([Uint8Array.from(result.data)], { type: result.mimeType }));
    releaseAudio(kind);
    entry.url = url;
    return result.fileName;
}

async function requestCustomAudio(kind: CustomAudioKind, select: boolean) {
    if (audioMutationOwners.has(kind)) return undefined;

    const owner = {};
    const entry = audioCache[kind];
    const requestId = ++entry.requestId;
    const native = getNativeHelper();
    const loader = select ? native?.selectAudioFile : native?.loadAudioFile;
    if (!loader) {
        logger.error(`Failed to load custom ${kind} sound: native file access is unavailable.`);
        return undefined;
    }

    audioMutationOwners.set(kind, owner);
    try {
        return await applyAudioResult(kind, requestId, await loader.call(native, kind), !select);
    } catch (error) {
        if (requestId === entry.requestId) logger.error(`Failed to load custom ${kind} sound: ${getErrorMessage(error)}`);
        return undefined;
    } finally {
        if (audioMutationOwners.get(kind) === owner) audioMutationOwners.delete(kind);
    }
}

export function loadCustomAudio(kind: CustomAudioKind) {
    return requestCustomAudio(kind, false);
}

export function selectCustomAudio(kind: CustomAudioKind) {
    return requestCustomAudio(kind, true);
}

export async function clearCustomAudio(kind: CustomAudioKind) {
    if (audioMutationOwners.has(kind)) return false;
    const native = getNativeHelper();
    if (!native) return false;

    const owner = {};
    audioMutationOwners.set(kind, owner);
    try {
        if (!await native.clearAudioFile(kind)) return false;
        const entry = audioCache[kind];
        ++entry.requestId;
        releaseAudio(kind);
        return true;
    } catch (error) {
        logger.error(`Failed to clear custom ${kind} sound: ${getErrorMessage(error)}`);
        return false;
    } finally {
        if (audioMutationOwners.get(kind) === owner) audioMutationOwners.delete(kind);
    }
}
export async function playCustomAudio(kind: CustomAudioKind, volume: number) {
    const entry = audioCache[kind];
    if (!entry.url) return false;
    const generation = audioGeneration;

    let playback: ActiveAudioPlayback | undefined;
    try {
        const player = new Audio(entry.url);
        playback = { player };
        entry.activePlayers.add(playback);

        const levels = getAudioLevels(volume);
        player.volume = levels.elementVolume;
        if (levels.gain > 1) {
            const context = sharedAudioContext ??= new AudioContext();
            const source = context.createMediaElementSource(player);
            playback.source = source;
            const gain = context.createGain();
            playback.gain = gain;
            gain.gain.value = levels.gain;
            if (context.state === "suspended") {
                await context.resume();
                if (generation !== audioGeneration || !entry.activePlayers.has(playback)) {
                    releasePlayback(entry, playback);
                    return false;
                }
            }
            source.connect(gain);
            gain.connect(context.destination);
        }

        const releasePlayer = () => releasePlayback(entry, playback!);
        player.addEventListener("ended", releasePlayer, { once: true });
        player.addEventListener("error", releasePlayer, { once: true });
        await player.play();
        if (generation !== audioGeneration || !entry.activePlayers.has(playback)) {
            releasePlayback(entry, playback);
            return false;
        }
        return true;
    } catch (error) {
        if (playback) releasePlayback(entry, playback);
        if (generation === audioGeneration) logger.error(`Failed to play custom ${kind} sound: ${getErrorMessage(error)}`);
        return false;
    }
}

export function replaceMentionNotificationSound(
    sound: string | undefined,
    shouldReplace: boolean,
    settings: MentionSoundSettings,
    fallback: (sound: string, volume: number) => void
) {
    if (!sound || !shouldReplace || !settings.enabled || !isCustomAudioLoaded("mention")) return sound;

    const generation = audioGeneration;
    const fallbackVolume = normalizeVolume(settings.volume);
    void playCustomAudio("mention", settings.volume).then(started => {
        if (!started && generation === audioGeneration) fallback(sound, fallbackVolume);
    });
    return undefined;
}


export function stopCustomAudio() {
    ++audioGeneration;
    void getNativeHelper()?.invalidateAudioSelections?.()
        .catch(error => logger.error(`Failed to invalidate native audio selections: ${getErrorMessage(error)}`));

    audioMutationOwners.clear();

    for (const kind of Object.keys(audioCache) as CustomAudioKind[]) {
        ++audioCache[kind].requestId;
        releaseAudio(kind);
    }
    if (sharedAudioContext) {
        void sharedAudioContext.close();
        sharedAudioContext = undefined;
    }
}
