// -----------------------------------------------------------------------------
// OwnTone answers -> the model the hub works on. Every field is checked: a
// missing or odd value becomes a neutral one, never an exception.
//
// /api/player:  { state: play|pause|stop, volume, item_id, ... }
// /api/outputs: { outputs: [{ id: "100", name, type, selected, volume, ... }] }
// /api/queue?id=<item_id>: { items: [{ id, title, artist, album, ... }] }
// (recorded on OwnTone 29.3: test/fixtures/owntone/)
// -----------------------------------------------------------------------------

const MAX_TEXT = 200;

const text = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '');

const percent = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
};

export const PLAYER_STATES = ['play', 'pause', 'stop'];

/** @returns {{ state: 'play'|'pause'|'stop', volume: number|null, itemId: number }} */
export function parsePlayer(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const itemId = Number(source.item_id);
  return {
    state: PLAYER_STATES.includes(source.state) ? source.state : 'stop',
    volume: percent(source.volume),
    itemId: Number.isInteger(itemId) && itemId > 0 ? itemId : 0,
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

/** The queue item being played, from /api/queue?id=..., or null. */
export function parseItem(raw, itemId) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const item = items.find((candidate) => Number(candidate?.id) === itemId) ?? null;
  if (!item) {
    return null;
  }
  return {
    title: text(item.title),
    artist: text(item.artist),
    album: text(item.album),
  };
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
