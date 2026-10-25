# KeywordNotify

KeywordNotify is a Vencord user plugin that shows an in-app notification card when a Discord message matches a configured JavaScript regular expression.

This repository is a maintained fork of [camila314/vencord-KeywordNotify](https://github.com/camila314/vencord-KeywordNotify).

## Features

- Match message content and Discord embed text with JavaScript regular expressions.
- Apply each pattern globally or limit it with guild, channel, and user IDs.
- Ignore bot messages globally, with an explicit whitelist override for a bot user ID.
- Show clickable cards with author, server, channel, message text, mentions, media, and delivery time.
- Preserve Discord message content, structured embeds, fields, media, and attachments in live cards and History.
- Open the original Discord message from a live card or History entry.
- Dismiss every live card at once with `Ctrl+Shift+X` or a double `Escape` press.
- Validate patterns while editing: invalid expressions and nested-quantifier patterns are flagged in the settings UI.
- Evaluate patterns inside a Web Worker with a 200 ms cap, so a pathological pattern cannot freeze Discord.
- Pin cards manually or automatically while Discord is unfocused.
- Keep a configurable local notification History.
- Play Discord or custom sounds for keyword notifications.
- Replace specific mention sounds with a custom sound.
- Use `.mp3`, `.wav`, or `.ogg` custom audio files up to 10 MiB.

## Requirements

- Discord Desktop
- A Vencord source checkout with user plugin support
- The package manager and runtime required by the current Vencord source tree

Custom audio uses Electron APIs. It is intended for Discord Desktop builds.

## Installation

Clone this repository into Vencord's user plugin directory:

```bash
cd Vencord/src/userplugins
git clone https://github.com/asbryx/vencord-KeywordNotify.git KeywordNotify
```

Build and install Vencord from the Vencord repository root:

```bash
cd ../..
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm inject
```

Restart Discord after the build is installed. Then enable **KeywordNotify** in:

```text
User Settings > Vencord > Plugins
```

Vencord can change its build or installation commands. Use the instructions from the Vencord version that you checked out if these commands differ.

## Configuration

Open the KeywordNotify plugin settings from the Vencord Plugins page.

### Keyword entries

Each entry contains these fields:

| Field | Behavior |
| --- | --- |
| Pattern | A JavaScript regular expression. A plain word is also a valid expression. Invalid expressions do not match. |
| Ignore Case | Adds case-insensitive matching for that entry. |
| List Type | Selects Whitelist or Blacklist behavior. |
| IDs | Accepts Discord guild, channel, or user IDs. |

List behavior:

- **Blacklist:** the pattern applies everywhere except the listed IDs.
- **Whitelist:** the pattern applies only when the guild, channel, or author matches a listed ID.
- An empty Blacklist applies the pattern globally.
- An empty Whitelist does not match any message.

The matcher checks message content and these embed fields:

- Author name
- Title and raw title
- Description and raw description
- Field names and values
- Footer text

### Settings

| Setting | Default | Behavior |
| --- | ---: | --- |
| Ignore Bots | On | Ignores bot messages unless a bot user ID is explicitly whitelisted. |
| Sound Enabled | On | Enables sound playback for keyword cards. |
| Link Sound File | None | Uses Discord's message sound until a custom file is selected. |
| Link Volume | 40% | Controls keyword notification volume. Custom sounds support up to 300%. Discord fallback is capped at 100%. |
| Mention Sound Enabled | On | Enables replacement for specific Discord mention sounds when a custom file is selected. |
| Mention Sound File | None | Keeps Discord's mention sound until a custom file is selected. |
| Mention Volume | 40% | Controls custom mention volume up to 300%. |
| Duration | 15 seconds | Closes an unpinned card after the selected time. A value of `0` disables automatic closing. |
| Pin When Unfocused | On | Keeps new cards pinned until Discord regains focus. |
| History Limit | 50 | Keeps the newest `0`, `25`, `50`, `100`, or `200` History entries. |

Custom sound files are copied into Vencord's local plugin data directory. Replacing or clearing a sound removes obsolete copies.

## Card controls

### Live notification cards

- Click the card to open the original Discord message and close the card.
- Focus the card and press `Enter` to perform the same action.
- Right-click the card to close it without navigation.
- Use the pin button to keep or release the card.
- Use the close button to dismiss the card.
- Hovering or focusing a timed card pauses its countdown.
- Press `Ctrl+Shift+X` anywhere in Discord to dismiss every live card, including pinned ones.
- Press `Escape` twice within 400 ms to do the same. A single `Escape` is left untouched, and `Escape` never clears cards while the message box or another text field has focus.
- Links and media inside a card open their own targets without triggering card navigation.

### History

Use **View Keyword Notification History** from the plugin settings.

- Click an entry, or focus it and press `Enter`, to open the original Discord message.
- Use **Clear History** to remove all stored entries after confirmation.
- History respects the configured limit.

## Privacy and local data

The repository contains source code and tests only. It does not contain user configuration or runtime data.

These values stay in local Vencord storage:

- Keyword expressions
- Guild, channel, and user IDs
- Notification History
- Selected custom audio
- Discord and Vencord settings

The included `.gitignore` excludes common environment files, keys, databases, logs, audio files, dependencies, and build output.

## Development

Run the focused tests from a Vencord source checkout:

```bash
pnpm exec tsx --test src/userplugins/KeywordNotify/*.test.ts*
```

Run the Vencord TypeScript check:

```bash
pnpm testTsc
```

The current version passed 109 focused tests, the Vencord TypeScript check, and the production build.

## Releases

Published versions are available on the [GitHub Releases page](https://github.com/asbryx/vencord-KeywordNotify/releases).

## Credits

- Original plugin: [camila314/vencord-KeywordNotify](https://github.com/camila314/vencord-KeywordNotify)
- Maintained fork: [asbryx/vencord-KeywordNotify](https://github.com/asbryx/vencord-KeywordNotify)
- Vencord and its contributors provide the plugin runtime and APIs.

## License

This project is licensed under `GPL-3.0-or-later`. See [LICENSE](LICENSE).
