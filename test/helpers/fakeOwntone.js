// -----------------------------------------------------------------------------
// A scripted OwnTone server on the loopback: the JSON API (HTTP) and the
// notification WebSocket, started from the answers recorded on OwnTone 29.3
// (test/fixtures/owntone/). It behaves like the real one where the
// integration depends on it: 204 for a command, 400 for an unknown output or
// one that cannot start, 500 for "play" on an empty queue, HTTP Basic with
// the user `admin`, a WebSocket that only names what changed.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { WebSocketServer } from 'ws';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/owntone/${name}.json`, import.meta.url), 'utf8'));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check()` is truthy (it may be async). */
export async function until(check, timeout = 2000, what = 'condition') {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) {
      return;
    }
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// The outputs recorded on the bench (ALSA and fifo), plus an AirPlay speaker
// written after OwnTone's output format (no AirPlay device on the bench).
export const ALSA = '0';
export const FIFO = '100';
export const AIRPLAY = '205858302651331';
export const EVENING = 'library:playlist:8';
export const MORNING = 'library:playlist:7';

const recordedItems = fixture('queue-add').items;

// The library recorded on the bench (albums Small, Big and Png, the playlists
// Morning and Radio, a stream), for the catalog of the Gladys 5.3 music panel.
export const LIBRARY = {
  albums: fixture('library-albums'),
  artists: fixture('library-artists'),
  albumTracks: fixture('album-tracks'),
  artistAlbums: fixture('artist-albums'),
  playlists: fixture('playlists-root'),
  radioTracks: fixture('playlist-radio-tracks'),
  filesRoot: fixture('files-root'),
  filesMusic: fixture('files-music'),
  filesSmall: fixture('files-small'),
  search: fixture('search-all'),
};
export const SMALL = LIBRARY.albums.items.find((a) => a.name === 'Small');
export const RADIO_TRACK = LIBRARY.radioTracks.items[0];
const TRACKS = [...LIBRARY.albumTracks.items, RADIO_TRACK];

// Artwork bytes: a tiny JPEG, and a PNG that is too large at 400 px (OwnTone
// keeps a PNG a PNG when it scales it).
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const PNG = (size) =>
  Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(size)]);
/** Track id whose artwork is a 400 KB PNG at 400 px, 100 KB below. */
export const HEAVY_ARTWORK_TRACK = 5;
/** Track id whose artwork is too large at every size. */
export const HUGE_ARTWORK_TRACK = 4;

/** A library track (or the stream) as a queue item. */
const queueItem = (track, id) => ({
  id,
  position: 0,
  track_id: track.id,
  title: track.title,
  artist: track.artist,
  album: track.album,
  length_ms: track.length_ms,
  data_kind: track.data_kind,
  uri: track.uri,
  artwork_url: `./artwork/item/${track.id}`,
});

export class FakeOwntone {
  constructor({ password = '', websocket = true } = {}) {
    this.password = password;
    this.websocket = websocket;
    this.config = fixture('config');
    this.player = { ...fixture('player-play'), state: 'stop', item_id: 0, volume: 50 };
    this.outputs = fixture('outputs').outputs.map((o) => ({ ...o, selected: false, volume: 50 }));
    this.outputs.push({
      ...this.outputs[1],
      id: AIRPLAY,
      name: 'Living room',
      type: 'AirPlay 2',
      volume: 30,
    });
    this.playlists = [
      { ...fixture('search-playlists').playlists.items[0] },
      { id: 7, name: 'Morning', uri: MORNING, item_count: 1, folder: false },
      { id: 9, name: 'Morning jazz', uri: 'library:playlist:9', item_count: 0, folder: false },
    ];
    this.queue = [];
    this.nextItemId = 100;
    this.requests = [];
    this.silent = false; // accepts, never answers
    this.errorStatus = 0; // when set, every read answers this HTTP status
    this.failing = new Set(); // output ids that refuse to start (400)
    this.server = null;
    this.wss = null;
    this.port = 0;
    this.wsPort = 0;
  }

  async listen() {
    this.server = http.createServer((req, res) => this.#handle(req, res));
    this.sockets = new Set();
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise((resolve) => this.server.listen(this.port, '127.0.0.1', resolve));
    this.port = this.server.address().port;
    if (this.websocket) {
      await this.startWebSocket();
    }
    this.config = { ...this.config, websocket_port: this.websocket ? this.wsPort : 0 };
    return this;
  }

  /** The notification WebSocket alone (OwnTone opens it after its API). */
  async startWebSocket() {
    {
      this.wss = new WebSocketServer({
        host: '127.0.0.1',
        port: this.wsPort,
        handleProtocols: (protocols) => (protocols.has('notify') ? 'notify' : false),
      });
      await new Promise((resolve) => this.wss.on('listening', resolve));
      this.wsPort = this.wss.address().port;
      this.wss.on('connection', (socket) => {
        socket.events = [];
        socket.on('message', (data) => {
          socket.events = JSON.parse(String(data)).notify ?? [];
        });
      });
    }
  }

  async stopWebSocket() {
    for (const client of this.wss?.clients ?? []) {
      client.terminate();
    }
    await new Promise((resolve) => (this.wss ? this.wss.close(resolve) : resolve()));
    this.wss = null;
  }

  async close() {
    await this.stopWebSocket();
    for (const socket of this.sockets ?? []) {
      socket.destroy();
    }
    await new Promise((resolve) => (this.server ? this.server.close(resolve) : resolve()));
    this.server = null;
  }

  /** Starts again on the same ports (a restart of OwnTone). */
  restart() {
    return this.listen();
  }

  /** Tells the subscribed WebSocket clients what changed. */
  notify(...events) {
    for (const client of this.wss?.clients ?? []) {
      const wanted = events.filter((event) => client.events.includes(event));
      if (wanted.length > 0) {
        client.send(JSON.stringify({ notify: wanted }));
      }
    }
  }

  output(id) {
    return this.outputs.find((o) => o.id === id);
  }

  // --- Changes made "on the server" (another client, a speaker) ---------------

  setState(state) {
    this.player.state = state;
    this.notify('player');
  }

  /** Shuffle or repeat changed (by the web interface, a remote…). */
  setOptions(changes) {
    Object.assign(this.player, changes);
    this.notify('options');
  }

  setOutput(id, changes) {
    Object.assign(this.output(id), changes);
    this.notify('outputs', 'volume');
  }

  removeOutput(id) {
    this.outputs = this.outputs.filter((o) => o.id !== id);
    this.notify('outputs');
  }

  addOutput(output) {
    this.outputs.push(output);
    this.notify('outputs');
  }

  /** Plays the recorded queue (the "Evening" playlist), item `position`. */
  playQueue(position = 0) {
    this.queue = structuredClone(recordedItems);
    this.player.item_id = this.queue[position].id;
    this.player.state = 'play';
    this.notify('queue', 'player');
  }

  // --- HTTP --------------------------------------------------------------------

  async #handle(req, res) {
    if (this.silent) {
      return; // never answers
    }
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    this.requests.push({ method: req.method, path: url.pathname, query: url.search, body });
    if (this.password) {
      const expected = `Basic ${Buffer.from(`admin:${this.password}`).toString('base64')}`;
      if (req.headers.authorization !== expected) {
        return this.#html(res, 401, 'Unauthorized');
      }
    }
    if (url.pathname.startsWith('/artwork/item/')) {
      return this.#artwork(res, Number(url.pathname.split('/').at(-1)), url.searchParams);
    }
    try {
      const answer = this.#route(req.method, url, body ? JSON.parse(body) : undefined);
      if (answer === undefined) {
        res.writeHead(204).end();
      } else if (typeof answer === 'number') {
        this.#html(res, answer, 'Error');
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));
      }
    } catch {
      this.#html(res, 400, 'Bad Request');
    }
  }

  #artwork(res, trackId, query) {
    if (!TRACKS.some((t) => t.id === trackId) || trackId === RADIO_TRACK.id) {
      return res.writeHead(204).end();
    }
    const size = Number(query.get('maxwidth'));
    if (trackId === HEAVY_ARTWORK_TRACK) {
      const image = PNG(size >= 400 ? 400_000 : 100_000);
      return res.writeHead(200, { 'Content-Type': 'image/png' }).end(image);
    }
    if (trackId === HUGE_ARTWORK_TRACK) {
      // Too large at every size, announced by Content-Length.
      const image = PNG(400_000);
      return res
        .writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length })
        .end(image);
    }
    return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(JPEG);
  }

  /** The queue in its playing order, positions renumbered. */
  #renumber() {
    this.queue.forEach((item, position) => {
      item.position = position;
    });
  }

  /** Library items of a URI (album, track, playlist of the bench), or null. */
  #tracksOf(uri) {
    if (uri === SMALL.uri) return LIBRARY.albumTracks.items;
    const track = TRACKS.find((t) => t.uri === uri);
    return track ? [track] : null;
  }

  #html(res, status, title) {
    res.writeHead(status, { 'Content-Type': 'text/html' });
    res.end(`<html><head><title>${status} ${title}</title></head></html>`);
  }

  #selectedVolume() {
    const selected = this.outputs.filter((o) => o.selected);
    return selected.length > 0 ? Math.max(...selected.map((o) => o.volume)) : this.player.volume;
  }

  #route(method, url, body) {
    const path = url.pathname.replace(/^\/api\//, '');
    const query = url.searchParams;
    if (method === 'GET') {
      if (this.errorStatus && path !== 'config') return this.errorStatus;
      if (path === 'config') return this.config;
      if (path === 'player') return this.player;
      if (path === 'outputs') return { outputs: this.outputs };
      if (path === 'queue') {
        const id = Number(query.get('id'));
        let items = query.has('id') ? this.queue.filter((i) => i.id === id) : this.queue;
        if (query.has('start')) {
          items = items.slice(Number(query.get('start')), Number(query.get('end')));
        }
        return { version: 1, count: this.queue.length, items };
      }
      const paged = (answer) => {
        const offset = Number(query.get('offset') ?? 0);
        const limit = query.has('limit') ? Number(query.get('limit')) : answer.items.length;
        return { ...answer, items: answer.items.slice(offset, offset + limit), offset, limit };
      };
      if (path === 'library/albums') return paged(LIBRARY.albums);
      if (path === 'library/artists') return paged(LIBRARY.artists);
      if (path === `library/albums/${SMALL.id}/tracks`) return paged(LIBRARY.albumTracks);
      if (path === `library/artists/${SMALL.artist_id}/albums`) return paged(LIBRARY.artistAlbums);
      if (path === 'library/playlists/0/playlists') return paged(LIBRARY.playlists);
      if (path === 'library/playlists/8') return LIBRARY.playlists.items[1];
      if (path === 'library/playlists/8/tracks') return paged(LIBRARY.radioTracks);
      if (path === 'library/files') {
        const directory = query.get('directory');
        if (directory === null) return LIBRARY.filesRoot;
        if (directory === '/srv/music') return LIBRARY.filesMusic;
        if (directory === '/srv/music/Small') return LIBRARY.filesSmall;
        return 404;
      }
      if (path === 'search' && query.get('type') !== 'playlist') {
        const answer = {};
        for (const type of query.get('type').split(',')) {
          answer[type] = LIBRARY.search[type];
        }
        return answer;
      }
      if (path === 'search' && query.get('type') === 'playlist') {
        const typed = query.get('query').toLowerCase();
        const items = this.playlists.filter((p) => p.name.toLowerCase().includes(typed));
        return { playlists: { items, total: items.length, offset: 0, limit: -1 } };
      }
      return 404;
    }
    if (method === 'PUT' && path.startsWith('player/')) {
      const command = path.slice('player/'.length);
      if (command === 'volume') {
        const volume = Math.max(0, Math.min(100, Number(query.get('volume'))));
        if (query.has('output_id')) {
          const output = this.output(query.get('output_id'));
          if (!output) return 400;
          output.volume = volume;
        } else {
          this.player.volume = volume;
          for (const output of this.outputs.filter((o) => o.selected)) {
            output.volume = volume;
          }
        }
        this.notify('volume', 'outputs');
        return undefined;
      }
      if (command === 'play') {
        if (this.queue.length === 0) return 500;
        if (query.has('position')) {
          const item = this.queue[Number(query.get('position'))];
          if (!item) return 400;
          this.player.item_id = item.id;
        }
        this.player.state = 'play';
        this.player.item_id ||= this.queue[0].id;
      } else if (command === 'seek') {
        if (this.player.state === 'stop') return 500;
        this.player.item_progress_ms = Number(query.get('position_ms'));
      } else if (command === 'shuffle' || command === 'repeat') {
        // As OwnTone 29.3: these only name `options`.
        this.setOptions({
          [command]: command === 'shuffle' ? query.get('state') === 'true' : query.get('state'),
        });
        return undefined;
      } else if (command === 'pause') {
        if (this.player.state === 'stop') return 500;
        this.player.state = 'pause';
      } else if (command === 'stop') {
        this.player.state = 'stop';
      } else if (command === 'next' || command === 'previous') {
        const index = this.queue.findIndex((i) => i.id === this.player.item_id);
        const next = this.queue[index + (command === 'next' ? 1 : -1)];
        if (next) this.player.item_id = next.id;
      } else {
        return 400;
      }
      this.notify('player');
      return undefined;
    }
    if (method === 'PUT' && path === 'outputs/set') {
      const ids = body.outputs.map(String);
      if (ids.some((id) => !this.output(id) || this.failing.has(id))) return 400;
      for (const output of this.outputs) {
        output.selected = ids.includes(output.id);
      }
      this.player.volume = this.#selectedVolume();
      this.notify('outputs', 'volume');
      return undefined;
    }
    if (method === 'PUT' && path.startsWith('outputs/')) {
      const output = this.output(decodeURIComponent(path.slice('outputs/'.length)));
      if (!output || !body || (body.selected === true && this.failing.has(output.id))) return 400;
      if (typeof body.selected === 'boolean') output.selected = body.selected;
      if (typeof body.volume === 'number') output.volume = body.volume;
      this.player.volume = this.#selectedVolume();
      this.notify('outputs', 'volume');
      return undefined;
    }
    if (method === 'POST' && path === 'queue/items/add' && this.#tracksOf(query.get('uris'))) {
      const items = this.#tracksOf(query.get('uris')).map((t) => queueItem(t, this.nextItemId++));
      if (query.get('clear') === 'true') {
        this.queue = [];
      }
      const at = query.has('position') ? Number(query.get('position')) : this.queue.length;
      this.queue.splice(at, 0, ...items);
      this.#renumber();
      if (query.get('playback') === 'start') {
        this.player.item_id = items[0].id;
        this.player.state = 'play';
        this.player.item_progress_ms = 0;
        this.player.item_length_ms = items[0].length_ms;
      }
      this.notify('queue', 'player');
      return { count: items.length };
    }
    if (method === 'POST' && path === 'queue/items/add') {
      const uri = query.get('uris');
      const playlist = this.playlists.find((p) => p.uri === uri);
      if (!playlist) {
        this.queue = [];
        this.player.state = 'stop';
        return 500;
      }
      this.queue = playlist.item_count === 0 ? [] : structuredClone(recordedItems);
      this.player.item_id = this.queue[0]?.id ?? 0;
      if (query.get('playback') === 'start' && this.queue.length > 0) {
        this.player.state = 'play';
      }
      this.notify('queue', 'player');
      return { count: this.queue.length };
    }
    return 404;
  }
}
