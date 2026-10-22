# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-16

### Added

- The OwnTone player as a Gladys device: play, pause, previous, next, master volume, playback state
  and what plays, driven by the core Music dashboard box.
- One device per OwnTone output (AirPlay, Chromecast, local audio): selected and volume.
- Live states through OwnTone's WebSocket notifications, with a full read every minute, or every
  5 seconds when the WebSocket cannot be reached.
- Optional admin password, for a Gladys outside OwnTone's trusted networks.
- Dashboard widget "OwnTone": what plays, state, volume, outputs, and play/pause, next and volume
  buttons.
- Scene triggers: playback started, playback stopped, output disappeared, output appeared.
- Scene actions: play a playlist on chosen outputs, set a volume, stop everything.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-owntone/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-owntone/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-owntone/releases/tag/v1.0.0
