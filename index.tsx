/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated, camila314, and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { DeleteIcon } from "@components/Icons";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, GuildStore, Select, TextInput, UserStore, useEffect, useState } from "@webpack/common";

import { clearCustomAudio, loadCustomAudio, reconcileAudioFileName, replaceMentionNotificationSound, selectCustomAudio, stopCustomAudio, type CustomAudioKind } from "./audio";
import { KeywordHistoryButton } from "./history";
import { findKeywordMatchAsync, KeywordEntry, ListType } from "./matcher";
import { createMessageSnapshot, createMessageSnapshotMediaUpdate } from "./messageSnapshot";
import { isSpecificMention } from "./mentions";
import { deliverKeywordNotification, enrichKeywordNotificationSnapshot, startKeywordNotificationManager, stopKeywordNotificationManager } from "./notificationManager";

import { resolveLoadedKeywordEntries } from "./state";
import { inspectPattern, regexWorkerGuard } from "./regexGuard";

let keywordEntries: KeywordEntry[] = [];
let audioLifecycleToken = 0;
let keywordMutationRevision = 0;
const keywordEntryListeners = new Set<() => void>();

function notifyKeywordEntriesChanged() {
    for (const listener of keywordEntryListeners) listener();
}

const KEYWORD_ENTRIES_KEY = "KeywordNotify_keywordEntries";
const logger = new Logger("KeywordNotify");

const NotificationSound = findByPropsLazy("playNotificationSound") as {
    playNotificationSound(sound: string, volume: number): void;
};

async function persistEntries() {
    ++keywordMutationRevision;
    await DataStore.set(KEYWORD_ENTRIES_KEY, keywordEntries);
}

async function addKeywordEntry(forceUpdate: () => void) {
    keywordEntries.push({ regex: "", listIds: [], listType: ListType.BlackList, ignoreCase: false });
    await persistEntries();
    forceUpdate();
}

async function removeKeywordEntry(idx: number, forceUpdate: () => void) {
    keywordEntries.splice(idx, 1);
    await persistEntries();
    forceUpdate();
}

function Collapsible({ title, children }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div>
            <Button
                onClick={() => setIsOpen(!isOpen)}
                variant="none"
                size="min"
                className="vc-keywordnotify-collapsible">
                <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ marginLeft: "auto", color: "var(--text-muted)", paddingRight: "5px" }}>{isOpen ? "▼" : "▶"}</div>
                    <Heading tag="h4">{title}</Heading>
                </div>
            </Button>
            {isOpen && children}
        </div>
    );
}

function ListedIds({ listIds, setListIds }) {
    const update = useForceUpdater();
    const values = listIds;

    async function onChange(value: string, index: number) {
        values[index] = value;
        await setListIds(values);
        update();
    }

    return values.map((currentValue: string, index: number) => (
        <Flex flexDirection="row" style={{ marginBottom: "5px" }} key={index}>
            <div style={{ flexGrow: 1 }}>
                <TextInput
                    placeholder="ID"
                    spellCheck={false}
                    value={currentValue}
                    onChange={value => void onChange(value, index)}
                />
            </div>
            <Button
                onClick={() => {
                    values.splice(index, 1);
                    void setListIds(values);
                    update();
                }}
                variant="none"
                size="iconOnly"
                className="vc-keywordnotify-delete">
                <DeleteIcon />
            </Button>
        </Flex>
    ));
}

function ListTypeSelector({ listType, setListType }) {
    return (
        <Select
            options={[
                { label: "Whitelist", value: ListType.Whitelist },
                { label: "Blacklist", value: ListType.BlackList }
            ]}
            placeholder="Select a list type"
            isSelected={value => value === listType}
            closeOnSelect={true}
            select={setListType}
            serialize={value => value}
        />
    );
}

function KeywordEntries() {
    const update = useForceUpdater();
    const values = keywordEntries;
    useEffect(() => {
        keywordEntryListeners.add(update);
        return () => {
            keywordEntryListeners.delete(update);
        };
    }, [update]);

    async function setRegex(index: number, value: string) {
        keywordEntries[index].regex = value;
        await persistEntries();
        update();
    }

    async function setListType(index: number, value: ListType) {
        keywordEntries[index].listType = value;
        await persistEntries();
        update();
    }

    async function setListIds(index: number, value: string[]) {
        keywordEntries[index].listIds = value ?? [];
        await persistEntries();
        update();
    }

    async function setIgnoreCase(index: number, value: boolean) {
        keywordEntries[index].ignoreCase = value;
        await persistEntries();
        update();
    }

    return (
        <>
            {keywordEntries.map((entry, index) => (
                <Collapsible title={`Keyword Entry ${index + 1}`} key={index}>
                    <Flex flexDirection="row">
                        <div style={{ flexGrow: 1 }}>
                            <TextInput
                                placeholder="example|regex"
                                spellCheck={false}
                                value={values[index].regex}
                                onChange={value => void setRegex(index, value)}
                            />
                        </div>
                        <Button
                            onClick={() => void removeKeywordEntry(index, update)}
                            variant="none"
                            size="iconOnly"
                            className="vc-keywordnotify-delete">
                            <DeleteIcon />
                        </Button>
                    </Flex>
                    {inspectPattern(values[index].regex, values[index].ignoreCase ? "i" : "").map((issue, issueIndex) => (
                        <div
                            key={issueIndex}
                            className={`vc-keywordnotify-pattern-${issue.level}`}
                            role={issue.level === "error" ? "alert" : undefined}>
                            {issue.message}
                        </div>
                    ))}
                    <FormSwitch
                        title="Ignore Case"
                        value={values[index].ignoreCase}
                        onChange={value => void setIgnoreCase(index, value)}
                        className={Margins.top8}
                    />
                    <Divider className={[Margins.top8, Margins.bottom8].join(" ")} />
                    <Heading tag="h5">Whitelist/Blacklist</Heading>
                    <Flex flexDirection="row">
                        <div style={{ flexGrow: 1 }}>
                            <ListedIds listIds={values[index].listIds} setListIds={value => setListIds(index, value)} />
                        </div>
                    </Flex>
                    <div className={[Margins.top8, Margins.bottom8].join(" ")} />
                    <Flex flexDirection="row">
                        <Button onClick={() => {
                            values[index].listIds.push("");
                            void persistEntries();
                            update();
                        }}>
                            Add ID
                        </Button>
                        <div style={{ flexGrow: 1 }}>
                            <ListTypeSelector listType={values[index].listType} setListType={value => void setListType(index, value)} />
                        </div>
                    </Flex>
                </Collapsible>
            ))}
            <div><Button onClick={() => void addKeywordEntry(update)}>Add Keyword Entry</Button></div>
        </>
    );
}

function CustomAudioFileSetting({ kind, initialFileName, setValue }: {
    kind: CustomAudioKind;
    initialFileName: string;
    setValue(value: string): void;
}) {
    const [fileName, setFileName] = useState(initialFileName);
    const [busy, setBusy] = useState(false);

    async function selectFile() {
        setBusy(true);
        try {
            const selectedFileName = await selectCustomAudio(kind);
            if (!selectedFileName) return;
            setFileName(selectedFileName);
            setValue(selectedFileName);
        } finally {
            setBusy(false);
        }
    }

    async function clearFile() {
        setBusy(true);
        try {
            if (!await clearCustomAudio(kind)) {
                logger.error(`Failed to clear custom ${kind} sound`);
                return;
            }
            setFileName("");
            setValue("");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Flex flexDirection="row" style={{ alignItems: "center", gap: "8px" }}>
            <div style={{ flexGrow: 1 }}>
                <strong>{kind === "link" ? "Custom link sound" : "Custom mention sound"}</strong>
                <div style={{ color: "var(--text-muted)" }}>{fileName || "Discord default sound"}</div>
            </div>
            <Button disabled={busy} onClick={() => void selectFile()}>Select file</Button>
            {fileName && <Button disabled={busy} variant="secondary" onClick={() => void clearFile()}>Use Discord sound</Button>}
        </Flex>
    );
}

const settings = definePluginSettings({
    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Ignore messages from bots",
        default: true
    },
    soundEnabled: {
        type: OptionType.BOOLEAN,
        description: "Play a sound for keyword link matches",
        default: true
    },
    linkSoundFile: {
        type: OptionType.COMPONENT,
        default: "",
        component: props => (
            <CustomAudioFileSetting kind="link" initialFileName={settings.store.linkSoundFile} setValue={props.setValue} />
        )
    },
    soundVolume: {
        type: OptionType.SLIDER,
        description: "Link notification volume. Custom sounds support boost up to 300%; Discord fallback is capped at 100%.",
        markers: [0, 25, 40, 50, 75, 100, 150, 200, 250, 300],
        default: 40,
        stickToMarkers: false
    },
    mentionSoundEnabled: {
        type: OptionType.BOOLEAN,
        description: "Replace Discord's mention sound with a custom audio file",
        default: true
    },
    mentionSoundFile: {
        type: OptionType.COMPONENT,
        default: "",
        component: props => (
            <CustomAudioFileSetting kind="mention" initialFileName={settings.store.mentionSoundFile} setValue={props.setValue} />
        )
    },
    mentionSoundVolume: {
        type: OptionType.SLIDER,
        description: "Mention notification volume. Custom sounds support boost up to 300%; Discord fallback is capped at 100%.",
        markers: [0, 25, 40, 50, 75, 100, 150, 200, 250, 300],
        default: 40,
        stickToMarkers: false
    },
    durationSeconds: {
        type: OptionType.SLIDER,
        description: "Seconds before an unpinned Discord card closes",
        markers: [0, 5, 10, 15, 30, 60],
        default: 15,
        stickToMarkers: false
    },
    pinWhenUnfocused: {
        type: OptionType.BOOLEAN,
        description: "Pin the Discord card until you return when Discord is not focused",
        default: true
    },
    historyLimit: {
        type: OptionType.SLIDER,
        description: "Number of clickable keyword notifications to keep",
        markers: [0, 25, 50, 100, 200],
        default: 50,
        stickToMarkers: true
    },
    history: {
        type: OptionType.COMPONENT,
        component: () => <KeywordHistoryButton />
    },
    keywords: {
        type: OptionType.COMPONENT,
        component: () => <KeywordEntries />
    }
});

export default definePlugin({
    name: "KeywordNotify",
    authors: [{ name: "camila314", id: 0n }],
    description: "Sends a notification if a message matches a configured keyword or regex",
    settings,

    patches: [{
        find: '"NotificationStore"',
        replacement: {
            match: /sound:(\i\?\i:void 0)(?=,volume:\i,onClick)/,
            replace: "sound:$self.replaceSpecificMentionSound(arguments[0]?.message,$1)"
        }
    }],

    replaceSpecificMentionSound(message: Message | undefined, sound: string | undefined) {
        if (!message || !sound) return sound;
        const currentUser = UserStore.getCurrentUser();
        if (!currentUser) return sound;

        const channel = ChannelStore.getChannel(message.channel_id);
        const guildId = channel?.guild_id;
        const roleIds = guildId ? GuildMemberStore.getMember(guildId, currentUser.id)?.roles ?? [] : [];
        return replaceMentionNotificationSound(
            sound,
            isSpecificMention(message, currentUser.id, roleIds),
            {
                enabled: settings.store.mentionSoundEnabled,
                volume: settings.store.mentionSoundVolume
            },
            (fallbackSound, volume) => NotificationSound.playNotificationSound(fallbackSound, volume)
        );
    },

    start() {
        const lifecycleToken = ++audioLifecycleToken;
        const loadMutationRevision = keywordMutationRevision;
        startKeywordNotificationManager(settings.store.historyLimit);
        void DataStore.get<unknown>(KEYWORD_ENTRIES_KEY).then(entries => {
            const loadedEntries = resolveLoadedKeywordEntries(
                entries,
                lifecycleToken,
                audioLifecycleToken,
                loadMutationRevision,
                keywordMutationRevision
            );
            if (loadedEntries) {
                keywordEntries = loadedEntries;
                notifyKeywordEntriesChanged();
            }
        }).catch(error => logger.error("Failed to load keyword entries", error));

        void loadCustomAudio("link").then(fileName => {
            if (lifecycleToken === audioLifecycleToken) settings.store.linkSoundFile = reconcileAudioFileName(settings.store.linkSoundFile, fileName);
        });
        void loadCustomAudio("mention").then(fileName => {
            if (lifecycleToken === audioLifecycleToken) settings.store.mentionSoundFile = reconcileAudioFileName(settings.store.mentionSoundFile, fileName);
        });
    },

    stop() {
        ++audioLifecycleToken;
        stopCustomAudio();
        stopKeywordNotificationManager();
        regexWorkerGuard.dispose();
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: Message; optimistic?: boolean; }) {
            if (optimistic || !message?.author) return;

            const currentUser = UserStore.getCurrentUser();
            if (!currentUser || message.author.id === currentUser.id) return;

            void (async () => {
                try {
                    const channel = ChannelStore.getChannel(message.channel_id);
                    const guildId = channel?.guild_id;
                    const match = await findKeywordMatchAsync(message, keywordEntries, guildId, settings.store.ignoreBots);
                    if (!match) return;

                    let avatarUrl: string | undefined;
                    try {
                        avatarUrl = message.author.getAvatarURL?.(guildId, 128, false);
                    } catch { }

                    const guild = guildId ? GuildStore.getGuild(guildId) : undefined;
                    const member = guildId ? GuildMemberStore.getMember(guildId, message.author.id) : null;
                    const channelName = channel?.name ? `#${channel.name}` : "Direct Message";
                    const location = guild ? `${guild.name} · ${channelName}` : channelName;
                    const snapshot = createMessageSnapshot(message);


                    deliverKeywordNotification({
                        id: `keyword-${message.id}`,
                        channelId: message.channel_id,
                        guildId,
                        messageId: message.id,
                        authorName: member?.nick || message.author.globalName || message.author.username,
                        authorColor: member?.colorString || message.colorString || undefined,
                        senderType: message.author.bot ? "bot" : "user",
                        avatarUrl,
                        location,
                        snapshot,

                        timestamp: message.timestamp instanceof Date ? message.timestamp.getTime() : Date.now()
                    }, {
                        durationMs: settings.store.durationSeconds * 1000,
                        historyLimit: settings.store.historyLimit,
                        pinWhenUnfocused: settings.store.pinWhenUnfocused,
                        soundEnabled: settings.store.soundEnabled,
                        soundVolume: settings.store.soundVolume
                    });
                } catch (error) {
                    logger.error("Failed to process message", error);
                }
            })();
        },

        MESSAGE_UPDATE({ message }: { message?: unknown; }) {
            const update = createMessageSnapshotMediaUpdate(message);
            if (update) enrichKeywordNotificationSnapshot(update);
        }
    }
});
