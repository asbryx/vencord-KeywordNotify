import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { serializeAudioMetadata } from "./audioMetadata";
import { loadStoredAudio } from "./audioStore";

async function makeAudioDirectory() {
    return mkdtemp(join(tmpdir(), "keywordnotify-audio-"));
}

async function writePair(directory: string, audioName: string, fileName: string, data = new Uint8Array([1])) {
    await writeFile(join(directory, audioName), data);
    await writeFile(join(directory, `${audioName}.json`), serializeAudioMetadata(fileName));
}

test("falls back to an older valid pair when newest metadata is corrupt", async () => {
    const directory = await makeAudioDirectory();
    try {
        await writePair(directory, "link-0000000000001-old.wav", "old-alert.wav");
        await writeFile(join(directory, "link-0000000000002-new.wav"), new Uint8Array([2]));
        await writeFile(join(directory, "link-0000000000002-new.wav.json"), "not json");

        const result = await loadStoredAudio(directory, "link");

        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.fileName, "old-alert.wav");
            assert.deepEqual(result.data, new Uint8Array([1]));
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("falls back to an older valid pair when newest audio is missing", async () => {
    const directory = await makeAudioDirectory();
    try {
        await writePair(directory, "mention-0000000000001-old.ogg", "old-mention.ogg", new Uint8Array([3]));
        await writeFile(
            join(directory, "mention-0000000000002-new.ogg.json"),
            serializeAudioMetadata("new-mention.ogg")
        );

        const result = await loadStoredAudio(directory, "mention");

        assert.equal(result.ok, true);
        if (result.ok) {
            assert.equal(result.fileName, "old-mention.ogg");
            assert.deepEqual(result.data, new Uint8Array([3]));
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
