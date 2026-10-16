// -----------------------------------------------------------------------------
// A world for the tests: the SDK's fake Gladys, the real wiring (src/app.js)
// and a scripted OwnTone on the loopback, with short timings.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { platformIdOf } from '../../src/devices.js';
import { FakeOwntone, sleep, until } from './fakeOwntone.js';

export const FAST = { resyncMs: 400, pollMs: 50, debounceMs: 5, reloadMs: 5, stopGraceMs: 60 };
export const FAST_CLIENT = {
  callTimeout: 200,
  connectTimeout: 200,
  reconnectMin: 20,
  reconnectMax: 100,
};

export const PLAYER_ID = 'ext:test-integration:player:owntone';
export const outputId = (id) => `ext:test-integration:output:${platformIdOf(id)}`;

export async function createWorld({ server, config = {}, timings = {}, connect = true } = {}) {
  const owntone = server ?? (await new FakeOwntone().listen());
  const gladys = createFakeGladys({
    config: { host: '127.0.0.1', port: owntone.port, language: 'en', ...config },
  });
  const app = registerHandlers(gladys, {
    timings: { ...FAST, ...timings },
    clientTimings: FAST_CLIENT,
  });
  if (connect) {
    await gladys.connect();
  }
  return {
    gladys,
    app,
    hub: app.hub,
    server: owntone,
    async stop() {
      await app.stop();
      await owntone.close();
    },
  };
}

/** Waits for the first read, then "Add to Gladys" every discovered device. */
export async function createAll(world) {
  await until(() => world.gladys.fake.discoveredDevices?.length > 0, 2000, 'discovery');
  for (const device of world.gladys.fake.discoveredDevices) {
    await world.gladys.fake.deviceCreated(device);
  }
  await sleep(20);
}

export const deviceOf = (gladys, externalId) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);

export const featureOf = (gladys, externalId, key) =>
  deviceOf(gladys, externalId).features.find((f) => f.external_id === `${externalId}:${key}`);

export const state = (gladys, externalId, key) => gladys.fake.lastState(`${externalId}:${key}`);

export { sleep, until };
