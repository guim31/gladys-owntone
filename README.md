# OwnTone for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that drives an
[OwnTone](https://owntone.github.io/owntone-server/) music server (formerly forked-daapd): the player,
and each output (AirPlay and Chromecast speakers, local audio) switched on and off and set room by
room, with scenes when playback starts or stops or when a speaker leaves. It talks to OwnTone over the
local network, through its JSON API (port 3689) and its WebSocket notifications. No cloud, no account.

> **Tested against a real OwnTone 29.3 in Docker, without AirPlay or Chromecast speakers: feedback
> welcome.** Playback, volumes, output selection, notifications, the admin password and a restart of
> OwnTone were exercised for real on its local and fifo outputs, and so was the Gladys 5.3 Music
> player (artwork, queue, search, browsing, shuffle, repeat, seek). Please report what works and what
> does not in the [issues](https://github.com/guim31/gladys-owntone/issues).

## Features

- **The player**: play, pause, previous, next, master volume, playback state and what plays. These
  features belong to the Gladys **Music** category, so the core Music dashboard box drives it.
- **The Gladys 5.3 Music player**: title, artist, album, artwork, duration, position (seek),
  shuffle and repeat on the player, playback state writable (0 pause, 1 play, 2 stop). The core
  Music box gets OwnTone's **queue** (in playing order), **search** (tracks, artists, albums,
  playlists) and **browsing** (playlists, artists, albums, files); an item plays in place of the
  queue, after the current track or at the end (`"music": { "browse", "search", "queue", "append" }`).
  The core scene action "Play music on a speaker" uses the same catalog; chosen on an output, it
  plays on that output only. Artwork is served behind a key, read with the admin password and scaled
  by OwnTone itself (400 px for the player, 128 px for the lists; asked again smaller when a PNG is
  still above the 300 KB Gladys accepts). Players added with 1.0 get the new features through
  **Update** in the Discover tab; playback state then reads 2 (idle) instead of 0 when stopped.
- **One device per output**, keyed on the OwnTone output id: selected (on/off) and its volume.
- **Live**: OwnTone's WebSocket tells what changed and the integration reads it at once; a full read
  every minute (every 5 seconds when the WebSocket cannot be reached).
- **Dashboard widget "OwnTone"**: what plays, the state, the volume, the outputs, and play/pause, next
  and volume buttons.
- **Scene triggers**: playback started, playback stopped (paused or stopped), output disappeared,
  output appeared.
- **Scene actions**: play a playlist by name (or URI) on up to three chosen outputs, set the volume of
  an output or of the player, stop everything (optionally turning every output off).
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.3** or later (1.0.x for Gladys 5.1 and 5.2).
- An OwnTone server (28 or later) reachable from Gladys on its web port (3689) and its WebSocket port
  (3688 by default), with Gladys in its `trusted_networks` or its `admin_password` typed in the
  configuration.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and type
   `https://github.com/guim31/gladys-owntone`.
2. Type the address of the OwnTone server (and its admin password if Gladys is not trusted).
3. Open the **Discover** tab and add the player and the outputs.

The user documentation is in [docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## Limitations

- One server per integration, typed by hand (the Gladys sandbox carries no mDNS of its own).
- No AirPlay pairing code and no output password: do it once in the OwnTone web interface.
- The integration's "play a playlist" action picks a playlist by name or URI (the core action of
  Gladys 5.3 browses the library).
- No mute: OwnTone's API has none.
- OwnTone reports "paused" for about 2 seconds while its outputs start (at every start and track
  change): the "playback stopped" trigger waits for a stop of 5 seconds.
- Developed without AirPlay or Chromecast hardware.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and a scripted OwnTone on the loopback
(`test/helpers/fakeOwntone.js`: JSON API and WebSocket), built on answers recorded on OwnTone 29.3
(`test/fixtures/owntone/`, from a generated test library).

## Credits

- [OwnTone](https://github.com/owntone/owntone-server) (GPL-2.0) by its contributors, and its
  [JSON API documentation](https://owntone.github.io/owntone-server/json-api/).
- The Home Assistant `forked_daapd` integration (Apache-2.0) and the
  [pyforked-daapd](https://github.com/uvjustin/pyforked-daapd) library (MIT), for how they use the API.
- The [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js) and template.

This project is not affiliated with OwnTone or its authors. Apache-2.0 license, see [LICENSE](LICENSE).
