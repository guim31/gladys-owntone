// -----------------------------------------------------------------------------
// What the container writes at the default level (info): the lifecycle only.
// A normal session (notifications, states, scene events, full reads) writes
// nothing; an outage writes one line when it starts and one when it ends,
// not one per attempt. The SDK logger writes through console.log/console.error.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIFO } from './helpers/fakeOwntone.js';
import {
  PLAYER_ID,
  createAll,
  createWorld,
  outputId,
  sleep,
  state,
  until,
} from './helpers/world.js';

/** Capture the lines written at info and above from now on, at LOG_LEVEL=info. */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  const keep = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', keep);
  t.mock.method(console, 'error', keep);
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  return lines;
}

const strip = (lines) => lines.map((line) => line.replace(/^\[[^\]]+\] /, ''));

test('a normal session writes nothing at info', async (t) => {
  const world = await createWorld({ timings: { resyncMs: 30 } });
  t.after(() => world.stop());
  await createAll(world);
  const lines = captureLogs(t);
  const { server, gladys } = world;

  for (const volume of [10, 20, 30, 40]) {
    server.setOutput(FIFO, { volume });
    await sleep(10);
  }
  server.playQueue();
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 1, 2000);
  await until(() => state(gladys, outputId(FIFO), 'volume') === 40, 2000);
  await sleep(100); // several full reads

  assert.ok(gladys.fake.sceneEvents.length >= 1, 'a scene event was fired');
  assert.deepEqual(lines, []);
});

test('OwnTone away for a while: one line when it goes, one when it comes back', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  await createAll(world);
  const lines = captureLogs(t);

  await world.server.close();
  await until(() => world.gladys.fake.connectionStatus.connected === false, 2000, 'lost');
  await sleep(300); // many attempts, 20 to 100 ms apart
  await world.server.restart();
  await until(() => world.gladys.fake.connectionStatus.connected === true, 2000, 'back');
  await sleep(50);

  assert.deepEqual(strip(lines), [
    '[WARN] [owntone-hub] Connection to the OwnTone server lost (notifications closed), reconnecting',
    `[INFO] [owntone-hub] Connected to OwnTone 29.3 at 127.0.0.1:${world.server.port} (3 outputs)`,
  ]);
});

test('Gladys refusing the states: one line, then one when it accepts them again', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  await createAll(world);
  const { gladys, server } = world;
  const lines = captureLogs(t);

  const publish = gladys.publishChangedStates;
  let refused = 0;
  gladys.publishChangedStates = async () => {
    refused += 1;
    throw new Error('Gladys unavailable');
  };
  for (const volume of [11, 12, 13]) {
    server.setOutput(FIFO, { volume });
    await sleep(30);
  }
  assert.ok(refused >= 3, `${refused} publications refused`);
  gladys.publishChangedStates = publish;
  server.setOutput(FIFO, { volume: 14 });
  await until(() => state(gladys, outputId(FIFO), 'volume') === 14, 2000, 'published again');

  assert.deepEqual(strip(lines), [
    '[WARN] [owntone-hub] Cannot publish the states: Gladys unavailable',
    '[INFO] [owntone-hub] States published again',
  ]);
});

test('a server that accepts but never answers: one line, not one per attempt', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  await createAll(world);
  const lines = captureLogs(t);
  world.server.silent = true;
  await until(() => world.gladys.fake.connectionStatus.connected === false, 3000, 'lost');
  await sleep(1500); // several connections that never answer
  world.server.silent = false;
  await until(() => world.gladys.fake.connectionStatus.connected === true, 3000, 'back');
  await sleep(50);
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Connection to the OwnTone server lost/);
  assert.match(lines[1], /\[INFO\].*Connected to OwnTone/);
});

test('the password never reaches the logs', async (t) => {
  const lines = captureLogs(t);
  const world = await createWorld({ config: { password: 'bench-secret' } });
  t.after(() => world.stop());
  await createAll(world);
  await world.server.close();
  await sleep(200);
  assert.ok(lines.length > 0);
  assert.ok(
    lines.every((line) => !line.includes('bench-secret')),
    lines.join('\n'),
  );
});

test('reads answered with an error: one line, then one when they work again', async (t) => {
  const world = await createWorld({ timings: { resyncMs: 30 } });
  t.after(() => world.stop());
  await createAll(world);
  const lines = captureLogs(t);
  world.server.errorStatus = 502; // a proxy in front of OwnTone, every read refused
  await sleep(250); // several full reads
  world.server.errorStatus = 0;
  await sleep(100);
  assert.deepEqual(strip(lines), [
    '[WARN] [owntone-hub] Cannot read the OwnTone server: GET player: HTTP 502',
    '[INFO] [owntone-hub] OwnTone answers again',
  ]);
});
