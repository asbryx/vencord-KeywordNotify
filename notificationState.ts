export function enforceNotificationCapacity<T extends { pinSource: string | null; }>(notifications: readonly T[]) {
    let timedNotifications = 0;
    return notifications.filter(notification => notification.pinSource !== null || timedNotifications++ < 20);
}

export class SerialTaskQueue {
    private pending = Promise.resolve();

    enqueue(task: () => void | Promise<void>) {
        const result = this.pending.then(task);
        this.pending = result.catch(() => undefined);
        return result;
    }
}

interface PersistedNotification {
    messageId?: unknown;
}

export class NotificationHistoryPersistence {
    private readonly pending = new Set<string>();
    private readonly persisted = new Set<string>();

    sync(history: unknown) {
        this.persisted.clear();
        if (!Array.isArray(history)) return;

        for (const entry of history as PersistedNotification[]) {
            if (typeof entry?.messageId === "string") this.persisted.add(entry.messageId);
        }
    }

    reset(history?: unknown) {
        this.pending.clear();
        this.sync(history);
    }

    begin(messageId: string) {
        this.pending.add(messageId);
    }

    complete(messageId: string, history: unknown) {
        this.pending.delete(messageId);
        this.sync(history);
    }

    cancel(messageId: string) {
        this.pending.delete(messageId);
    }

    enqueueUpdate(messageId: string, queue: SerialTaskQueue, update: () => void | Promise<void>) {
        if (!this.pending.has(messageId) && !this.persisted.has(messageId)) return;
        return queue.enqueue(() => {
            if (this.persisted.has(messageId)) return update();
        });
    }

}

export interface ClosableNotification {
    close(): void;
}

export class NativeNotificationTracker<T extends ClosableNotification> {
    private readonly active = new Set<T>();

    track(notification: T) {
        this.active.add(notification);
    }

    forget(notification: T) {
        this.active.delete(notification);
    }

    consume(notification: T, isCurrent: boolean) {
        if (!this.active.delete(notification)) return false;
        notification.close();
        return isCurrent;
    }

    closeAll() {
        const notifications = [...this.active];
        this.active.clear();
        for (const notification of notifications) notification.close();
    }
}
