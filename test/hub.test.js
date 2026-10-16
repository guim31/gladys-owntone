// -----------------------------------------------------------------------------
// The hub against the scripted OwnTone: discovery, states both ways, commands,
// scene actions, scene events, the WebSocket and its absence, the password,
// the reconnection.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { ALSA, AIRPLAY, EVENING, FIFO, FakeOwntone } from './helpers/fakeOwntone.js';
import {
  PLAYER_ID,
  createAll,
  createWorld,
  deviceOf,
  featureOf,
  outputId,
  sleep,
  state,
  until,
} from './helpers/world.js';

const FIFO_ID = outputId(FIFO);
const AIRPLAY_ID = outputId(AIRPLAY);

async function ready(options) {
  const world = await createWorld(options);
  await createAll(world);
  await until(() => state(world.gladys, PLAYER_ID, 'volume') !== undefined, 2000, 'states');
  return world;
}

const setValue = (world, id, key, value) =>
  world.gladys.fake.setValue(deviceOf(world.gladys, id), featureOf(world.gladys, id, key), value);

const action = (world, key, fields) => world.gladys.fake.sceneAction(key, fields);

test('discovery: the player and one device per output, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  await until(() => world.gladys.fake.discoveredDevices?.length === 4, 2000, 'four devices');
  const devices = world.gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.external_id, d.name, d.model]),
    [
      [PLAYER_ID, 'OwnTone', 'OwnTone 29.3'],
      [outputId(ALSA), 'Computer', 'OwnTone output (ALSA)'],
      [FIFO_ID, 'Kitchen fifo', 'OwnTone output (FIFO)'],
      [AIRPLAY_ID, 'Living room', 'OwnTone output (AirPlay 2)'],
    ],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  const keys = (id) =>
    deviceOf(world.gladys, id).features.map((f) => f.external_id.split(':').at(-1));
  assert.deepEqual(keys(PLAYER_ID), [
    'volume',
    'playback_state',
    'play',
    'pause',
    'previous',
    'next',
    'now_playing',
  ]);
  assert.deepEqual(keys(AIRPLAY_ID), ['selected', 'volume']);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
});

test('states once the devices are added, then what changes, pushed by the WebSocket', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  assert.equal(state(gladys, PLAYER_ID, 'playback_state'), 0);
  assert.equal(state(gladys, PLAYER_ID, 'now_playing'), 'Stopped');
  assert.equal(state(gladys, PLAYER_ID, 'volume'), 50);
  assert.equal(state(gladys, AIRPLAY_ID, 'selected'), 0);
  assert.equal(state(gladys, AIRPLAY_ID, 'volume'), 30);

  server.playQueue(1);
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 1, 2000, 'playing');
  assert.equal(state(gladys, PLAYER_ID, 'now_playing'), 'Test tone 2 — Bench Ensemble');
  server.setState('pause');
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 0, 2000, 'paused');
  assert.equal(state(gladys, PLAYER_ID, 'now_playing'), 'Paused · Test tone 2 — Bench Ensemble');

  const before = gladys.fake.states.length;
  server.setOutput(AIRPLAY, { selected: true, volume: 45 });
  await until(() => state(gladys, AIRPLAY_ID, 'volume') === 45, 2000, 'airplay volume');
  assert.equal(state(gladys, AIRPLAY_ID, 'selected'), 1);
  await sleep(50);
  const published = gladys.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.ok(
    published.every((id) => id.startsWith(AIRPLAY_ID)),
    `only what changed: ${published}`,
  );
});

test('device controls: player buttons and volume, output switch and volume', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  server.playQueue();
  server.setState('pause');
  await setValue(world, PLAYER_ID, 'play', 1);
  assert.equal(server.player.state, 'play');
  await setValue(world, PLAYER_ID, 'next', 1);
  assert.equal(server.player.item_id, server.queue[1].id);
  await setValue(world, PLAYER_ID, 'previous', 1);
  assert.equal(server.player.item_id, server.queue[0].id);
  await setValue(world, PLAYER_ID, 'pause', 1);
  assert.equal(server.player.state, 'pause');

  await setValue(world, FIFO_ID, 'selected', 1);
  assert.equal(server.output(FIFO).selected, true);
  await setValue(world, FIFO_ID, 'volume', 70);
  assert.equal(server.output(FIFO).volume, 70);
  await setValue(world, PLAYER_ID, 'volume', 20);
  assert.equal(server.player.volume, 20);
  await until(() => state(gladys, FIFO_ID, 'volume') === 20, 2000, 'the output follows');
  await setValue(world, FIFO_ID, 'selected', 0);
  assert.equal(server.output(FIFO).selected, false);

  const body = (path) => server.requests.filter((r) => r.path === path).map((r) => r.body);
  assert.deepEqual(body(`/api/outputs/${FIFO}`), [
    '{"selected":true}',
    '{"volume":70}',
    '{"selected":false}',
  ]);
});

test('a refused command reads as a message, not a crash', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { server } = world;
  const fails = async (id, key, value, pattern) => {
    const ack = await setValue(world, id, key, value);
    assert.equal(ack.success, false);
    assert.match(ack.error, pattern);
  };
  server.failing.add(AIRPLAY);
  await fails(AIRPLAY_ID, 'selected', 1, /could not use this output/);
  // "play" on an empty queue: OwnTone answers 500.
  await fails(PLAYER_ID, 'play', 1, /queue is empty/);
  await fails(PLAYER_ID, 'volume', 140, /from 0 to 100/);
});

test('play_playlist: by name, on the chosen outputs only', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  server.output(ALSA).selected = true;
  let ack = await action(world, 'play_playlist', {
    playlist: '  EVENING ',
    output: FIFO_ID,
    output_2: AIRPLAY_ID,
    output_3: '',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { playlist: 'Evening' });
  assert.equal(server.player.state, 'play');
  assert.deepEqual(
    server.outputs.filter((o) => o.selected).map((o) => o.id),
    [FIFO, AIRPLAY],
  );
  const add = server.requests.find((r) => r.path === '/api/queue/items/add');
  assert.equal(add.query, `?uris=${encodeURIComponent(EVENING)}&clear=true&playback=start`);
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 1, 2000, 'playing');

  // Without output: the selection stays as it is.
  ack = await action(world, 'play_playlist', { playlist: 'Evening' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    server.outputs.filter((o) => o.selected).map((o) => o.id),
    [FIFO, AIRPLAY],
  );

  // An exact name wins over the names that contain it.
  ack = await action(world, 'play_playlist', { playlist: 'morning' });
  assert.deepEqual(ack.data.outputs, { playlist: 'Morning' });

  // A URI is played as typed.
  ack = await action(world, 'play_playlist', { playlist: EVENING });
  assert.deepEqual(ack.data.outputs, { playlist: EVENING });

  const fail = async (fields, pattern) => {
    const result = await action(world, 'play_playlist', fields);
    assert.equal(result.success, false);
    assert.match(result.error, pattern);
  };
  await fail({ playlist: 'Jazz sunday' }, /No OwnTone playlist/);
  await fail({ playlist: 'n' }, /Several OwnTone playlists/);
  await fail({ playlist: 'Morning jazz' }, /nothing OwnTone can play/);
  await fail({ playlist: ' ' }, /Type the name/);
  await fail({ playlist: 'Evening', output: PLAYER_ID }, /not on the OwnTone server/);
});

test('set_volume of an output or of the player; stop_all', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { server } = world;
  let ack = await action(world, 'set_volume', { device: AIRPLAY_ID, volume: '42' });
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.output(AIRPLAY).volume, 42);
  ack = await action(world, 'set_volume', { device: PLAYER_ID, volume: 35 });
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.player.volume, 35);
  ack = await action(world, 'set_volume', { device: AIRPLAY_ID, volume: -1 });
  assert.equal(ack.success, false);

  server.playQueue();
  server.output(FIFO).selected = true;
  ack = await action(world, 'stop_all', { mode: 'stop' });
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.player.state, 'stop');
  assert.equal(server.output(FIFO).selected, true);
  ack = await action(world, 'stop_all', { mode: 'stop_outputs_off' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    server.outputs.filter((o) => o.selected),
    [],
  );
  ack = await action(world, 'stop_all', { mode: 'explode' });
  assert.equal(ack.success, false);
});

test('scene events: playback, outputs leaving and coming back; none at connection', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  assert.deepEqual(gladys.fake.sceneEvents, [], 'the first read is the reference');
  const events = () => gladys.fake.sceneEvents.map((e) => [e.key, e.data]);
  server.playQueue();
  await until(() => gladys.fake.sceneEvents.length === 1, 2000, 'started');
  assert.deepEqual(events()[0], [
    'playback_started',
    { title: 'Test tone 1', artist: 'Bench Ensemble', album: 'Sine Sessions' },
  ]);
  // OwnTone says "pause" while its outputs start (next, previous): no event.
  server.setState('pause');
  await sleep(20);
  server.setState('play');
  await sleep(150);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'a short pause is not a stop');
  server.setState('stop');
  await until(() => gladys.fake.sceneEvents.length === 2, 2000, 'stopped');
  assert.equal(events()[1][1].state, 'stopped');

  const airplay = server.output(AIRPLAY);
  server.removeOutput(AIRPLAY);
  await until(() => gladys.fake.sceneEvents.length === 3, 2000, 'disappeared');
  assert.deepEqual(events()[2], [
    'output_disappeared',
    { device: AIRPLAY_ID, output: 'Living room' },
  ]);
  // Gone from OwnTone: not selected any more in Gladys.
  assert.equal(state(gladys, AIRPLAY_ID, 'selected'), 0);
  server.addOutput({ ...airplay, selected: true });
  await until(() => gladys.fake.sceneEvents.length === 4, 2000, 'appeared');
  assert.equal(events()[3][0], 'output_appeared');
  await until(() => state(gladys, AIRPLAY_ID, 'selected') === 1, 2000, 'selected again');
});

test('OwnTone restarted: offline in Gladys, then everything read again', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  server.playQueue();
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 1, 2000, 'playing');
  await server.close();
  await until(() => gladys.fake.connectionStatus.connected === false, 2000, 'lost');
  await until(() => state(gladys, PLAYER_ID, 'now_playing') === 'Offline', 2000, 'offline');
  assert.equal(state(gladys, PLAYER_ID, 'playback_state'), 0);
  assert.equal(state(gladys, FIFO_ID, 'selected'), 0);
  const ack = await setValue(world, PLAYER_ID, 'pause', 1);
  assert.match(ack.error, /unreachable/);

  server.player.volume = 64;
  await server.restart();
  await until(() => gladys.fake.connectionStatus.connected === true, 3000, 'back');
  await until(() => state(gladys, PLAYER_ID, 'volume') === 64, 2000, 'read again');
  assert.equal(state(gladys, PLAYER_ID, 'playback_state'), 1);
  // No scene event for what changed while OwnTone was away.
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.key),
    ['playback_started'],
  );
  // The WebSocket is back too: a change is pushed (the full read is 400 ms away).
  server.setOutput(FIFO, { volume: 12 });
  await until(() => state(gladys, FIFO_ID, 'volume') === 12, 300, 'pushed');
});

test('without WebSocket (port 0): the container reads OwnTone itself, Gladys never polls', async (t) => {
  const server = await new FakeOwntone({ websocket: false }).listen();
  const world = await createWorld({ server });
  t.after(() => world.stop());
  await createAll(world);
  // No fake.poll() anywhere: the states come from the container's own reads.
  server.playQueue();
  await until(() => state(world.gladys, PLAYER_ID, 'playback_state') === 1, 2000, 'read');
  server.setOutput(FIFO, { volume: 9 });
  await until(() => state(world.gladys, FIFO_ID, 'volume') === 9, 2000, 'read again');
  assert.equal(world.hub.client.push, false);
});

test('admin password: sent as HTTP Basic "admin"; a wrong one shows on the integration page', async (t) => {
  const server = await new FakeOwntone({ password: 'bench-secret' }).listen();
  const world = await createWorld({ server, config: { password: 'wrong' } });
  t.after(() => world.stop());
  await until(() => world.gladys.fake.connectionStatus?.connected === false, 2000, 'refused');
  assert.match(world.gladys.fake.connectionStatus.message.en, /refused the password/);
  await world.gladys.fake.configUpdated({
    host: '127.0.0.1',
    port: server.port,
    password: 'bench-secret',
    language: 'en',
  });
  await until(() => world.gladys.fake.connectionStatus.connected === true, 2000, 'accepted');
  await until(() => world.gladys.fake.discoveredDevices?.length === 4, 2000, 'devices');
});

test('not configured, or an address that cannot be used', async (t) => {
  const world = await createWorld({ config: { host: '' } });
  t.after(() => world.stop());
  await until(() => world.gladys.fake.connectionStatus?.connected === false, 2000);
  assert.match(world.gladys.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
  const ack = await action(world, 'stop_all', { mode: 'stop' });
  assert.match(ack.error, /Type the address/);
  assert.equal(normalizeConfig({ host: 'https://owntone.lan' }).valid, false);
});

test('the language of the configuration names the features and the texts', async (t) => {
  const world = await ready({ config: { language: 'fr' } });
  t.after(() => world.stop());
  const { gladys } = world;
  assert.equal(featureOf(gladys, PLAYER_ID, 'now_playing').name, 'En cours');
  assert.equal(featureOf(gladys, FIFO_ID, 'selected').name, 'Sélectionnée');
  assert.equal(state(gladys, PLAYER_ID, 'now_playing'), 'Arrêté');
});
