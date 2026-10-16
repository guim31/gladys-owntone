// -----------------------------------------------------------------------------
// OwnTone -> Gladys devices, and the model -> states.
//
// The player is one device: volume (OwnTone's master volume), play, pause,
// previous, next and playback state, all in the `music` category so the core
// "Music" dashboard box drives it (it needs them on one device), and what
// plays as a read-only text.
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
} from '@gladysassistant/integration-sdk';
import { trackText } from './owntone/model.js';
import { OUTPUT_NAMES, PLAYER_NAMES, STATE_LABELS, pick } from './texts.js';

export const PLAYER_TYPE = 'player';
export const OUTPUT_TYPE = 'output';
export const PLAYER_PLATFORM_ID = 'owntone';

const MAX_TEXT = 200;

// key -> [category, type, read_only, min, max, has_feedback]
export const PLAYER_FEATURES = {
  volume: [CAT.MUSIC, TYPE.MUSIC.VOLUME, false, 0, 100, true],
  playback_state: [CAT.MUSIC, TYPE.MUSIC.PLAYBACK_STATE, true, 0, 1, false],
  play: [CAT.MUSIC, TYPE.MUSIC.PLAY, false, 0, 1, false],
  pause: [CAT.MUSIC, TYPE.MUSIC.PAUSE, false, 0, 1, false],
  previous: [CAT.MUSIC, TYPE.MUSIC.PREVIOUS, false, 0, 1, false],
  next: [CAT.MUSIC, TYPE.MUSIC.NEXT, false, 0, 1, false],
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
  return Object.entries(table).map(([key, [category, type, readOnly, min, max, feedback]]) => ({
    name: names[key],
    external_id: ids.feature(key),
    category,
    type,
    read_only: readOnly,
    has_feedback: feedback,
    // A text or a push button has no history worth keeping.
    keep_history: category !== CAT.TEXT && !['play', 'pause', 'previous', 'next'].includes(key),
    min,
    max,
  }));
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

/** The states of the player, in the publishStates format. */
export function buildPlayerStates(gladys, model, online, language) {
  const ids = playerIds(gladys);
  const states = [
    {
      device_feature_external_id: ids.feature('playback_state'),
      state: online && model.player.state === 'play' ? 1 : 0,
    },
    {
      device_feature_external_id: ids.feature('now_playing'),
      text: playerText(model, online, language),
    },
  ];
  if (online && model.player.volume !== null) {
    states.push({ device_feature_external_id: ids.feature('volume'), state: model.player.volume });
  }
  return states;
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
