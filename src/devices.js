// -----------------------------------------------------------------------------
// OwnTone -> Gladys devices, and the model -> states.
//
// The player is one device: volume (OwnTone's master volume), play, pause,
// previous, next and playback state, all in the `music` category so the core
// "Music" dashboard box drives it (it needs them on one device), and what
// plays as a read-only text. Since Gladys 5.3 (1.1.0) it also carries the
// now-playing features of the core music player: title, artist, album,
// artwork (an image key), duration, position (writable: seek), shuffle and
// repeat; playback_state became writable (0 pause, 1 play, 2 stop). OwnTone
// has no mute: none is published. The catalog (queue, browse, search) is in
// src/catalog.js.
//
// Each output (an AirPlay or Chromecast speaker, the local audio, the fifo)
// is a device too: selected (switch/binary: OwnTone plays to it) and its own
// volume. No play button there: the core Music box lists every device with
// music/play, and an output does not play by itself.
//
// External ids: the player is the server (one per integration); an output
// keeps the id OwnTone gives it (derived from the speaker's own id for
// AirPlay and Chromecast, 0 for the local audio, 100 for the fifo), never its
// name. Feature keys are forever.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
} from '@gladysassistant/integration-sdk';
import { trackText } from './owntone/model.js';
import { OUTPUT_NAMES, PLAYER_NAMES, STATE_LABELS, pick } from './texts.js';

export const PLAYER_TYPE = 'player';
export const OUTPUT_TYPE = 'output';
export const PLAYER_PLATFORM_ID = 'owntone';

const MAX_TEXT = 200;

// Bound of the duration and the position (24 h: a long mix, an audiobook).
export const MAX_SECONDS = 86_400;

// key -> [category, type, read_only, min, max, has_feedback, unit]
// The key is also the type of a music feature: the feature external ids are
// the `${device}:${type}` publishNowPlaying uses by default.
export const PLAYER_FEATURES = {
  volume: [CAT.MUSIC, TYPE.MUSIC.VOLUME, false, 0, 100, true],
  // PAUSED 0, PLAYING 1, IDLE 2 (stopped); read-only 0-1 before 1.1.0.
  playback_state: [CAT.MUSIC, TYPE.MUSIC.PLAYBACK_STATE, false, 0, MUSIC_PLAYBACK_STATE.IDLE, true],
  play: [CAT.MUSIC, TYPE.MUSIC.PLAY, false, 0, 1, false],
  pause: [CAT.MUSIC, TYPE.MUSIC.PAUSE, false, 0, 1, false],
  previous: [CAT.MUSIC, TYPE.MUSIC.PREVIOUS, false, 0, 1, false],
  next: [CAT.MUSIC, TYPE.MUSIC.NEXT, false, 0, 1, false],
  // String states (min/max: NOT NULL in the core database, meaningless here).
  title: [CAT.MUSIC, TYPE.MUSIC.TITLE, true, 0, 0, false],
  artist: [CAT.MUSIC, TYPE.MUSIC.ARTIST, true, 0, 0, false],
  album: [CAT.MUSIC, TYPE.MUSIC.ALBUM, true, 0, 0, false],
  artwork: [CAT.MUSIC, TYPE.MUSIC.ARTWORK, true, 0, 0, false],
  duration: [CAT.MUSIC, TYPE.MUSIC.DURATION, true, 0, MAX_SECONDS, false, UNIT.SECONDS],
  position: [CAT.MUSIC, TYPE.MUSIC.POSITION, false, 0, MAX_SECONDS, true, UNIT.SECONDS],
  shuffle: [CAT.MUSIC, TYPE.MUSIC.SHUFFLE, false, 0, 1, true],
  repeat: [CAT.MUSIC, TYPE.MUSIC.REPEAT, false, 0, MUSIC_REPEAT_MODE.ONE, true],
  now_playing: [CAT.TEXT, TYPE.TEXT.TEXT, true, 0, 0, false],
};

export const OUTPUT_FEATURES = {
  selected: [CAT.SWITCH, TYPE.SWITCH.BINARY, false, 0, 1, true],
  volume: [CAT.MUSIC, TYPE.MUSIC.VOLUME, false, 0, 100, true],
};

// What OwnTone calls its output types, for the device model.
// (OwnTone 29.3 output modules: "AirPlay 2", "AirPlay 1", "Chromecast",
// "ALSA", "Pulseaudio", "fifo", "RCP/SoundBridge").
const OUTPUT_KINDS = {
  'airplay 2': 'AirPlay 2',
  'airplay 1': 'AirPlay',
  chromecast: 'Chromecast',
  alsa: 'ALSA',
  pulseaudio: 'PulseAudio',
  fifo: 'FIFO',
};

/**
 * The platform id of an OwnTone output id: kept when it is digits (what
 * OwnTone gives), else a slug and a short hash of the exact id.
 */
export function platformIdOf(id) {
  const text = String(id);
  if (/^[0-9a-z]+$/.test(text)) {
    return text;
  }
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 8);
  return base === '' ? hash : `${base}-${hash}`;
}

export const playerIds = (gladys) => gladys.externalIds(PLAYER_TYPE, PLAYER_PLATFORM_ID);
export const outputIds = (gladys, id) => gladys.externalIds(OUTPUT_TYPE, platformIdOf(id));

export const outputKind = (output) =>
  OUTPUT_KINDS[String(output?.type ?? '').toLowerCase()] ?? (output?.type || 'OwnTone');

function features(ids, table, names) {
  return Object.entries(table).map(
    ([key, [category, type, readOnly, min, max, feedback, unit]]) => ({
      name: names[key],
      external_id: ids.feature(key),
      category,
      type,
      ...(unit ? { unit } : {}),
      read_only: readOnly,
      has_feedback: feedback,
      // A text has no history; nor has any music feature (Gladys 5.3 forces it
      // off on the whole category).
      keep_history: category !== CAT.TEXT && category !== CAT.MUSIC,
      min,
      max,
    }),
  );
}

/**
 * @param {object} gladys
 * @param {{ version?: string }} server
 * @param {string} language
 */
export function buildPlayerDevice(gladys, server, language) {
  const ids = playerIds(gladys);
  return {
    name: 'OwnTone',
    external_id: ids.device,
    model: server?.version ? `OwnTone ${server.version}`.slice(0, 60) : 'OwnTone',
    should_poll: false,
    features: features(ids, PLAYER_FEATURES, pick(PLAYER_NAMES, language)),
  };
}

/**
 * @param {object} gladys
 * @param {{ id, name, type }} output see src/owntone/model.js
 * @param {string} language
 */
export function buildOutputDevice(gladys, output, language) {
  const ids = outputIds(gladys, output.id);
  return {
    name: output.name.slice(0, 60),
    external_id: ids.device,
    model: `OwnTone output (${outputKind(output)})`.slice(0, 60),
    should_poll: false,
    features: features(ids, OUTPUT_FEATURES, pick(OUTPUT_NAMES, language)),
    params: [{ name: 'OWNTONE_OUTPUT_ID', value: output.id }],
  };
}

/** What the player plays, for the text feature and the widget (never empty). */
export function playerText(model, online, language) {
  const labels = pick(STATE_LABELS, language);
  if (!online) {
    return labels.offline;
  }
  const { state } = model.player;
  const track = trackText(model.item);
  if (state === 'play') {
    return track || labels.play;
  }
  return (track ? `${labels[state]} · ${track}` : labels[state]).slice(0, MAX_TEXT);
}

/** The text state of the player (the music features: nowPlaying). */
export function buildPlayerStates(gladys, model, online, language) {
  return [
    {
      device_feature_external_id: playerIds(gladys).feature('now_playing'),
      text: playerText(model, online, language),
    },
  ];
}

const PLAYBACK_STATES = {
  play: MUSIC_PLAYBACK_STATE.PLAYING,
  pause: MUSIC_PLAYBACK_STATE.PAUSED,
  stop: MUSIC_PLAYBACK_STATE.IDLE,
};

export const REPEAT_STATES = {
  off: MUSIC_REPEAT_MODE.OFF,
  all: MUSIC_REPEAT_MODE.ALL,
  single: MUSIC_REPEAT_MODE.ONE,
};

const seconds = (ms) => Math.min(MAX_SECONDS, Math.max(0, Math.round((ms ?? 0) / 1000)));

/**
 * The snapshot given to publishNowPlaying (Gladys 5.3). Nothing loaded, or
 * the server offline: the texts are cleared explicitly (an absent key means
 * "unchanged"). Stopped with an item still loaded (OwnTone keeps it): IDLE,
 * the track stays shown. A stream (an internet radio): duration 0 (live).
 * @param {object} model the hub's model
 * @param {boolean} online
 * @param {(item: object) => string|null} artworkUrl absolute URL of an item's artwork
 */
export function nowPlaying(model, online, artworkUrl = () => null) {
  const { player } = model;
  const item = online && player.itemId > 0 ? model.item : null;
  const snapshot = {
    playback_state: online ? PLAYBACK_STATES[player.state] : MUSIC_PLAYBACK_STATE.IDLE,
    title: item?.title ?? '',
    artist: item?.artist ?? '',
    album: item?.album ?? '',
    artwork_url: item ? artworkUrl(item) : null,
    duration: item && !item.stream ? seconds(player.lengthMs || item.lengthMs) : 0,
    position: item && player.state !== 'stop' ? seconds(player.progressMs) : 0,
  };
  if (online) {
    snapshot.shuffle = player.shuffle ? 1 : 0;
    snapshot.repeat = REPEAT_STATES[player.repeat];
    if (player.volume !== null) {
      snapshot.volume = player.volume;
    }
  }
  return snapshot;
}

/**
 * The states of an output. One that left OwnTone (a speaker switched off) or
 * a server offline reads as not selected; its volume stays as last seen.
 */
export function buildOutputStates(gladys, output, present) {
  const ids = outputIds(gladys, output.id);
  const states = [
    {
      device_feature_external_id: ids.feature('selected'),
      state: present && output.selected ? 1 : 0,
    },
  ];
  if (output.volume !== null) {
    states.push({ device_feature_external_id: ids.feature('volume'), state: output.volume });
  }
  return states;
}

/** The feature key of a feature external id (`...:output:100:volume` -> `volume`). */
export function featureKeyOf(externalId) {
  return typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
}
