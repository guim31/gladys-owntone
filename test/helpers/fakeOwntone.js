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
    this.requests = [];
    this.silent = false; // accepts, never answers
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
    this.config = { ...this.config, websocket_port: this.websocket ? this.wsPort : 0 };
    return this;
  }

  async close() {
    for (const client of this.wss?.clients ?? []) {
      client.terminate();
    }
    await new Promise((resolve) => (this.wss ? this.wss.close(resolve) : resolve()));
    this.wss = null;
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
      if (path === 'config') return this.config;
      if (path === 'player') return this.player;
      if (path === 'outputs') return { outputs: this.outputs };
      if (path === 'queue') {
        const id = Number(query.get('id'));
        const items = query.has('id') ? this.queue.filter((i) => i.id === id) : this.queue;
        return { version: 1, count: this.queue.length, items };
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
        this.player.state = 'play';
        this.player.item_id ||= this.queue[0].id;
      } else if (command === 'pause') {
        this.player.state = this.player.state === 'play' ? 'pause' : this.player.state;
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
