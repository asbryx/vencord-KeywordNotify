export interface NotificationCardActions {
    remove(): void;
    navigate(): void;
}

export function handleNotificationCardAction(
    action: "open" | "dismiss",
    actions: NotificationCardActions,
    event?: Pick<MouseEvent, "preventDefault">
) {
    if (action === "dismiss") {
        event?.preventDefault();
        actions.remove();
        return;
    }

    actions.navigate();
    actions.remove();
}

export interface NestedNotificationEvent {
    type: string;
    target: EventTarget | null;
    stopPropagation(): void;
}

export function routeNestedNotificationInteraction(event: NestedNotificationEvent) {
    if (event.type !== "click") return;

    const target = event.target as { closest?(selector: string): Element | null; } | null;
    if (target?.closest?.("a, button")) event.stopPropagation();
}
