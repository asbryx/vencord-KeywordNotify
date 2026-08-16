import assert from "node:assert/strict";
import test from "node:test";

import { AudioSelectionGeneration } from "./selectionState";

test("rejects a picker that resolves after selection invalidation", async () => {
    const state = new AudioSelectionGeneration();
    const selection = Promise.withResolvers<string>();
    const durableFiles = new Set<string>();

    const pending = (async () => {
        const token = state.capture();
        const selectedFile = await selection.promise;
        if (!state.isCurrent(token)) return undefined;
        return state.commit(
            token,
            async () => {
                durableFiles.add(selectedFile);
                return selectedFile;
            },
            async file => { durableFiles.delete(file); }
        );
    })();

    state.invalidate();
    selection.resolve("new.wav");

    assert.equal(await pending, undefined);
    assert.deepEqual([...durableFiles], []);
});

test("rolls back a durable write invalidated while commit is pending", async () => {
    const state = new AudioSelectionGeneration();
    const token = state.capture();
    const commitStarted = Promise.withResolvers<void>();
    const finishCommit = Promise.withResolvers<void>();
    const durableFiles = new Set<string>();

    const pending = state.commit(
        token,
        async () => {
            commitStarted.resolve();
            await finishCommit.promise;
            durableFiles.add("new.wav");
            return "new.wav";
        },
        async file => { durableFiles.delete(file); }
    );

    await commitStarted.promise;
    state.invalidate();
    finishCommit.resolve();

    assert.equal(await pending, undefined);
    assert.deepEqual([...durableFiles], []);
});
