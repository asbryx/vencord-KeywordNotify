import assert from "node:assert/strict";
import test from "node:test";

import { enforceNotificationCapacity, NativeNotificationTracker, NotificationHistoryPersistence, SerialTaskQueue } from "./notificationState";

test("keeps interleaved pinned and newest timed notifications in newest-first order", () => {
    const firstTimed = Array.from({ length: 20 }, (_, index) => ({ id: `timed-${index}`, pinSource: null }));
    const notifications = [
        { id: "pinned-newest", pinSource: "manual" },
        firstTimed[0],
        firstTimed[1],
        { id: "pinned-middle", pinSource: "unfocused" },
        ...firstTimed.slice(2),
        { id: "timed-overflow-0", pinSource: null },
        { id: "timed-overflow-1", pinSource: null },
        { id: "pinned-oldest", pinSource: "manual" }
    ];

    assert.deepEqual(
        enforceNotificationCapacity(notifications).map(notification => notification.id),
        [
            "pinned-newest",
            "timed-0",
            "timed-1",
            "pinned-middle",
            ...Array.from({ length: 18 }, (_, index) => `timed-${index + 2}`),
            "pinned-oldest"
        ]
    );
});

test("closes tracked native notifications and rejects stale clicks", () => {
    const tracker = new NativeNotificationTracker<{ closeCalls: number; close(): void; }>();
    const notification = {
        closeCalls: 0,
        close() { this.closeCalls++; }
    };
    tracker.track(notification);
    tracker.closeAll();
    assert.equal(notification.closeCalls, 1);
    assert.equal(tracker.consume(notification, false), false);
    assert.equal(notification.closeCalls, 1);
});

test("consumes an active native notification only once", () => {
    const tracker = new NativeNotificationTracker<{ closeCalls: number; close(): void; }>();
    const notification = {
        closeCalls: 0,
        close() { this.closeCalls++; }
    };

    tracker.track(notification);
    assert.equal(tracker.consume(notification, true), true);
    assert.equal(tracker.consume(notification, true), false);
    assert.equal(notification.closeCalls, 1);
});

test("serializes history delivery before delayed image enrichment", async () => {
    const queue = new SerialTaskQueue();
    const delivery = Promise.withResolvers<void>();
    const calls: string[] = [];

    const first = queue.enqueue(async () => {
        calls.push("delivery-start");
        await delivery.promise;
        calls.push("delivery-end");
    });
    const second = queue.enqueue(async () => {
        calls.push("enrichment");
    });

    await Promise.resolve();
    assert.deepEqual(calls, ["delivery-start"]);
    delivery.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(calls, ["delivery-start", "delivery-end", "enrichment"]);
});

test("skips delayed history writes for notifications that were not persisted", async () => {
    const queue = new SerialTaskQueue();
    const persistence = new NotificationHistoryPersistence();
    let dataStoreUpdates = 0;

    persistence.sync([]);
    const update = persistence.enqueueUpdate("ephemeral", queue, async () => {
        dataStoreUpdates++;
    });

    assert.equal(update, undefined);
    assert.equal(dataStoreUpdates, 0);
});

test("writes one delayed history update after pending delivery persists the notification", async () => {
    const queue = new SerialTaskQueue();
    const persistence = new NotificationHistoryPersistence();
    const delivery = Promise.withResolvers<void>();
    let dataStoreUpdates = 0;

    persistence.sync([]);
    persistence.begin("persisted");
    const deliveryWrite = queue.enqueue(async () => {
        await delivery.promise;
        persistence.complete("persisted", [{ messageId: "persisted" }]);
    });
    const delayedUpdate = persistence.enqueueUpdate("persisted", queue, async () => {
        dataStoreUpdates++;
    });

    await Promise.resolve();
    assert.equal(dataStoreUpdates, 0);
    delivery.resolve();
    await Promise.all([deliveryWrite, delayedUpdate]);
    assert.equal(dataStoreUpdates, 1);
});

test("skips delayed history writes when pending delivery does not persist the notification", async () => {
    const queue = new SerialTaskQueue();
    const persistence = new NotificationHistoryPersistence();
    let dataStoreUpdates = 0;

    persistence.sync([]);
    persistence.begin("stale");
    const deliveryWrite = queue.enqueue(() => persistence.complete("stale", []));
    const delayedUpdate = persistence.enqueueUpdate("stale", queue, async () => {
        dataStoreUpdates++;
    });

    await Promise.all([deliveryWrite, delayedUpdate]);
    assert.equal(dataStoreUpdates, 0);
});

test("preserves pending delivery across startup history synchronization", async () => {
    const queue = new SerialTaskQueue();
    const persistence = new NotificationHistoryPersistence();
    const startup = Promise.withResolvers<void>();
    const delivery = Promise.withResolvers<void>();
    let dataStoreUpdates = 0;

    const startupSync = queue.enqueue(async () => {
        await startup.promise;
        persistence.sync([]);
    });
    persistence.begin("racing");
    const deliveryWrite = queue.enqueue(async () => {
        await delivery.promise;
        persistence.complete("racing", [{ messageId: "racing" }]);
    });

    startup.resolve();
    await startupSync;
    const delayedUpdate = persistence.enqueueUpdate("racing", queue, async () => {
        dataStoreUpdates++;
    });
    assert.notEqual(delayedUpdate, undefined);

    delivery.resolve();
    await Promise.all([deliveryWrite, delayedUpdate]);
    assert.equal(dataStoreUpdates, 1);
});
