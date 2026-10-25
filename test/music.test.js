// -----------------------------------------------------------------------------
// The Gladys 5.3 music player against the scripted OwnTone (answers recorded
// on OwnTone 29.3): the now-playing features, their commands, the catalog
// (browse, search, play, queue) and the artwork, through the SDK's fake
// Gladys. MediaItems are checked with the SDK's own validator.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMediaItems } from '@gladysassistant/integration-sdk';
import { ROOTS } from '../src/catalog.js';
import {
  FIFO,
  FakeOwntone,
  HEAVY_ARTWORK_TRACK,
  JPEG,
  RADIO_TRACK,
  SMALL,
} from './helpers/fakeOwntone.js';
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

async function ready(options) {
  const world = await createWorld(options);
  await createAll(world);
  await until(() => state(world.gladys, PLAYER_ID, 'volume') !== undefined, 2000, 'states');
  return world;
}

const player = { external_id: PLAYER_ID, params: [] };
const setValue = (world, key, value) =>
  world.gladys.fake.setValue(
    deviceOf(world.gladys, PLAYER_ID),
    featureOf(world.gladys, PLAYER_ID, key),
    value,
  );
const valid = (answer) => {
  assert.equal(answer.success, true, answer.error);
  assert.deepEqual(validateMediaItems(answer.data.items), []);
  return answer.data.items;
};
const artworkUrl = (world, trackId, size = 400) =>
  `http://127.0.0.1:${world.server.port}/artwork/item/${trackId}?maxwidth=${size}&maxheight=${size}`;
const last = (world, path) => world.server.requests.filter((r) => r.path === path).at(-1);

test('the player carries the music features of Gladys 5.3, writable ones confirmed', async (t) => {
  const world = await createWorld();
  t.after(() => world.stop());
  await until(() => world.gladys.fake.discoveredDevices?.length > 0, 2000, 'discovery');
  const feature = (key) => featureOf(world.gladys, PLAYER_ID, key);
  assert.deepEqual(
    [
      feature('playback_state').read_only,
      feature('playback_state').max,
      feature('playback_state').has_feedback,
    ],
    [false, 2, true],
  );
  for (const key of ['position', 'shuffle', 'repeat', 'volume']) {
    assert.equal(feature(key).read_only, false, key);
    assert.equal(feature(key).has_feedback, true, key);
  }
  assert.deepEqual([feature('position').unit, feature('duration').unit], ['seconds', 'seconds']);
  assert.equal(feature('repeat').max, 2);
  for (const key of ['title', 'artist', 'album', 'artwork', 'duration']) {
    assert.equal(feature(key).read_only, true, key);
  }
  // No mute in OwnTone's API: none published.
  assert.equal(feature('mute'), undefined);
  for (const f of deviceOf(world.gladys, PLAYER_ID).features) {
    if (f.category === 'music') {
      assert.equal(f.keep_history, false, f.external_id);
    }
  }
});

test('what plays is published once per change, the artwork as a key', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys } = world;
  assert.equal(state(gladys, PLAYER_ID, 'playback_state'), 2);
  assert.equal(state(gladys, PLAYER_ID, 'artwork'), '');

  assert.equal(
    (await gladys.fake.musicPlay(player, { id: SMALL.uri, type: 'album' })).success,
    true,
  );
  await until(() => state(gladys, PLAYER_ID, 'title') === 'Daylight', 2000, 'track');
  assert.equal(state(gladys, PLAYER_ID, 'playback_state'), 1);
  assert.equal(state(gladys, PLAYER_ID, 'artist'), 'Testband');
  assert.equal(state(gladys, PLAYER_ID, 'album'), 'Small');
  assert.equal(state(gladys, PLAYER_ID, 'duration'), 33);
  assert.equal(state(gladys, PLAYER_ID, 'position'), 0);
  assert.equal(state(gladys, PLAYER_ID, 'shuffle'), 0);
  assert.equal(state(gladys, PLAYER_ID, 'repeat'), 0);
  assert.equal(state(gladys, PLAYER_ID, 'artwork'), gladys.artworkKey(artworkUrl(world, 3)));
  assert.equal(state(gladys, PLAYER_ID, 'now_playing'), 'Daylight — Testband');

  // Nothing changed: nothing published again (the SDK diffs).
  const before = gladys.fake.states.length;
  world.server.notify('player');
  await sleep(60);
  assert.equal(gladys.fake.states.length, before);

  // Stopped, OwnTone keeps an item: IDLE, the track stays shown.
  assert.equal((await setValue(world, 'playback_state', 2)).success, true);
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 2, 2000, 'stopped');
  assert.equal(state(gladys, PLAYER_ID, 'title'), 'Daylight');
  assert.equal(state(gladys, PLAYER_ID, 'position'), 0);
});

test('playback state, position, shuffle and repeat are commands', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { gladys, server } = world;
  // A pause while stopped: OwnTone would answer 500, nothing is sent.
  const sent = server.requests.length;
  assert.equal((await setValue(world, 'playback_state', 0)).success, true);
  assert.equal(server.requests.filter((r) => r.path === '/api/player/pause').length, 0);
  assert.ok(server.requests.length >= sent);

  await gladys.fake.musicPlay(player, { id: SMALL.uri, type: 'album' });
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 1, 2000, 'playing');
  assert.equal((await setValue(world, 'playback_state', 0)).success, true);
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 0, 2000, 'paused');
  assert.equal((await setValue(world, 'playback_state', 1)).success, true);
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 1, 2000, 'resumed');

  assert.equal((await setValue(world, 'position', 20)).success, true);
  assert.equal(last(world, '/api/player/seek').query, '?position_ms=20000');
  await until(() => state(gladys, PLAYER_ID, 'position') === 20, 2000, 'seek confirmed');

  assert.equal((await setValue(world, 'shuffle', 1)).success, true);
  await until(() => state(gladys, PLAYER_ID, 'shuffle') === 1, 2000, 'shuffle');
  assert.equal((await setValue(world, 'repeat', 2)).success, true);
  assert.equal(last(world, '/api/player/repeat').query, '?state=single');
  await until(() => state(gladys, PLAYER_ID, 'repeat') === 2, 2000, 'repeat one');
  assert.equal((await setValue(world, 'repeat', 1)).success, true);
  assert.equal(last(world, '/api/player/repeat').query, '?state=all');

  assert.equal((await setValue(world, 'repeat', 5)).success, false);
  assert.equal((await setValue(world, 'playback_state', 3)).success, false);
  assert.equal((await setValue(world, 'position', -4)).success, false);
  assert.equal((await setValue(world, 'playback_state', 2)).success, true);
  // Seek while stopped: OwnTone refuses.
  await until(() => state(gladys, PLAYER_ID, 'playback_state') === 2, 2000, 'stopped');
  assert.match((await setValue(world, 'position', 5)).error, /refused/);
});

test('browse: our folders, then the library of OwnTone, by pages', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { fake } = world.gladys;
  const root = valid(await fake.musicBrowse(player));
  assert.deepEqual(
    root.map((i) => [i.id, i.title, i.type, i.playable]),
    [
      [ROOTS.playlists, 'Playlists', 'folder', false],
      [ROOTS.artists, 'Artists', 'folder', false],
      [ROOTS.albums, 'Albums', 'folder', false],
      [ROOTS.files, 'Files', 'folder', false],
    ],
  );

  const albums = await fake.musicBrowse(player, { parentId: ROOTS.albums, offset: 1, limit: 2 });
  assert.deepEqual(
    valid(albums).map((i) => [i.title, i.subtitle, i.type, i.browsable, i.playable]),
    [
      ['Png', 'Pngband', 'album', true, true],
      ['Small', 'Testband', 'album', true, true],
    ],
  );
  assert.equal(albums.data.total, 4);
  assert.equal(last(world, '/api/library/albums').query, '?offset=1&limit=2');
  // Thumbnails at 128 px, scaled by OwnTone.
  const small = albums.data.items[1];
  assert.equal(
    small.artwork_key,
    world.gladys.artworkKey(
      `http://127.0.0.1:${world.server.port}/artwork/group/3?maxwidth=128&maxheight=128`,
    ),
  );

  const tracks = valid(await fake.musicBrowse(player, { parentId: small.id }));
  assert.deepEqual(
    tracks.map((i) => [i.id, i.title, i.subtitle, i.duration, i.type, i.browsable, i.playable]),
    [
      ['library:track:3', 'Daylight', 'Testband', 33, 'track', false, true],
      ['library:track:4', 'Sunrise', 'Testband', 33, 'track', false, true],
      ['library:track:5', 'Dusk', 'Testband', 33, 'track', false, true],
    ],
  );
  assert.equal(tracks[0].artwork_key, world.gladys.artworkKey(artworkUrl(world, 3, 128)));

  const artists = valid(await fake.musicBrowse(player, { parentId: ROOTS.artists }));
  const testband = artists.find((i) => i.title === 'Testband');
  assert.equal(testband.type, 'artist');
  assert.deepEqual(
    valid(await fake.musicBrowse(player, { parentId: testband.id })).map((i) => i.title),
    ['Small'],
  );

  const playlists = valid(await fake.musicBrowse(player, { parentId: ROOTS.playlists }));
  assert.deepEqual(
    playlists.map((i) => [i.id, i.title, i.type]),
    [
      ['library:playlist:7', 'Morning', 'playlist'],
      ['library:playlist:8', 'Radio', 'playlist'],
    ],
  );
  const radio = valid(await fake.musicBrowse(player, { parentId: 'library:playlist:8' }));
  assert.deepEqual(
    radio.map((i) => [i.id, i.type, i.duration]),
    [[RADIO_TRACK.uri, 'radio', null]],
  );

  // Files: the directories (folders, never playable), then their files.
  const top = valid(await fake.musicBrowse(player, { parentId: ROOTS.files }));
  assert.deepEqual(
    top.map((i) => [i.title, i.type, i.playable]),
    [['srv', 'folder', false]],
  );
  const music = valid(
    await fake.musicBrowse(player, { parentId: 'gladys:directory:/srv/music', limit: 3 }),
  );
  assert.deepEqual(
    music.map((i) => i.title),
    ['Big', 'Playlists', 'Png'],
  );
  const folder = await fake.musicBrowse(player, { parentId: 'gladys:directory:/srv/music/Small' });
  assert.deepEqual(
    valid(folder).map((i) => i.type),
    ['track', 'track', 'track'],
  );

  assert.equal((await fake.musicBrowse(player, { parentId: 'library:track:3' })).success, false);
  const removed = await fake.musicBrowse({ external_id: 'ext:test-integration:player:nope' });
  assert.equal(removed.success, false);
});

test('search: playlists, artists and albums before the tracks, a type filters', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { fake } = world.gladys;
  const all = valid(await fake.musicSearch(player, { query: 's' }));
  assert.deepEqual(
    all.map((i) => [i.type, i.title]),
    [
      ['artist', 'Testband'],
      ['album', 'Small'],
      ['track', 'Dusk'],
      ['radio', 'stream'],
      ['track', 'Sunrise'],
    ],
  );
  assert.match(last(world, '/api/search').query, /type=tracks,artists,albums,playlists&query=s/);
  const albums = valid(await fake.musicSearch(player, { query: 's', type: 'album' }));
  assert.deepEqual(
    albums.map((i) => i.title),
    ['Small'],
  );
  assert.match(last(world, '/api/search').query, /type=albums&/);
  assert.deepEqual(valid(await fake.musicSearch(player, { query: 's', type: 'folder' })), []);
});

test('play: replace, next and append, a folder refused, an output selected', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { fake } = world.gladys;
  const { server } = world;
  assert.equal((await fake.musicPlay(player, { id: SMALL.uri, type: 'album' })).success, true);
  assert.match(last(world, '/api/queue/items/add').query, /clear=true&playback=start/);
  assert.deepEqual(
    server.queue.map((i) => i.title),
    ['Daylight', 'Sunrise', 'Dusk'],
  );
  // Next: after the item being played, in the order of the queue.
  assert.equal(
    (await fake.musicPlay(player, { id: RADIO_TRACK.uri, type: 'radio' }, 'next')).success,
    true,
  );
  assert.match(last(world, '/api/queue/items/add').query, /&position=1$/);
  assert.equal(
    (await fake.musicPlay(player, { id: 'library:track:3', type: 'track' }, 'append')).success,
    true,
  );
  assert.deepEqual(
    server.queue.map((i) => i.title),
    ['Daylight', 'stream', 'Sunrise', 'Dusk', 'Daylight'],
  );

  const folder = await fake.musicPlay(player, { id: ROOTS.albums, type: 'folder' });
  assert.match(folder.error, /folder cannot be played/);
  const unknown = await fake.musicPlay(
    player,
    { id: 'library:album:404', type: 'album' },
    'append',
  );
  assert.match(unknown.error, /nothing to play/);

  // On an output (the scene action lists every music device): that one only.
  const fifo = { external_id: outputId(FIFO), params: [] };
  assert.equal((await fake.musicPlay(fifo, { id: SMALL.uri, type: 'album' })).success, true);
  assert.equal(last(world, '/api/outputs/set').body, JSON.stringify({ outputs: [FIFO] }));
});

test('the queue: a page, the current index on the full queue, a jump', async (t) => {
  const world = await ready();
  t.after(() => world.stop());
  const { fake } = world.gladys;
  const empty = await fake.musicQueueGet(player);
  assert.deepEqual([empty.data.items, empty.data.current_index, empty.data.total], [[], null, 0]);
  await fake.musicPlay(player, { id: SMALL.uri, type: 'album' });
  await fake.musicPlay(player, { id: RADIO_TRACK.uri, type: 'radio' }, 'append');
  const page = await fake.musicQueueGet(player, { offset: 2, limit: 5 });
  assert.deepEqual(
    valid(page).map((i) => [i.title, i.type, i.duration]),
    [
      ['Dusk', 'track', 33],
      ['stream', 'radio', null],
    ],
  );
  assert.deepEqual([page.data.current_index, page.data.total], [0, 4]);
  assert.equal(page.data.items[0].artwork_key, world.gladys.artworkKey(artworkUrl(world, 5, 128)));

  assert.equal((await fake.musicQueuePlay(player, 2)).success, true);
  await until(() => state(world.gladys, PLAYER_ID, 'title') === 'Dusk', 2000, 'jump');
  assert.equal((await fake.musicQueueGet(player)).data.current_index, 2);
  assert.match((await fake.musicQueuePlay(player, 9)).error, /no longer in the queue/);
});

test('artwork: read with the password, asked smaller when too heavy, none for a stream', async (t) => {
  const server = await new FakeOwntone({ password: 'secret' }).listen();
  const world = await ready({ server, config: { password: 'secret' } });
  t.after(() => world.stop());
  const { fake } = world.gladys;
  const key = world.gladys.artworkKey(artworkUrl(world, 3));
  const answer = await fake.musicGetArtwork(key);
  assert.equal(answer.success, true, answer.error);
  assert.equal(answer.data.image, JPEG.toString('base64'));

  // A PNG of 400 KB at 400 px: asked again at 300 px (100 KB).
  const heavy = world.gladys.artworkKey(artworkUrl(world, HEAVY_ARTWORK_TRACK));
  const smaller = await fake.musicGetArtwork(heavy);
  assert.equal(smaller.success, true, smaller.error);
  assert.ok(Buffer.from(smaller.data.image, 'base64').length < 300 * 1024);
  assert.equal(
    server.requests.filter((r) => r.path === `/artwork/item/${HEAVY_ARTWORK_TRACK}`).at(-1).query,
    '?maxwidth=300&maxheight=300',
  );

  const none = await fake.musicGetArtwork(
    world.gladys.artworkKey(artworkUrl(world, RADIO_TRACK.id)),
  );
  assert.match(none.error, /no cover/);
  assert.equal((await fake.musicGetArtwork('art-000000000000')).success, false);
});
