// -----------------------------------------------------------------------------
// The "OwnTone" widget: its content fits the core vocabulary and budget
// (validateWidgetContent), its buttons act on the server.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { AIRPLAY, FIFO } from './helpers/fakeOwntone.js';
import { createAll, createWorld, until } from './helpers/world.js';
import { WIDGET_ACTIONS } from '../src/widgets.js';

async function world(t) {
  const w = await createWorld();
  t.after(() => w.stop());
  await createAll(w);
  return w;
}

const get = async (gladys, language = 'en') => {
  const ack = await gladys.fake.widgetGet('player', { settings: {}, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'rendered as sent');
  return ack.data.content;
};

const buttons = (content) =>
  content.components.filter((c) => c.type === 'button').map((c) => c.action.key);

const press = (gladys, key) => gladys.fake.widgetAction('player', key, {}, { settings: {} });

test('what plays, the state, the volume, the outputs and four buttons', async (t) => {
  const { gladys, server } = await world(t);
  server.output(FIFO).selected = true;
  server.playQueue();
  await until(async () => (await get(gladys)).components[0].text === 'Test tone 1');
  const content = await get(gladys, 'fr');
  assert.deepEqual(content.components.slice(0, 3), [
    { type: 'text', variant: 'heading', text: 'Test tone 1' },
    { type: 'text', variant: 'caption', text: 'Bench Ensemble · Sine Sessions' },
    {
      type: 'status',
      items: [
        { label: 'État', value: 'En lecture', color: 'success' },
        { label: 'Volume', value: '50 %', icon: 'volume-2' },
      ],
    },
  ]);
  const list = content.components[3];
  assert.deepEqual(
    list.items.map((i) => [i.title, i.subtitle, i.badge.text]),
    [
      ['Kitchen fifo', 'FIFO', '50 %'],
      ['Computer', 'ALSA', 'Éteinte'],
      ['Living room', 'AirPlay 2', 'Éteinte'],
    ],
  );
  assert.deepEqual(buttons(content), WIDGET_ACTIONS);
  assert.equal(content.components.find((c) => c.type === 'button').label, 'Pause');
  assert.ok(content.components.length <= 8);
});

test('the buttons drive the player; their toasts in four languages', async (t) => {
  const { gladys, server } = await world(t);
  server.playQueue();
  await until(async () => (await get(gladys)).components[0].text === 'Test tone 1');
  let ack = await press(gladys, 'play_pause');
  assert.equal(ack.data.message.fr, 'En pause.');
  assert.equal(server.player.state, 'pause');
  await until(async () => (await get(gladys)).components[2].items[0].value === 'Paused');
  ack = await press(gladys, 'next');
  assert.equal(ack.data.message.de, 'Nächster Titel.');
  assert.equal(server.player.item_id, server.queue[1].id);
  ack = await press(gladys, 'volume_up');
  assert.equal(ack.data.message.es, 'Volumen cambiado.');
  assert.equal(server.player.volume, 55);
  await until(async () => (await get(gladys)).components[2].items[1].value === '55 %');
  await press(gladys, 'volume_down');
  assert.equal(server.player.volume, 50);
  await until(async () => (await get(gladys)).components[2].items[1].value === '50 %');
  ack = await press(gladys, 'play_pause');
  assert.equal(ack.data.message.en, 'Playing.');
  assert.equal(server.player.state, 'play');
});

test('nothing in the queue; then the server gone', async (t) => {
  const { gladys, server } = await world(t);
  let content = await get(gladys);
  assert.equal(content.components[0].text, 'Nothing in the queue');
  assert.equal(content.components[1].type, 'status', 'no caption without a track');
  const ack = await press(gladys, 'play_pause');
  assert.match(ack.data.message.en, /queue is empty/);

  server.output(AIRPLAY).name = 'Living room speaker with a very long name that goes on';
  await server.close();
  await until(async () => (await get(gladys)).components.length === 1, 2000, 'unavailable');
  content = await get(gladys, 'de');
  assert.equal(content.components[0].text, 'Der OwnTone-Server ist nicht erreichbar.');
  const offline = await press(gladys, 'volume_up');
  assert.match(offline.data.message.en, /unreachable/);
});
