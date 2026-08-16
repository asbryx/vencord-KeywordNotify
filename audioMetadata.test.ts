import assert from "node:assert/strict";
import test from "node:test";

import { parseAudioMetadata, serializeAudioMetadata } from "./audioMetadata";

test("preserves the original selected audio basename", () => {
    assert.deepEqual(parseAudioMetadata(serializeAudioMetadata("alert.wav")), { fileName: "alert.wav" });
});

test("rejects malformed or path-taking audio metadata", () => {
    assert.equal(parseAudioMetadata("not json"), undefined);
    assert.equal(parseAudioMetadata(JSON.stringify({ fileName: "C:\\Sounds\\alert.wav" })), undefined);
    assert.equal(parseAudioMetadata(JSON.stringify({ fileName: "../alert.wav" })), undefined);
    assert.equal(parseAudioMetadata(JSON.stringify({ fileName: "" })), undefined);
});
