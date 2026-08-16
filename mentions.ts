interface RawMentionUser {
    id?: unknown;
    global_name?: unknown;
    globalName?: unknown;
    username?: unknown;
}

interface MentionMessage {
    mentions?: readonly unknown[] | null;
    mention_roles?: readonly string[] | null;
    mentionRoles?: readonly string[] | null;
    mention_everyone?: boolean;
    mentionEveryone?: boolean;
}

function getMentionId(value: unknown) {
    if (typeof value === "string") return value;
    if (value == null || typeof value !== "object" || Array.isArray(value)) return undefined;
    return getNonEmptyString((value as RawMentionUser).id);
}

export function isSpecificMention(message: MentionMessage, currentUserId: string, currentUserRoleIds: readonly string[]) {
    if (message.mentions?.some(mention => getMentionId(mention) === currentUserId)) return true;

    const currentRoles = new Set(currentUserRoleIds);
    return (message.mention_roles ?? message.mentionRoles ?? []).some(roleId => currentRoles.has(roleId));
}

function getNonEmptyString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function resolveUserMentionNames(
    mentions: readonly unknown[] | null | undefined,
    lookupName: (id: string) => string | undefined
) {
    const names: Record<string, string> = {};
    for (const mention of mentions ?? []) {
        if (typeof mention === "string") {
            const name = lookupName(mention);
            if (name) names[mention] = name;
            continue;
        }
        if (mention == null || typeof mention !== "object" || Array.isArray(mention)) continue;

        const raw = mention as RawMentionUser;
        const id = getNonEmptyString(raw.id);
        if (!id) continue;
        const embeddedName = getNonEmptyString(raw.global_name)
            ?? getNonEmptyString(raw.globalName)
            ?? getNonEmptyString(raw.username);
        const name = embeddedName ?? lookupName(id);
        if (name) names[id] = name;
    }
    return names;
}
