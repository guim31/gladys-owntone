# OwnTone

This integration drives an [OwnTone](https://owntone.github.io/owntone-server/) server (formerly
forked-daapd) from Gladys: the player (play, pause, next, volume, what plays) and each output, the
AirPlay and Chromecast speakers or the local audio, which you switch on and off and whose volume you
set room by room. It talks to OwnTone over the local network, through its JSON API, and follows every
change live through its WebSocket. No cloud, no account.

> **Tested against a real OwnTone 29.3 in Docker, without AirPlay or Chromecast speakers: feedback
> welcome.** Playback, volumes, output selection, notifications and the restart of OwnTone were
> exercised for real, on its local and fifo outputs.

## Requirements

- Gladys Assistant 5.1 or later.
- An OwnTone server (version 28 or later) reachable from Gladys on the port of its web interface,
  3689 by default, and on its WebSocket port (`websocket_port` in `owntone.conf`, 3688 by default).
- Gladys in the `trusted_networks` of `owntone.conf`, or the `admin_password` of OwnTone typed in the
  configuration.

## Configuration

1. **Server address**: the IP address or host name of the machine that runs OwnTone, as for its web
   interface. Add `:port` if it is not 3689 (`http://192.168.1.20:3689` is accepted too).
2. **Port**: 3689 unless you changed `port` in the `library` section of `owntone.conf`.
3. **Admin password (optional)**: only when Gladys is outside the `trusted_networks` of OwnTone. By
   default OwnTone trusts the local network (`lan`) and wants no password.
4. **Language**: the language of the feature names and of the texts the integration writes. Feature
   names are set when a device is added.

Then open the **Discover** tab and add the player and the outputs you want.

## Devices

### Player

The OwnTone player, one per server:

- **Volume** (0 to 100): the master volume. OwnTone scales every selected output with it.
- **Playback state**: playing or not.
- **Play**, **Pause**, **Previous**, **Next**: buttons.
- **Now playing**: title and artist, with the state when it is paused or stopped.

These features belong to the Gladys **Music** category: the **Music** box of the dashboard drives
the player.

### Outputs

One device per OwnTone output: AirPlay or Chromecast speaker, local audio (ALSA, PulseAudio), fifo.

- **Selected**: on, OwnTone plays to this output; off, it does not. Switching a speaker on while music
  plays adds it to the group at once.
- **Volume** (0 to 100): the volume of this output.

An output that leaves OwnTone (speaker switched off, off the network) shows as not selected and
keeps its device in Gladys; it comes back on its own.

## Dashboard widget

**OwnTone**: what plays (title, artist, album), the state and the volume of the player, the outputs
with their volume (or "Off"), and four buttons: play or pause, next, volume down, volume up (5 by 5).

## Scene triggers

- **Playback started**: OwnTone starts playing. Variables: title, artist, album.
- **Playback stopped**: OwnTone stops playing, paused or stopped, for 5 seconds at least (OwnTone
  says "paused" for a moment at every track change). Filter: paused, stopped, or both. Variables:
  title, artist, album.
- **Output disappeared**: an output leaves OwnTone. Filter: an output, or any. Variable: the output
  name.
- **Output appeared**: an output comes (back) to OwnTone. Filter: an output, or any. Variable: the
  output name.

## Scene actions

- **Play a playlist**: replaces the queue with an OwnTone playlist and plays it. Type its name (case
  and accents ignored; part of the name is enough when only one playlist matches) or a URI
  (`library:playlist:8`, `spotify:playlist:…`, the address of an internet radio). With up to three
  outputs chosen, only they play; with none, the outputs stay as they are. Output: the name of the
  playlist played.
- **Set the volume**: of one output (a room), or of the player (every selected output follows).
- **Stop everything**: stops playback; or stops it and turns every output off, which frees the AirPlay
  speakers for other apps.

## Scene examples

- **Wake-up music**: at 7:00 on weekdays, "Play a playlist" `Morning` on the bedroom speaker, then
  "Set the volume" of that output to 25.
- **Leaving home**: when the house becomes empty, "Stop everything" with every output off.
- **Lights follow the music**: on "Playback started" after sunset, dim the living room lights; on
  "Playback stopped", bring them back.

## Troubleshooting

- **"The OwnTone server does not answer"**: check the address and the port, then that the web
  interface opens from another device on the network.
- **"OwnTone refused the password"**: type the `admin_password` of `owntone.conf`. OwnTone expects it
  for any address outside its `trusted_networks`.
- **"OwnTone refuses Gladys"**: OwnTone has no `admin_password` and does not trust the network of
  Gladys: set one, or add that network to `trusted_networks`.
- **States arrive every 5 seconds only**: the WebSocket port of OwnTone (3688) cannot be reached, or
  `websocket_port` is 0. The integration then reads OwnTone every 5 seconds. The logs say so at the
  connection.
- **"OwnTone could not use this output"**: the speaker is off, busy with another source, or asks for
  a password or a pairing code: pair it once from the OwnTone web interface.
- **"The OwnTone queue is empty"**: Play needs something in the queue: start a playlist first.

## Limits

- One OwnTone server per integration, typed by hand (the Gladys sandbox carries no mDNS of its own).
- No pairing of AirPlay speakers that ask for a code, and no output password: do it once in the
  OwnTone web interface.
- A playlist is chosen by name or URI: no browsing of the library, albums or artists.
- Developed without AirPlay or Chromecast speakers: their behavior comes from the OwnTone API, not
  from a test with the hardware. Feedback welcome.
