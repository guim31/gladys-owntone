// -----------------------------------------------------------------------------
// OwnTone answers -> the model the hub works on. Every field is checked: a
// missing or odd value becomes a neutral one, never an exception.
//
// /api/player:  { state: play|pause|stop, volume, item_id, shuffle,
//                 repeat: off|all|single, item_length_ms, item_progress_ms }
// /api/outputs: { outputs: [{ id: "100", name, type, selected, volume, ... }] }
// /api/queue?id=<item_id>: { items: [{ id, position, track_id, title, artist,
//                 album, length_ms, uri, data_kind, artwork_url }] }
// (recorded on OwnTone 29.3: test/fixtures/owntone/)
// -----------------------------------------------------------------------------

const MAX_TEXT = 200;

const text = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '');

const percent = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
};

export const PLAYER_STATES = ['play', 'pause', 'stop'];

export const REPEAT_MODES = ['off', 'all', 'single'];

const milliseconds = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
};

/**
 * @returns {{ state: 'play'|'pause'|'stop', volume: number|null, itemId: number,
 *   shuffle: boolean, repeat: 'off'|'all'|'single', progressMs: number, lengthMs: number }}
 */
export function parsePlayer(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const itemId = Number(source.item_id);
  return {
    state: PLAYER_STATES.includes(source.state) ? source.state : 'stop',
    volume: percent(source.volume),
    itemId: Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
    shuffle: source.shuffle === true,
    repeat: REPEAT_MODES.includes(source.repeat) ? source.repeat : 'off',
    progressMs: milliseconds(source.item_progress_ms),
    lengthMs: milliseconds(source.item_length_ms),
  };
}

/** @returns {Map<string, { id, name, type, selected, volume }>} in OwnTone's order */
export function parseOutputs(raw) {
  const outputs = new Map();
  const list = Array.isArray(raw?.outputs) ? raw.outputs : [];
  for (const output of list) {
    if (!output || typeof output !== 'object') {
      continue;
    }
    const id = typeof output.id === 'number' ? String(output.id) : text(output.id);
    if (id === '' || outputs.has(id)) {
      continue;
    }
    outputs.set(id, {
      id,
      name: text(output.name) || id,
      type: text(output.type),
      selected: output.selected === true,
      volume: percent(output.volume),
    });
  }
  return outputs;
}

/**
 * A queue item: what the player shows and what the queue panel lists. Its
 * `artworkUrl` is OwnTone's path (`./artwork/item/<track id>`, with `?v=` for
 * a stream whose metadata changes), relative to the server.
 */
export function parseQueueItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const id = Number(item.id);
  const position = Number(item.position);
  return {
    id: Number.isInteger(id) ? id : 0,
    position: Number.isInteger(position) && position >= 0 ? position : null,
    title: text(item.title),
    artist: text(item.artist),
    album: text(item.album),
    lengthMs: milliseconds(item.length_ms),
    uri: typeof item.uri === 'string' ? item.uri : '',
    stream: item.data_kind === 'url',
    artworkUrl: typeof item.artwork_url === 'string' ? item.artwork_url : '',
  };
}

/** The queue item being played, from /api/queue?id=..., or null. */
export function parseItem(raw, itemId) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return parseQueueItem(items.find((candidate) => Number(candidate?.id) === itemId));
}

/** "Title — Artist", or the title alone; '' when OwnTone gives nothing. */
export function trackText(item) {
  if (!item) {
    return '';
  }
  if (item.title && item.artist) {
    return `${item.title} — ${item.artist}`.slice(0, MAX_TEXT);
  }
  return item.title || item.artist || '';
}
