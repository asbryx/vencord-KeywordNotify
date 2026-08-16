import assert from "node:assert/strict";
import test from "node:test";

import { clearCustomAudio, getAudioLevels, getAudioMimeType, isCustomAudioLoaded, loadCustomAudio, playCustomAudio, reconcileAudioFileName, replaceMentionNotificationSound, selectCustomAudio, stopCustomAudio } from "./audio";

test("accepts supported custom sound file extensions", () => {
    assert.equal(getAudioMimeType("C:\\Sounds\\link.MP3"), "audio/mpeg");
    assert.equal(getAudioMimeType("C:\\Sounds\\tag.wav"), "audio/wav");
    assert.equal(getAudioMimeType("C:\\Sounds\\tag.ogg"), "audio/ogg");
    assert.equal(getAudioMimeType("C:\\Sounds\\tag.exe"), null);
});


test("maps boosted volume to Web Audio gain with a safe clamp", () => {
    assert.deepEqual(getAudioLevels(40), { elementVolume: 0.4, gain: 1 });
    assert.deepEqual(getAudioLevels(100), { elementVolume: 1, gain: 1 });
    assert.deepEqual(getAudioLevels(250), { elementVolume: 1, gain: 2.5 });
    assert.deepEqual(getAudioLevels(400), { elementVolume: 1, gain: 3 });
    assert.deepEqual(getAudioLevels(-20), { elementVolume: 0, gain: 1 });
});


test("reconciles a committed picker basename without erasing labels on load failure", () => {
    assert.equal(reconcileAudioFileName("Discord default sound", "alert.wav"), "alert.wav");
    assert.equal(reconcileAudioFileName("alert.wav", undefined), "alert.wav");
});

test("invalidates native audio selections on stop", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    let invalidations = 0;
    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: { pluginHelpers: { KeywordNotify: { invalidateAudioSelections: async () => { invalidations++; } } } }
    });

    try {
        stopCustomAudio();
        await Promise.resolve();
        assert.equal(invalidations, 1);
    } finally {
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});
test("contains native selection invalidation rejection", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: { pluginHelpers: { KeywordNotify: { invalidateAudioSelections: async () => { throw new Error("ipc closed"); } } } }
    });
    process.on("unhandledRejection", onUnhandled);

    try {
        stopCustomAudio();
        await Promise.resolve();
        await Promise.resolve();
        assert.deepEqual(unhandled, []);
    } finally {
        process.off("unhandledRejection", onUnhandled);
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});


test("rapid custom sounds use independent audio players", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const originalAudio = globalThis.Audio;
    const players: Array<{ pauseCalls: number; }> = [];
    const loadedKinds: string[] = [];
    class FakeAudio {
        currentTime = 0;
        volume = 1;
        pauseCalls = 0;

        constructor(_url: string) {
            players.push(this);
        }

        addEventListener() { }
        pause() { this.pauseCalls++; }
        play() { return Promise.resolve(); }
    }

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: {
            pluginHelpers: {
                KeywordNotify: {
                    loadAudioFile: async (kind: string) => {
                        loadedKinds.push(kind);
                        return { ok: true, data: new Uint8Array([1]), mimeType: "audio/wav", fileName: "sound.wav" };
                    }
                }
            }
        }
    });
    globalThis.Audio = FakeAudio as unknown as typeof Audio;

    try {
        assert.equal(await loadCustomAudio("link"), "sound.wav");
        assert.deepEqual(loadedKinds, ["link"]);
        assert.equal(await playCustomAudio("link", 40), true);
        assert.equal(await playCustomAudio("link", 40), true);
        assert.equal(players.length, 2);
        assert.deepEqual(players.map(player => player.pauseCalls), [0, 0]);
    } finally {
        stopCustomAudio();
        globalThis.Audio = originalAudio;
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("boosted sound bursts share one context and disconnect every node", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const originalAudio = globalThis.Audio;
    const originalAudioContext = globalThis.AudioContext;
    const players: Array<{ pauseCalls: number; handlers: Partial<Record<"ended" | "error", () => void>>; }> = [];
    const sources: Array<{ disconnectCalls: number; }> = [];
    const gains: Array<{ disconnectCalls: number; gain: { value: number; }; }> = [];
    let contextCount = 0;
    let closeCalls = 0;
    let resumeCalls = 0;
    let throwNextConnect = false;

    class FakeAudio {
        volume = 1;
        pauseCalls = 0;
        handlers: Partial<Record<"ended" | "error", () => void>> = {};
        constructor(_url: string) { players.push(this); }
        addEventListener(event: "ended" | "error", handler: () => void) { this.handlers[event] = handler; }
        pause() { this.pauseCalls++; }
        play() { return Promise.resolve(); }
    }

    class FakeAudioContext {
        destination = {} as AudioDestinationNode;
        state: AudioContextState = "suspended";
        constructor() { contextCount++; }
        createMediaElementSource() {
            const mustThrow = throwNextConnect;
            throwNextConnect = false;
            const source = { connect() { if (mustThrow) throw new Error("connect failed"); }, disconnectCalls: 0, disconnect() { this.disconnectCalls++; } };
            sources.push(source);
            return source;
        }
        createGain() {
            const gain = { gain: { value: 1 }, connect() { }, disconnectCalls: 0, disconnect() { this.disconnectCalls++; } };
            gains.push(gain);
            return gain;
        }
        resume() { resumeCalls++; this.state = "running"; return Promise.resolve(); }
        close() { closeCalls++; return Promise.resolve(); }
    }

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: { pluginHelpers: { KeywordNotify: { loadAudioFile: async () => ({ ok: true, data: new Uint8Array([1]), mimeType: "audio/wav", fileName: "boost.wav" }) } } }
    });
    globalThis.Audio = FakeAudio as unknown as typeof Audio;
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;

    try {
        assert.equal(await loadCustomAudio("link"), "boost.wav");
        assert.equal(await playCustomAudio("link", 250), true);
        assert.equal(await playCustomAudio("link", 300), true);
        assert.equal(await playCustomAudio("link", 200), true);
        assert.equal(contextCount, 1);
        assert.deepEqual(gains.map(gain => gain.gain.value), [2.5, 3, 2]);
        assert.equal(resumeCalls, 1);

        players[0].handlers.ended?.();
        players[1].handlers.error?.();
        throwNextConnect = true;
        assert.equal(await playCustomAudio("link", 250), false);
        assert.deepEqual(players.map(player => player.pauseCalls), [1, 1, 0, 1]);
        assert.deepEqual(sources.map(source => source.disconnectCalls), [1, 1, 0, 1]);
        assert.deepEqual(gains.map(gain => gain.disconnectCalls), [1, 1, 0, 1]);

        stopCustomAudio();
        assert.deepEqual(players.map(player => player.pauseCalls), [1, 1, 1, 1]);
        assert.deepEqual(sources.map(source => source.disconnectCalls), [1, 1, 1, 1]);
        assert.deepEqual(gains.map(gain => gain.disconnectCalls), [1, 1, 1, 1]);
        assert.equal(closeCalls, 1);
    } finally {
        stopCustomAudio();
        globalThis.Audio = originalAudio;
        globalThis.AudioContext = originalAudioContext;
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("custom mention playback failure uses configured capped volume", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const originalAudio = globalThis.Audio;
    const originalAudioContext = globalThis.AudioContext;
    let rejectPlayback: ((error: Error) => void) | undefined;
    let fallbackVolume = -1;

    class RejectingAudio {
        volume = 1;
        addEventListener() { }
        pause() { }
        play() { return new Promise<void>((_resolve, reject) => rejectPlayback = reject); }
    }

    class FakeAudioContext {
        destination = {} as AudioDestinationNode;
        createMediaElementSource() { return { connect() { }, disconnect() { } }; }
        createGain() { return { gain: { value: 1 }, connect() { }, disconnect() { } }; }
        close() { return Promise.resolve(); }
    }

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: { pluginHelpers: { KeywordNotify: { loadAudioFile: async () => ({ ok: true, data: new Uint8Array([1]), mimeType: "audio/wav", fileName: "sound.wav" }) } } }
    });

    globalThis.Audio = RejectingAudio as unknown as typeof Audio;
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;

    try {
        assert.equal(await loadCustomAudio("mention"), "sound.wav");
        const replacement = replaceMentionNotificationSound(
            "mention1",
            true,
            { enabled: true, volume: 250 },
            (_sound, volume) => { fallbackVolume = volume; }
        );
        assert.equal(replacement, undefined);
        rejectPlayback?.(new Error("failed"));
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(fallbackVolume, 1);
    } finally {
        stopCustomAudio();
        globalThis.Audio = originalAudio;
        globalThis.AudioContext = originalAudioContext;
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("does not continue after teardown during audio context resume", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const originalAudio = globalThis.Audio;
    const originalAudioContext = globalThis.AudioContext;
    let resolveResume: (() => void) | undefined;
    let playCalls = 0;
    let sourceDisconnects = 0;
    let gainDisconnects = 0;

    class FakeAudio {
        volume = 1;
        addEventListener() { }
        pause() { }
        play() { playCalls++; return Promise.resolve(); }
    }

    class FakeAudioContext {
        destination = {} as AudioDestinationNode;
        state: AudioContextState = "suspended";
        createMediaElementSource() { return { connect() { }, disconnect() { sourceDisconnects++; } }; }
        createGain() { return { gain: { value: 1 }, connect() { }, disconnect() { gainDisconnects++; } }; }
        resume() { return new Promise<void>(resolve => resolveResume = resolve); }
        close() { return Promise.resolve(); }
    }

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: { pluginHelpers: { KeywordNotify: { loadAudioFile: async () => ({ ok: true, data: new Uint8Array([1]), mimeType: "audio/wav", fileName: "sound.wav" }) } } }
    });
    globalThis.Audio = FakeAudio as unknown as typeof Audio;
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;

    try {
        assert.equal(await loadCustomAudio("link"), "sound.wav");
        const pending = playCustomAudio("link", 250);
        await Promise.resolve();
        stopCustomAudio();
        resolveResume?.();
        assert.equal(await pending, false);
        assert.equal(playCalls, 0);
        assert.equal(sourceDisconnects, 1);
        assert.equal(gainDisconnects, 1);
    } finally {
        stopCustomAudio();
        globalThis.Audio = originalAudio;
        globalThis.AudioContext = originalAudioContext;
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("returns false after teardown while media playback is pending", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const originalAudio = globalThis.Audio;
    let resolvePlayback: (() => void) | undefined;

    class PendingAudio {
        volume = 1;
        addEventListener() { }
        pause() { }
        play() { return new Promise<void>(resolve => resolvePlayback = resolve); }
    }

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: { pluginHelpers: { KeywordNotify: { loadAudioFile: async () => ({ ok: true, data: new Uint8Array([1]), mimeType: "audio/wav", fileName: "sound.wav" }) } } }
    });
    globalThis.Audio = PendingAudio as unknown as typeof Audio;

    try {
        assert.equal(await loadCustomAudio("link"), "sound.wav");
        const pending = playCustomAudio("link", 40);
        await Promise.resolve();
        stopCustomAudio();
        resolvePlayback?.();
        assert.equal(await pending, false);
    } finally {
        stopCustomAudio();
        globalThis.Audio = originalAudio;
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("does not continue after audio replacement during context resume", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const originalAudio = globalThis.Audio;
    const originalAudioContext = globalThis.AudioContext;
    let resolveResume: (() => void) | undefined;
    let loadCalls = 0;
    let playCalls = 0;

    class FakeAudio {
        volume = 1;
        addEventListener() { }
        pause() { }
        play() { playCalls++; return Promise.resolve(); }
    }

    class FakeAudioContext {
        destination = {} as AudioDestinationNode;
        state: AudioContextState = "suspended";
        createMediaElementSource() { return { connect() { }, disconnect() { } }; }
        createGain() { return { gain: { value: 1 }, connect() { }, disconnect() { } }; }
        resume() {
            const pending = Promise.withResolvers<void>();
            resolveResume = pending.resolve;
            return pending.promise;
        }
        close() { return Promise.resolve(); }
    }

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: { pluginHelpers: { KeywordNotify: { loadAudioFile: async () => ({ ok: true, data: new Uint8Array([++loadCalls]), mimeType: "audio/wav", fileName: `sound-${loadCalls}.wav` }) } } }
    });
    globalThis.Audio = FakeAudio as unknown as typeof Audio;
    globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;

    try {
        assert.equal(await loadCustomAudio("link"), "sound-1.wav");
        const pending = playCustomAudio("link", 250);
        await Promise.resolve();
        assert.equal(await loadCustomAudio("link"), "sound-2.wav");
        resolveResume?.();
        assert.equal(await pending, false);
        assert.equal(playCalls, 0);
    } finally {
        stopCustomAudio();
        globalThis.Audio = originalAudio;
        globalThis.AudioContext = originalAudioContext;
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("returns false after audio replacement while playback is pending", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const originalAudio = globalThis.Audio;
    let loadCalls = 0;
    let resolvePlayback: (() => void) | undefined;

    class PendingAudio {
        volume = 1;
        addEventListener() { }
        pause() { }
        play() {
            const pending = Promise.withResolvers<void>();
            resolvePlayback = pending.resolve;
            return pending.promise;
        }
    }

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: { pluginHelpers: { KeywordNotify: { loadAudioFile: async () => ({ ok: true, data: new Uint8Array([++loadCalls]), mimeType: "audio/wav", fileName: `sound-${loadCalls}.wav` }) } } }
    });
    globalThis.Audio = PendingAudio as unknown as typeof Audio;

    try {
        assert.equal(await loadCustomAudio("link"), "sound-1.wav");
        const pending = playCustomAudio("link", 40);
        await Promise.resolve();
        assert.equal(await loadCustomAudio("link"), "sound-2.wav");
        resolvePlayback?.();
        assert.equal(await pending, false);
    } finally {
        stopCustomAudio();
        globalThis.Audio = originalAudio;
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("does not play mention fallback after teardown", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const originalAudio = globalThis.Audio;
    let rejectPlayback: ((error: Error) => void) | undefined;
    let fallbackCalls = 0;

    class RejectingAudio {
        currentTime = 0;
        volume = 1;
        addEventListener() { }
        pause() { }
        play() {
            return new Promise<void>((_resolve, reject) => rejectPlayback = reject);
        }
    }

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: {
            pluginHelpers: {
                KeywordNotify: {
                    loadAudioFile: async () => ({ ok: true, data: new Uint8Array([1]), mimeType: "audio/wav", fileName: "sound.wav" })
                }
            }
        }
    });
    globalThis.Audio = RejectingAudio as unknown as typeof Audio;

    try {
        assert.equal(await loadCustomAudio("mention"), "sound.wav");
        const replacement = replaceMentionNotificationSound(
            "mention1",
            true,
            { enabled: true, volume: 40 },
            () => { fallbackCalls++; }
        );
        assert.equal(replacement, undefined);
        stopCustomAudio();
        rejectPlayback?.(new Error("stopped"));
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(fallbackCalls, 0);
    } finally {
        stopCustomAudio();
        globalThis.Audio = originalAudio;
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("allows a new lifecycle load while an old load is pending", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const pendingLoads: Array<PromiseWithResolvers<unknown>> = [];
    let loadCalls = 0;

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: {
            pluginHelpers: {
                KeywordNotify: {
                    loadAudioFile: async () => {
                        loadCalls++;
                        const pending = Promise.withResolvers<unknown>();
                        pendingLoads.push(pending);
                        return await pending.promise;
                    }
                }
            }
        }
    });

    try {
        const oldLoad = loadCustomAudio("link");
        await Promise.resolve();
        stopCustomAudio();
        const newLoad = loadCustomAudio("link");
        await Promise.resolve();
        assert.equal(loadCalls, 2);

        pendingLoads[0].resolve({ ok: true, data: new Uint8Array([1]), mimeType: "audio/wav", fileName: "old.wav" });
        assert.equal(await oldLoad, undefined);
        assert.equal(await loadCustomAudio("link"), undefined);
        assert.equal(loadCalls, 2);

        pendingLoads[1].resolve({ ok: true, data: new Uint8Array([2]), mimeType: "audio/wav", fileName: "new.wav" });
        assert.equal(await newLoad, "new.wav");
    } finally {
        stopCustomAudio();
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("keeps active audio when picker cancellation or clear failure occurs", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: {
            pluginHelpers: {
                KeywordNotify: {
                    loadAudioFile: async () => ({ ok: true, data: new Uint8Array([1]), mimeType: "audio/wav", fileName: "sound.wav" }),
                    selectAudioFile: async () => ({ ok: false, error: "cancelled", reason: "cancelled" }),
                    clearAudioFile: async () => { throw new Error("access denied"); }
                }
            }
        }
    });

    try {
        assert.equal(await loadCustomAudio("link"), "sound.wav");
        assert.equal(isCustomAudioLoaded("link"), true);
        assert.equal(await selectCustomAudio("link"), undefined);
        assert.equal(isCustomAudioLoaded("link"), true);
        assert.equal(await clearCustomAudio("link"), false);
        assert.equal(isCustomAudioLoaded("link"), true);
    } finally {
        stopCustomAudio();
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("replaces a qualified Discord notification sound with loaded custom mention audio", async () => {
    const originalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "VencordNative");
    const originalAudio = globalThis.Audio;
    const players: Array<{ volume: number; playCalls: number; }> = [];
    let fallbackCalls = 0;

    class FakeAudio {
        volume = 1;
        playCalls = 0;
        constructor(_url: string) { players.push(this); }
        addEventListener() { }
        pause() { }
        play() { this.playCalls++; return Promise.resolve(); }
    }

    Object.defineProperty(globalThis, "VencordNative", {
        configurable: true,
        value: { pluginHelpers: { KeywordNotify: { loadAudioFile: async () => ({ ok: true, data: new Uint8Array([1]), mimeType: "audio/mpeg", fileName: "qq.mp3" }) } } }
    });
    globalThis.Audio = FakeAudio as unknown as typeof Audio;

    try {
        assert.equal(await loadCustomAudio("mention"), "qq.mp3");
        const replacement = replaceMentionNotificationSound(
            "mention1",
            true,
            { enabled: true, volume: 70 },
            () => { fallbackCalls++; }
        );
        assert.equal(replacement, undefined);
        await Promise.resolve();
        assert.deepEqual(players.map(player => ({ volume: player.volume, playCalls: player.playCalls })), [
            { volume: 0.7, playCalls: 1 }
        ]);
        assert.equal(fallbackCalls, 0);
    } finally {
        stopCustomAudio();
        globalThis.Audio = originalAudio;
        if (originalNativeDescriptor) Object.defineProperty(globalThis, "VencordNative", originalNativeDescriptor);
        else Reflect.deleteProperty(globalThis, "VencordNative");
    }
});

test("keeps Discord sound for non-mentions and missing custom audio", () => {
    assert.equal(replaceMentionNotificationSound(
        "message1",
        false,
        { enabled: true, volume: 70 },
        () => assert.fail("fallback must not run")
    ), "message1");
    assert.equal(replaceMentionNotificationSound(
        "mention1",
        true,
        { enabled: true, volume: 70 },
        () => assert.fail("fallback must not run")
    ), "mention1");
});
