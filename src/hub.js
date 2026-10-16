// -----------------------------------------------------------------------------
// The hub: one OwnTone server, its player and outputs, and everything Gladys
// sees of them (devices, states, scene events, widget, commands).
//
// Reading: OwnTone's WebSocket only names what changed (player, outputs,
// volume, queue); each notification triggers a read of the API (player,
// outputs, the item being played), coalesced. A full read every minute
// catches anything missed and tells a dead server from a quiet one; without
// WebSocket (port 0, firewall), the read runs every 5 seconds instead. Only
// the changes reach Gladys (publishChangedStates), with a heartbeat.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  OUTPUT_TYPE,
  PLAYER_TYPE,
  buildOutputDevice,
  buildOutputStates,
  buildPlayerDevice,
  buildPlayerStates,
  featureKeyOf,
  outputIds,
  playerIds,
} from './devices.js';
import { OwnToneClient, OwnToneError } from './owntone/client.js';
import { parseItem, parseOutputs, parsePlayer } from './owntone/model.js';
import { STATUS_TEXT, commandMessage } from './texts.js';

const logger = createLogger({ name: 'owntone-hub' });

export const WIDGET_KEY = 'player';

export const TRIGGERS = {
  PLAYBACK_STARTED: 'playback_started',
  PLAYBACK_STOPPED: 'playback_stopped',
  OUTPUT_APPEARED: 'output_appeared',
  OUTPUT_DISAPPEARED: 'output_disappeared',
};

export const TIMINGS = {
  resyncMs: 60_000, // a full read with the WebSocket: missed notifications, dead server
  pollMs: 5_000, // a full read without the WebSocket
  debounceMs: 200, // a volume slider is a burst of notifications
  reloadMs: 150, // notifications come in bursts (outputs, player, volume)
  stopGraceMs: 5_000, // a "pause" shorter than this is OwnTone starting its outputs
};

// A stable value is re-published every 6 hours (the front greys out a value
// older than 48 h).
const HEARTBEAT_MS = 6 * 60 * 60_000;

// requestWidgetRefresh is dropped by the core beyond one call per 10 s.
const WIDGET_REFRESH_GAP_MS = 10_500;

export const PLAYER_COMMANDS = ['play', 'pause', 'next', 'previous', 'stop'];

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language = 'en') {
    const messages = commandMessage(code);
    super(messages[language] ?? messages.en);
    this.code = code;
    this.messages = messages;
  }
}

const emptyModel = () => ({
  server: { version: '' },
  player: { state: 'stop', volume: null, itemId: 0 },
  item: null,
  outputs: new Map(),
});

const fold = (value) => String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

export class Hub {
  /**
   * @param {{ gladys: object, fetch?: Function, WebSocket?: Function,
   *   timings?: object, clientTimings?: object, now?: () => number }} options
   */
  constructor({ gladys, fetch, WebSocket, timings, clientTimings, now }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.WebSocket = WebSocket;
    this.timings = { ...TIMINGS, ...timings };
    this.clientTimings = clientTimings;
    this.now = now ?? Date.now;
    this.config = null;
    this.client = null;
    this.model = emptyModel();
    this.known = new Map(); // every output seen since the start, as last seen
    this.online = false; // the model reflects a live server
    this.serverError = undefined; // undefined: never tried; null: fine; else the reason
    this.lastStatus = null;
    this.devicesFingerprint = null;
    this.widgetFingerprint = null;
    this.seen = null; // { state, outputs: Set<id> } of the previous read
    this.publishFailing = false;
    this.resyncTimer = null;
    this.changeTimer = null;
    this.reloadTimer = null;
    this.stopTimer = null;
    this.reloading = null;
    this.reloadAgain = false;
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.stopped = false;
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  // --- Lifecycle -----------------------------------------------------------

  async start(config) {
    // A configuration update may have set a client up before a failed start.
    this.#teardown();
    this.config = config;
    this.#setup();
  }

  /** The configuration changed: new server, password or language. */
  async reconfigure(config) {
    const sameServer =
      this.config &&
      this.config.host === config.host &&
      this.config.port === config.port &&
      this.config.password === config.password;
    this.config = config;
    if (sameServer && this.client) {
      // The language only: the feature names and the texts follow it.
      this.devicesFingerprint = null;
      this.#changed();
      return;
    }
    this.#teardown();
    // The player of the old server goes offline in Gladys, rather than keep
    // "playing" forever.
    await this.publishStates();
    this.model = emptyModel();
    this.seen = null;
    this.serverError = undefined;
    this.devicesFingerprint = null;
    this.#setup();
  }

  /** Gladys came back: it may have lost the discovered devices and states. */
  async resync() {
    this.gladys.forgetPublishedStates?.();
    this.devicesFingerprint = null;
    if (this.online) {
      await this.reload();
    }
    await this.publishDevices();
  }

  async stop() {
    this.stopped = true;
    this.#teardown();
    clearTimeout(this.widgetTimer);
  }

  #teardown() {
    clearTimeout(this.resyncTimer);
    clearTimeout(this.changeTimer);
    clearTimeout(this.reloadTimer);
    clearTimeout(this.stopTimer);
    this.resyncTimer = null;
    this.changeTimer = null;
    this.reloadTimer = null;
    this.stopTimer = null;
    // Listeners off first: a deliberate stop is not a lost server.
    this.client?.removeAllListeners();
    this.client?.stop();
    this.client = null;
    this.online = false;
  }

  #setup() {
    const config = this.config;
    if (!config.configured || !config.valid) {
      this.#setStatus(false, config.configured ? 'invalid_host' : 'not_configured');
      if (config.configured) {
        logger.warn('The server address is not valid');
      }
      return;
    }
    const client = new OwnToneClient({
      host: config.host,
      port: config.port,
      password: config.password,
      fetch: this.fetch,
      WebSocket: this.WebSocket,
      timings: this.clientTimings,
    });
    client.on('open', ({ push }) => this.#onOpen(client, push));
    client.on('close', (reason) => this.#onLost(client, reason));
    client.on('failed', (reason, err) => this.#onFailed(client, reason, err));
    client.on('notify', (events) => this.#onNotify(client, events));
    this.client = client;
    client.start();
  }

  // --- Server side ---------------------------------------------------------

  async #onOpen(client, push) {
    this.model.server = { version: String(client.serverConfig?.version ?? '') };
    const ok = await this.reload();
    if (client !== this.client) {
      return;
    }
    // Even after a failed first read: the next one is a period away.
    this.#scheduleResync();
    if (!ok) {
      return;
    }
    const version = this.model.server.version;
    logger.info(
      `Connected to OwnTone ${version} at ${client.address} (${this.model.outputs.size} outputs${
        push ? '' : ', no WebSocket: polling every 5 s'
      })`.replace(/\s+/g, ' '),
    );
  }

  #onLost(client, reason) {
    if (client !== this.client) {
      return;
    }
    clearTimeout(this.resyncTimer);
    const wasOnline = this.online;
    this.online = false;
    this.serverError = reason;
    // One line when a working server goes, not one per failed attempt.
    if (wasOnline) {
      logger.warn(`Connection to the OwnTone server lost (${reason}), reconnecting`);
    } else {
      logger.debug(`Connection to the OwnTone server closed again (${reason})`);
    }
    this.#setStatus(false, 'unreachable');
    // The reference of the next read: no scene event for what changed while
    // the server was away.
    this.seen = null;
    clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.#changed();
  }

  #onFailed(client, reason, err) {
    if (client !== this.client) {
      return;
    }
    const code = ['auth', 'forbidden'].includes(err?.code) ? err.code : 'unreachable';
    if (this.serverError === undefined || this.serverError === null) {
      logger.warn(`OwnTone server unavailable at ${client.address} (${reason})`);
    } else {
      logger.debug(`OwnTone server still unavailable (${reason})`);
    }
    this.serverError = reason;
    this.#setStatus(false, code);
  }

  #onNotify(client, events) {
    if (client !== this.client || !this.online) {
      return;
    }
    logger.debug(`Notification ${events.join(', ')}`);
    this.#reloadSoon();
  }

  /** Reads the player, the outputs and what plays; resolves false on failure. */
  reload() {
    if (this.reloading) {
      // A change during a read: read once more after it.
      this.reloadAgain = true;
      return this.reloading;
    }
    const client = this.client;
    this.reloading = (async () => {
      if (!client?.live) {
        return false;
      }
      try {
        const [player, outputs] = await Promise.all([
          client.request('GET', 'player'),
          client.request('GET', 'outputs'),
        ]);
        const parsedPlayer = parsePlayer(player);
        const item =
          parsedPlayer.itemId > 0
            ? parseItem(
                await client.request('GET', `queue?id=${parsedPlayer.itemId}`),
                parsedPlayer.itemId,
              )
            : null;
        if (client !== this.client) {
          return false;
        }
        client.healthy();
        this.model.player = parsedPlayer;
        this.model.item = item;
        this.model.outputs = parseOutputs(outputs);
        for (const output of this.model.outputs.values()) {
          this.known.set(output.id, output);
        }
        this.online = true;
        if (this.serverError !== null && this.serverError !== undefined) {
          logger.debug('OwnTone server back');
        }
        this.serverError = null;
        this.#setStatus(true);
        this.#changed({ now: true });
        return true;
      } catch (err) {
        if (client !== this.client) {
          return false;
        }
        if (err instanceof OwnToneError && err.code !== 'http' && err.code !== 'protocol') {
          // A server that does not answer, or no longer lets us in.
          client.reset(err.message);
        } else {
          logger.warn(`Cannot read the OwnTone server: ${err.message}`);
        }
        return false;
      }
    })().finally(() => {
      this.reloading = null;
      if (this.reloadAgain) {
        this.reloadAgain = false;
        this.#reloadSoon();
      }
    });
    return this.reloading;
  }

  #reloadSoon() {
    if (this.reloadTimer) {
      return;
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.reload();
    }, this.timings.reloadMs);
    this.reloadTimer.unref?.();
  }

  #scheduleResync() {
    clearTimeout(this.resyncTimer);
    if (this.stopped || !this.client) {
      return;
    }
    const client = this.client;
    const period = client.push ? this.timings.resyncMs : this.timings.pollMs;
    this.resyncTimer = setTimeout(async () => {
      await this.reload();
      if (client === this.client && client.live) {
        this.#scheduleResync();
      }
    }, period);
    this.resyncTimer.unref?.();
  }

  async #setStatus(connected, code = null) {
    const fingerprint = `${connected}:${code}`;
    if (this.lastStatus === fingerprint) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, code ? STATUS_TEXT[code] : undefined);
    } catch (err) {
      this.lastStatus = null;
      logger.debug(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Changes -> Gladys -----------------------------------------------------

  /** Something changed: devices, states, scene events, widget (debounced). */
  #changed({ now = false } = {}) {
    clearTimeout(this.changeTimer);
    this.changeTimer = null;
    if (now) {
      this.#flush();
      return;
    }
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.#flush();
    }, this.timings.debounceMs);
    this.changeTimer.unref?.();
  }

  #flush() {
    if (this.stopped) {
      return;
    }
    this.#fireTriggers();
    if (this.online) {
      const fingerprint = JSON.stringify(this.buildDevices());
      if (fingerprint !== this.devicesFingerprint) {
        this.devicesFingerprint = fingerprint;
        this.publishDevices();
      }
    }
    this.publishStates();
    const visible = this.#widgetFingerprint();
    if (visible !== this.widgetFingerprint) {
      this.widgetFingerprint = visible;
      this.refreshWidget();
    }
  }

  /** Scene events: playback starts or stops, an output appears or leaves. */
  #fireTriggers() {
    if (!this.online) {
      return;
    }
    const playingNow = this.model.player.state === 'play';
    const before = this.seen;
    // `playing` is the settled state: a stop counts once it lasted stopGraceMs.
    this.seen = {
      playing: playingNow || Boolean(before?.playing),
      outputs: new Set(this.model.outputs.keys()),
    };
    if (!before) {
      this.seen.playing = playingNow;
      return; // first read after a connection: the reference
    }
    if (playingNow) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
      if (!before.playing) {
        this.#fire(TRIGGERS.PLAYBACK_STARTED, this.#track());
      }
    } else if (before.playing && !this.stopTimer) {
      // OwnTone 29.3 says "pause" for about 2 s while its outputs start, at
      // every start and every next/previous: only a lasting stop is one.
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null;
        if (!this.online || !this.seen?.playing || this.model.player.state === 'play') {
          return;
        }
        this.seen.playing = false;
        this.#fire(TRIGGERS.PLAYBACK_STOPPED, {
          ...this.#track(),
          state: this.model.player.state === 'pause' ? 'paused' : 'stopped',
        });
      }, this.timings.stopGraceMs);
      this.stopTimer.unref?.();
    }
    for (const output of this.model.outputs.values()) {
      if (!before.outputs.has(output.id)) {
        logger.info(`Output ${output.name} appeared`);
        this.#fire(TRIGGERS.OUTPUT_APPEARED, {
          device: outputIds(this.gladys, output.id).device,
          output: this.outputName(output),
        });
      }
    }
    for (const id of before.outputs) {
      if (!this.seen.outputs.has(id)) {
        const output = this.known.get(id);
        logger.info(`Output ${output?.name ?? id} disappeared`);
        this.#fire(TRIGGERS.OUTPUT_DISAPPEARED, {
          device: outputIds(this.gladys, id).device,
          output: output ? this.outputName(output) : id,
        });
      }
    }
  }

  #track() {
    const item = this.model.item;
    return { title: item?.title ?? '', artist: item?.artist ?? '', album: item?.album ?? '' };
  }

  #fire(key, data) {
    logger.debug(`Scene event ${key}`);
    Promise.resolve(this.gladys.publishSceneEvent(key, data)).catch((err) => {
      logger.warn(`Cannot fire ${key}: ${err.message}`);
    });
  }

  #created(externalId) {
    return (this.gladys.devices ?? []).find((device) => device.external_id === externalId);
  }

  /** The name of the output in Gladys (the user may have renamed it). */
  outputName(output) {
    return this.#created(outputIds(this.gladys, output.id).device)?.name ?? output.name;
  }

  buildDevices() {
    return [
      buildPlayerDevice(this.gladys, this.model.server, this.language),
      ...[...this.model.outputs.values()].map((output) =>
        buildOutputDevice(this.gladys, output, this.language),
      ),
    ];
  }

  async publishDevices() {
    if (!this.client || !this.online) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      this.devicesFingerprint = null;
      logger.error('Cannot publish the devices', err);
    }
  }

  /** States of the devices added in Gladys, only what changed. */
  async publishStates() {
    const created = new Set((this.gladys.devices ?? []).map((device) => device.external_id));
    const states = [];
    // Before the first read, nothing is known: nothing to say.
    if (created.has(playerIds(this.gladys).device) && this.serverError !== undefined) {
      states.push(...buildPlayerStates(this.gladys, this.model, this.online, this.language));
    }
    for (const output of this.known.values()) {
      if (created.has(outputIds(this.gladys, output.id).device)) {
        const present = this.online && this.model.outputs.has(output.id);
        states.push(
          ...buildOutputStates(this.gladys, this.model.outputs.get(output.id) ?? output, present),
        );
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
      if (this.publishFailing) {
        this.publishFailing = false;
        logger.info('States published again');
      }
    } catch (err) {
      const log = this.publishFailing ? logger.debug : logger.warn;
      this.publishFailing = true;
      log(`Cannot publish the states: ${err.message}`);
    }
  }

  /** A device was added in Gladys: its states, now that its features exist. */
  async onDeviceCreated() {
    await this.publishStates();
    this.refreshWidget(true);
  }

  #widgetFingerprint() {
    const { player, item, outputs } = this.model;
    return JSON.stringify([
      this.online,
      player.state,
      player.volume,
      item,
      [...outputs.values()].map((o) => [o.id, o.name, o.selected, o.volume]),
    ]);
  }

  refreshWidget(force = false) {
    const wait = this.widgetRefreshAt + WIDGET_REFRESH_GAP_MS - this.now();
    if (wait <= 0 || force) {
      clearTimeout(this.widgetTimer);
      this.widgetTimer = null;
      this.widgetRefreshAt = this.now();
      Promise.resolve(this.gladys.requestWidgetRefresh(WIDGET_KEY)).catch(() => {});
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  // --- Commands --------------------------------------------------------------

  /** `{ kind: 'player' }`, `{ kind: 'output', output }` or null. */
  find(externalId) {
    if (typeof externalId !== 'string' || externalId === '') {
      return null;
    }
    if (externalId === playerIds(this.gladys).device) {
      return { kind: PLAYER_TYPE };
    }
    for (const output of this.model.outputs.values()) {
      if (outputIds(this.gladys, output.id).device === externalId) {
        return { kind: OUTPUT_TYPE, output };
      }
    }
    return null;
  }

  #ready() {
    if (!this.client) {
      throw new CommandError('not_configured', this.language);
    }
    if (!this.online) {
      throw new CommandError('unreachable', this.language);
    }
  }

  /** The output of a device external id (present now), or a CommandError. */
  outputOf(externalId) {
    this.#ready();
    const found = this.find(externalId);
    if (found?.kind !== OUTPUT_TYPE) {
      throw new CommandError('unknown_device', this.language);
    }
    return found.output;
  }

  /** One call, errors turned into coded messages, the state read again soon. */
  async call(method, path, body, { refusedCode = 'refused' } = {}) {
    this.#ready();
    let result;
    try {
      result = await this.client.request(method, path, body);
    } catch (err) {
      if (err instanceof OwnToneError) {
        logger.warn(`${method} ${path.split('?')[0]} failed: ${err.message}`);
        const code =
          err.code === 'http' || err.code === 'protocol'
            ? refusedCode
            : err.code === 'unreachable'
              ? 'unreachable'
              : 'auth';
        throw new CommandError(code, this.language);
      }
      throw err;
    }
    // The WebSocket tells too, but not without it (polling): read now.
    this.#reloadSoon();
    return result;
  }

  #volumeOf(volume) {
    const value = typeof volume === 'string' ? Number(volume.replace(',', '.')) : Number(volume);
    if (volume === null || volume === '' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new CommandError('bad_volume', this.language);
    }
    return Math.round(value);
  }

  /** The master volume (OwnTone scales the selected outputs with it). */
  async setPlayerVolume(volume) {
    const percent = this.#volumeOf(volume);
    this.#ready();
    await this.call('PUT', `player/volume?volume=${percent}`);
    logger.info(`Volume ${percent}`);
  }

  async setOutputVolume(output, volume) {
    const percent = this.#volumeOf(volume);
    await this.call('PUT', `outputs/${encodeURIComponent(output.id)}`, { volume: percent });
    logger.info(`${output.name}: volume ${percent}`);
  }

  async selectOutput(output, selected) {
    await this.call(
      'PUT',
      `outputs/${encodeURIComponent(output.id)}`,
      { selected: Boolean(selected) },
      { refusedCode: 'output_refused' },
    );
    logger.info(`${output.name}: ${selected ? 'selected' : 'deselected'}`);
  }

  async command(command) {
    if (!PLAYER_COMMANDS.includes(command)) {
      throw new CommandError('bad_command', this.language);
    }
    try {
      await this.call('PUT', `player/${command}`);
    } catch (err) {
      // OwnTone answers 500 to "play" with nothing in the queue.
      if (err.code === 'refused' && command === 'play' && this.model.player.itemId === 0) {
        throw new CommandError('empty_queue', this.language);
      }
      throw err;
    }
    logger.info(`Player: ${command}`);
  }

  async playPause() {
    this.#ready();
    await this.command(this.model.player.state === 'play' ? 'pause' : 'play');
  }

  /** `{ uri, name }` of a playlist name (or a URI typed as is). */
  async findPlaylist(name) {
    const typed = typeof name === 'string' ? name.trim() : '';
    if (typed === '') {
      throw new CommandError('no_playlist', this.language);
    }
    // library:playlist:8, spotify:playlist:..., an internet radio URL.
    if (/^(library|spotify):[a-z]+:\S+$/i.test(typed) || /^https?:\/\/\S+$/i.test(typed)) {
      return { uri: typed, name: typed };
    }
    const found = await this.call('GET', `search?type=playlist&query=${encodeURIComponent(typed)}`);
    const playlists = (Array.isArray(found?.playlists?.items) ? found.playlists.items : []).filter(
      (item) => item && item.folder !== true && typeof item.uri === 'string',
    );
    const exact = playlists.filter((item) => fold(item.name ?? '') === fold(typed));
    const candidates = exact.length > 0 ? exact : playlists;
    if (candidates.length === 0) {
      throw new CommandError('playlist_not_found', this.language);
    }
    if (candidates.length > 1) {
      throw new CommandError('playlist_ambiguous', this.language);
    }
    return { uri: candidates[0].uri, name: String(candidates[0].name ?? typed) };
  }

  /**
   * Plays a playlist from its start, on the given outputs only when there are
   * some (the others are deselected), else on the outputs already selected.
   */
  async playPlaylist(name, outputs = []) {
    this.#ready();
    const playlist = await this.findPlaylist(name);
    if (outputs.length > 0) {
      await this.call(
        'PUT',
        'outputs/set',
        { outputs: [...new Set(outputs.map((output) => output.id))] },
        { refusedCode: 'output_refused' },
      );
    }
    const added = await this.call(
      'POST',
      `queue/items/add?uris=${encodeURIComponent(playlist.uri)}&clear=true&playback=start`,
    );
    if (Number(added?.count) === 0) {
      throw new CommandError('playlist_empty', this.language);
    }
    logger.info(
      `Playing playlist ${playlist.name}${
        outputs.length > 0 ? ` on ${outputs.map((output) => output.name).join(', ')}` : ''
      }`,
    );
    return playlist;
  }

  /** Stops playback; with `outputsOff`, every output is deselected too. */
  async stopAll(outputsOff) {
    this.#ready();
    await this.call('PUT', 'player/stop');
    if (outputsOff) {
      await this.call('PUT', 'outputs/set', { outputs: [] });
    }
    logger.info(outputsOff ? 'Stopped, every output off' : 'Stopped');
  }

  /** onSetValue: a control of a device box, or of the core Music box. */
  async setValue(device, feature, value) {
    this.#ready();
    const found = this.find(device?.external_id);
    if (!found) {
      throw new CommandError('unknown_device', this.language);
    }
    const key = featureKeyOf(feature?.external_id);
    if (found.kind === OUTPUT_TYPE) {
      switch (key) {
        case 'selected':
          return this.selectOutput(found.output, Number(value) === 1);
        case 'volume':
          return this.setOutputVolume(found.output, value);
        default:
          throw new Error(`Unknown feature ${key}`);
      }
    }
    switch (key) {
      case 'volume':
        return this.setPlayerVolume(value);
      case 'play':
      case 'pause':
      case 'previous':
      case 'next':
        return this.command(key);
      default:
        throw new Error(`Unknown feature ${key}`);
    }
  }
}
