# KeywordNotify

Maintained fork of [camila314/vencord-KeywordNotify](https://github.com/camila314/vencord-KeywordNotify).

KeywordNotify is a Vencord user plugin that shows a notification card when a Discord message matches a keyword or regular expression.

## Features

- Keyword and regular-expression matching
- Guild, channel, and user allowlists or blocklists
- Clickable Discord notification cards with pinning and History
- X post previews with preserved Discord message context
- Image previews for Discord media
- Custom link and mention sounds with configurable volume
- Configurable notification duration and History limit

## Install

Clone this repository into Vencord's user plugin directory:

```text
src/userplugins/KeywordNotify
```

Then build Vencord and deploy the generated `dist` through the normal Vencord workflow.

## Private data

This repository contains plugin source and tests only. Keyword entries, channel or user IDs, notification History, selected audio, Discord settings, and credentials stay in the local Vencord data stores.
