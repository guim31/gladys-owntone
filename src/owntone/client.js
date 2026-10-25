// -----------------------------------------------------------------------------
// OwnTone's JSON API (HTTP, port 3689) and its notifications (WebSocket, port
// given by /api/config `websocket_port`, 3688 by default).
//
// Checked on OwnTone 29.3 (Docker image owntone/owntone):
// - a command answers 204 without body, a read 200 with JSON; a bad request
//   (unknown output, output that cannot start) is a 400 with an HTML page;
// - outside `trusted_networks` the API wants HTTP Basic with the user name
//   `admin` and the `admin_password` (any other user name is a 401);
// - the WebSocket needs the `notify` sub-protocol, asks for no password, and
//   only names what changed (`{ "notify": ["player", "volume"] }`): the state
//   is read again through the API.
//
// The link is permanent and comes back by itself (backoff 2 s to 60 s). When
// the API answers but the WebSocket cannot be opened (port 0, firewall), the
// client still opens, without push: the hub then polls.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const DEFAULT_CLIENT_TIMINGS = {
  callTimeout: 8_000,
  connectTimeout: 5_000,
  reconnectMin: 2_000,
  reconnectMax: 60_000,
};

// What the hub follows: the play state, the outputs and their volumes, the
// queue (what plays), and the options (shuffle, repeat: OwnTone 29.3 names
// only `options` when they change).
export const NOTIFY_EVENTS = ['player', 'outputs', 'volume', 'queue', 'options'];

/** An error with a stable code: unreachable | auth | forbidden | http | protocol. */
export class OwnToneError extends Error {
  constructor(code, message, { status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Emits `open` ({ push }), `close` (reason), `failed` (reason) and `notify`
 * (events). Reconnects by itself until stop().
 */
export class OwnToneClient extends EventEmitter {
  /**
   * @param {{ host: string, port: number, password?: string, fetch?: Function,
   *   WebSocket?: Function, timings?: object }} options
   */
  constructor({ host, port, password = '', fetch, WebSocket, timings = {} }) {
    super();
    this.host = host;
    this.port = port;
    this.password = password;
    this.fetchFn = fetch ?? globalThis.fetch;
    this.WebSocketClass = WebSocket ?? globalThis.WebSocket;
    this.timings = { ...DEFAULT_CLIENT_TIMINGS, ...timings };
    this.socket = null;
    this.live = false;
    this.push = false;
    this.running = false;
    this.failures = 0;
    this.retryTimer = null;
    this.serverConfig = null;
    // Bumped by every drop: a connection attempt that started before is void.
    this.generation = 0;
  }

  /** `host:port`, for the logs (never the password). */
  get address() {
    return this.host.includes(':') ? `[${this.host}]:${this.port}` : `${this.host}:${this.port}`;
  }

  get baseUrl() {
    return `http://${this.address}/api`;
  }

  /**
   * Where the server is, artwork included (`/artwork/...` is outside /api),
   * normalized like URL.origin (no `:80`).
   */
  get origin() {
    return new URL(`http://${this.address}/`).origin;
  }

  /**
   * The absolute URL of an artwork path given by OwnTone (`./artwork/item/3`,
   * `./artwork/group/5`, `?v=2` for a stream), asking for at most `size` px:
   * OwnTone scales the image itself. Null for an empty path.
   */
  artworkUrl(path, size) {
    if (typeof path !== 'string' || path.trim() === '') {
      return null;
    }
    const url = new URL(path.trim(), `${this.origin}/`);
    if (url.origin === this.origin) {
      url.searchParams.set('maxwidth', String(size));
      url.searchParams.set('maxheight', String(size));
    }
    return url.href;
  }

  /**
   * The bytes of an image, the password sent only to this server. Null when
   * OwnTone has none (204, 404); an OwnToneError `too_large` above maxBytes.
   * @param {string} url
   * @param {number} maxBytes
   * @returns {Promise<Buffer|null>}
   */
  async fetchImage(url, maxBytes) {
    const headers = {};
    if (this.password && new URL(url).origin === this.origin) {
      headers.Authorization = `Basic ${Buffer.from(`admin:${this.password}`).toString('base64')}`;
    }
    let response;
    try {
      response = await this.fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(this.timings.callTimeout),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new OwnToneError('unreachable', `no answer (${reason})`);
    }
    const cancel = () => response.body?.cancel().catch(() => {});
    if (response.status === 204 || response.status === 404) {
      await cancel();
      return null;
    }
    if (!response.ok) {
      await cancel();
      throw new OwnToneError('http', `artwork: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    const tooLarge = () => new OwnToneError('too_large', `artwork above ${maxBytes} bytes`);
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await cancel();
      throw tooLarge();
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > maxBytes) {
        throw tooLarge();
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.#connect();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.#drop('stopped', false);
  }

  /** The server answered: the next loss starts the backoff again from its minimum. */
  healthy() {
    this.failures = 0;
  }

  /** Drops the link and reconnects with the backoff (the server stopped answering). */
  reset(reason) {
    if (!this.running) {
      return;
    }
    this.#drop(reason, true);
    this.#schedule();
  }

  /**
   * One API call. Resolves the parsed JSON, or null for an empty answer.
   * @param {'GET'|'PUT'|'POST'} method
   * @param {string} path below /api, with its query string
   * @param {object} [body] sent as JSON
   */
  async request(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (this.password) {
      headers.Authorization = `Basic ${Buffer.from(`admin:${this.password}`).toString('base64')}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    let response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timings.callTimeout),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new OwnToneError('unreachable', `no answer (${reason})`);
    }
    const text = await response.text().catch(() => '');
    if (response.status === 401) {
      throw new OwnToneError('auth', 'password refused (HTTP 401)', { status: 401 });
    }
    if (response.status === 403) {
      throw new OwnToneError('forbidden', 'not a trusted network (HTTP 403)', { status: 403 });
    }
    if (!response.ok) {
      throw new OwnToneError('http', `${method} ${path.split('?')[0]}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    if (text.trim() === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new OwnToneError('protocol', `${method} ${path.split('?')[0]}: not JSON`);
    }
  }

  async #connect() {
    if (!this.running) {
      return;
    }
    const generation = this.generation;
    const current = () => this.running && generation === this.generation;
    let config;
    try {
      config = await this.request('GET', 'config');
      if (!config || typeof config !== 'object') {
        throw new OwnToneError('protocol', 'not an OwnTone server');
      }
    } catch (err) {
      if (!current()) {
        return;
      }
      this.emit('failed', err.message, err);
      this.#schedule();
      return;
    }
    if (!current()) {
      return;
    }
    this.serverConfig = config;
    const wsPort = Number(config.websocket_port);
    const socket =
      Number.isInteger(wsPort) && wsPort > 0 && this.WebSocketClass
        ? await this.#openSocket(wsPort)
        : null;
    if (!current()) {
      socket?.close();
      return;
    }
    this.socket = socket;
    this.push = socket !== null;
    this.live = true;
    this.emit('open', { push: this.push, config });
  }

  /** Opens the WebSocket of a client that opened without it; resolves true on success. */
  async upgrade() {
    const wsPort = Number(this.serverConfig?.websocket_port);
    if (
      this.push ||
      !this.live ||
      !(Number.isInteger(wsPort) && wsPort > 0) ||
      !this.WebSocketClass
    ) {
      return false;
    }
    const generation = this.generation;
    const socket = await this.#openSocket(wsPort);
    if (!socket) {
      return false;
    }
    if (generation !== this.generation || !this.live || this.push) {
      socket.close();
      return false;
    }
    this.socket = socket;
    this.push = true;
    return true;
  }

  /** Resolves the open WebSocket, or null when it cannot be opened. */
  #openSocket(wsPort) {
    return new Promise((resolve) => {
      const host = this.host.includes(':') ? `[${this.host}]` : this.host;
      let socket;
      try {
        socket = new this.WebSocketClass(`ws://${host}:${wsPort}`, 'notify');
      } catch {
        resolve(null);
        return;
      }
      let settled = false;
      const timer = setTimeout(() => settle(null), this.timings.connectTimeout);
      const settle = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (value === null) {
          socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
          try {
            socket.close();
          } catch {
            // already closed
          }
        }
        resolve(value);
      };
      socket.onopen = () => {
        socket.send(JSON.stringify({ notify: NOTIFY_EVENTS }));
        socket.onmessage = (event) => this.#onMessage(socket, event.data);
        socket.onclose = () => this.#onSocketClosed(socket);
        socket.onerror = () => {};
        settle(socket);
      };
      socket.onerror = () => settle(null);
      socket.onclose = () => settle(null);
    });
  }

  #onMessage(socket, data) {
    if (socket !== this.socket) {
      return;
    }
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    const events = Array.isArray(message?.notify)
      ? message.notify.filter((event) => typeof event === 'string')
      : [];
    if (events.length > 0) {
      this.emit('notify', events);
    }
  }

  #onSocketClosed(socket) {
    if (socket !== this.socket || !this.running) {
      return;
    }
    this.socket = null;
    this.reset('notifications closed');
  }

  #drop(reason, notify) {
    this.generation += 1;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    const wasLive = this.live;
    this.live = false;
    this.push = false;
    if (wasLive && notify) {
      this.emit('close', reason);
    }
  }

  #schedule() {
    clearTimeout(this.retryTimer);
    if (!this.running) {
      return;
    }
    this.failures += 1;
    const delay = Math.min(
      this.timings.reconnectMax,
      this.timings.reconnectMin * 2 ** Math.min(this.failures - 1, 10),
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.#connect();
    }, delay);
    this.retryTimer.unref?.();
  }
}
