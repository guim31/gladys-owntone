// The parsing of the answers recorded on OwnTone 29.3 (test/fixtures/owntone/).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseItem, parseOutputs, parsePlayer, trackText } from '../src/owntone/model.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/owntone/${name}.json`, import.meta.url), 'utf8'));

test('player, outputs and the item being played, as recorded', async () => {
  const player = parsePlayer(await fixture('player-play'));
  assert.equal(player.state, 'play');
  assert.ok(player.itemId > 0);
  const outputs = parseOutputs(await fixture('outputs'));
  assert.deepEqual(
    [...outputs.values()].map((o) => [o.id, o.name, o.type, o.selected]),
    [
      ['0', 'Computer', 'ALSA', false],
      ['100', 'Kitchen fifo', 'fifo', true],
    ],
  );
  const item = parseItem(await fixture('queue-item'), player.itemId);
  assert.deepEqual(item, {
    title: 'Test tone 1',
    artist: 'Bench Ensemble',
    album: 'Sine Sessions',
  });
  assert.equal(trackText(item), 'Test tone 1 — Bench Ensemble');
});

test('odd answers become neutral values', () => {
  assert.deepEqual(parsePlayer(null), { state: 'stop', volume: null, itemId: 0 });
  assert.deepEqual(parsePlayer({ state: 'dance', volume: 250, item_id: -3 }), {
    state: 'stop',
    volume: 100,
    itemId: 0,
  });
  const outputs = parseOutputs({
    outputs: [{ id: 7, name: ' ', volume: 'x' }, { id: '7' }, null, { name: 'no id' }],
  });
  assert.deepEqual(
    [...outputs.values()],
    [{ id: '7', name: '7', type: '', selected: false, volume: null }],
  );
  assert.equal(parseItem({ items: [] }, 3), null);
  assert.equal(trackText({ title: '', artist: 'Radio FIP', album: '' }), 'Radio FIP');
});
