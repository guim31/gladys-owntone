// -----------------------------------------------------------------------------
// The catalog of the Gladys 5.3 music panel (manifest `music`): browse,
// search, play, the queue, and the bytes of the artworks. Read on demand from
// OwnTone's JSON API, never stored. Everything comes back as MediaItems whose
// `id` is OwnTone's URI (`library:album:…`, `library:playlist:7`,
// `spotify:…`), opaque to Gladys and carried back by a play command and by
// the `music.play-media` scene action; our own folders use `gladys:`.
//
// What OwnTone gives (checked on 29.3, test/fixtures/owntone/):
//   - the library pages itself (`offset`, `limit`, `total`), except the
//     directories of `library/files`, cut here;
//   - `queue/items/add` takes any URI and an insert `position`, in the order
//     of the queue as it plays (the shuffle order when shuffle is on);
//   - artwork is served under `/artwork/…` (outside /api, password too),
//     scaled by OwnTone itself (`maxwidth`, `maxheight`), 204 when none.
//
// Every operation runs on the server: the player device, or an output (the
// scene action of Gladys lists every music device). Playing on an output
// (mode replace) first makes it the only selected output.
// -----------------------------------------------------------------------------

import { MUSIC_MEDIA_TYPES, MUSIC_PLAY_MODES } from '@gladysassistant/integration-sdk';
import { OUTPUT_TYPE } from './devices.js';
import { ARTWORK_SIZES, CommandError } from './hub.js';
import { parseQueueItem } from './owntone/model.js';
import { OwnToneError } from './owntone/client.js';
import { CATALOG_TEXT, pick } from './texts.js';

// Our root folders and the directories of the library: no OwnTone URI uses
// the `gladys:` scheme.
export const ROOTS = {
  playlists: 'gladys:playlists',
  artists: 'gladys:artists',
  albums: 'gladys:albums',
  files: 'gladys:files',
};
const DIRECTORY = 'gladys:directory:';

// Bounds of the core (capabilities/music.md, section 4.2), and the bytes of an
// artwork it accepts.
const MAX_ID = 512;
const MAX_TEXT = 200;
export const MAX_ARTWORK_BYTES = 300 * 1024;

const clip = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_TEXT) : null;
const usableId = (id) => typeof id === 'string' && id !== '' && id.length <= MAX_ID;
const durationOf = (ms) => (Number(ms) > 0 ? Math.round(Number(ms) / 1000) : null);
const list = (answer) => (Array.isArray(answer?.items) ? answer.items : []);
const baseName = (path) => String(path).replace(/\/+$/, '').split('/').pop() || String(path);

/** Server-side state the catalog needs: the client, ready, and its device. */
function serverOf(hub, device) {
  const found = hub.find(device?.external_id);
  if (!found) {
    throw new CommandError('unknown_device', hub.language);
  }
  return found;
}

/** A read of the API that changes nothing (no state read after it). */
const read = (hub, path) => hub.call('GET', path, undefined, { reload: false });

/** The artwork key of an OwnTone artwork path, at the thumbnail size. */
function artworkKey(hub, path) {
  const url = hub.client?.artworkUrl(path, ARTWORK_SIZES.THUMBNAIL);
  return url ? hub.gladys.artworkKey(url) : null;
}

const withArtwork = (hub, item, path) => {
  const key = artworkKey(hub, path);
  return key ? { ...item, artwork_key: key } : item;
};

/** A track of the library or of a search (a stream is a radio). */
export function trackItem(hub, raw) {
  if (!usableId(raw?.uri)) {
    return null;
  }
  const stream = raw.data_kind === 'url';
  const item = {
    id: raw.uri,
    type: stream ? MUSIC_MEDIA_TYPES.RADIO : MUSIC_MEDIA_TYPES.TRACK,
    title: clip(raw.title) ?? clip(baseName(raw.path ?? raw.uri)),
    duration: stream ? null : durationOf(raw.length_ms),
    browsable: false,
    playable: true,
  };
  const artist = clip(raw.artist);
  if (artist) {
    item.subtitle = artist;
  }
  return withArtwork(hub, item, raw.artwork_url);
}

export function albumItem(hub, raw) {
  if (!usableId(raw?.uri)) {
    return null;
  }
  const item = {
    id: raw.uri,
    type: MUSIC_MEDIA_TYPES.ALBUM,
    title: clip(raw.name) ?? raw.uri.slice(0, MAX_TEXT),
    browsable: true,
    playable: true,
  };
  const artist = clip(raw.artist);
  if (artist) {
    item.subtitle = artist;
  }
  return withArtwork(hub, item, raw.artwork_url);
}

export function artistItem(hub, raw) {
  if (!usableId(raw?.uri)) {
    return null;
  }
  return withArtwork(
    hub,
    {
      id: raw.uri,
      type: MUSIC_MEDIA_TYPES.ARTIST,
      title: clip(raw.name) ?? raw.uri.slice(0, MAX_TEXT),
      browsable: true,
      playable: true,
    },
    raw.artwork_url,
  );
}

/** A playlist, or a folder of playlists (browsable only). */
export function playlistItem(raw) {
  if (!usableId(raw?.uri)) {
    return null;
  }
  const folder = raw.folder === true;
  return {
    id: raw.uri,
    type: folder ? MUSIC_MEDIA_TYPES.FOLDER : MUSIC_MEDIA_TYPES.PLAYLIST,
    title: clip(raw.name) ?? raw.uri.slice(0, MAX_TEXT),
    browsable: true,
    playable: !folder,
  };
}

function directoryItem(path) {
  const id = `${DIRECTORY}${path}`;
  if (typeof path !== 'string' || path === '' || !usableId(id)) {
    return null;
  }
  return {
    id,
    type: MUSIC_MEDIA_TYPES.FOLDER,
    title: clip(baseName(path)) ?? path.slice(0, MAX_TEXT),
    browsable: true,
    playable: false,
  };
}

const page = (offset, limit) => `offset=${offset}&limit=${limit}`;

/** An OwnTone page: its items (null ones dropped) and its total. */
const paged = (answer, map) => ({
  items: list(answer).map(map).filter(Boolean),
  total: Number.isInteger(answer?.total) ? answer.total : list(answer).length,
});

/** The id after a prefix (`library:album:` -> the album id), URL-encoded. */
const idOf = (uri, prefix) => encodeURIComponent(uri.slice(prefix.length));

/**
 * onMusicBrowse: our folders, then OwnTone's library.
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function browse(hub, device, { parentId = null, offset = 0, limit = 50 } = {}) {
  serverOf(hub, device);
  if (parentId === null) {
    const roots = Object.entries(ROOTS).map(([key, id]) => ({
      id,
      type: MUSIC_MEDIA_TYPES.FOLDER,
      title: pick(CATALOG_TEXT[key], hub.language),
      browsable: true,
      playable: false,
    }));
    return { items: roots.slice(offset, offset + limit), total: roots.length };
  }
  const id = String(parentId);
  if (id === ROOTS.playlists) {
    return paged(
      await read(hub, `library/playlists/0/playlists?${page(offset, limit)}`),
      playlistItem,
    );
  }
  if (id === ROOTS.artists) {
    return paged(await read(hub, `library/artists?${page(offset, limit)}`), (a) =>
      artistItem(hub, a),
    );
  }
  if (id === ROOTS.albums) {
    return paged(await read(hub, `library/albums?${page(offset, limit)}`), (a) =>
      albumItem(hub, a),
    );
  }
  if (id === ROOTS.files || id.startsWith(DIRECTORY)) {
    // One level of a directory: its directories, playlists and tracks, at once.
    const directory = id === ROOTS.files ? '' : id.slice(DIRECTORY.length);
    const answer = await read(
      hub,
      `library/files${directory ? `?directory=${encodeURIComponent(directory)}` : ''}`,
    );
    const all = [
      ...(Array.isArray(answer?.directories) ? answer.directories : []).map((d) =>
        directoryItem(d?.path),
      ),
      ...list(answer?.playlists).map(playlistItem),
      ...list(answer?.tracks).map((t) => trackItem(hub, t)),
    ].filter(Boolean);
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
  if (id.startsWith('library:artist:')) {
    return paged(
      await read(
        hub,
        `library/artists/${idOf(id, 'library:artist:')}/albums?${page(offset, limit)}`,
      ),
      (a) => albumItem(hub, a),
    );
  }
  if (id.startsWith('library:album:')) {
    return paged(
      await read(hub, `library/albums/${idOf(id, 'library:album:')}/tracks?${page(offset, limit)}`),
      (t) => trackItem(hub, t),
    );
  }
  if (id.startsWith('library:playlist:')) {
    const playlistId = idOf(id, 'library:playlist:');
    const playlist = await read(hub, `library/playlists/${playlistId}`);
    return playlist?.folder === true
      ? paged(
          await read(hub, `library/playlists/${playlistId}/playlists?${page(offset, limit)}`),
          playlistItem,
        )
      : paged(
          await read(hub, `library/playlists/${playlistId}/tracks?${page(offset, limit)}`),
          (t) => trackItem(hub, t),
        );
  }
  throw new Error(`Cannot open ${id.slice(0, 80)}`);
}

/**
 * Search results of every type in one list of `limit`: the playlists, the
 * artists and the albums first (a quarter of the list each at most), the
 * tracks after, then what is left of the others.
 */
export function mixResults(groups, limit) {
  const share = Math.max(1, Math.floor(limit / 4));
  const heads = ['playlist', 'artist', 'album'];
  const first = heads.flatMap((type) => (groups[type] ?? []).slice(0, share));
  const rest = heads.flatMap((type) => (groups[type] ?? []).slice(share));
  return [...first, ...(groups.track ?? []), ...rest].slice(0, limit);
}

// MediaItem type -> what OwnTone searches (a radio is a track of a stream).
const SEARCH_TYPES = {
  [MUSIC_MEDIA_TYPES.TRACK]: 'tracks',
  [MUSIC_MEDIA_TYPES.RADIO]: 'tracks',
  [MUSIC_MEDIA_TYPES.ALBUM]: 'albums',
  [MUSIC_MEDIA_TYPES.ARTIST]: 'artists',
  [MUSIC_MEDIA_TYPES.PLAYLIST]: 'playlists',
};

/**
 * onMusicSearch: OwnTone's search of tracks, artists, albums and playlists.
 * @returns {Promise<{ items: object[] }>}
 */
export async function search(hub, device, { query, type = null, limit = 20 } = {}) {
  serverOf(hub, device);
  const text = String(query ?? '').trim();
  if (!text || (type !== null && !SEARCH_TYPES[type])) {
    return { items: [] };
  }
  const types = type === null ? 'tracks,artists,albums,playlists' : SEARCH_TYPES[type];
  const answer = await read(
    hub,
    `search?type=${types}&query=${encodeURIComponent(text)}&limit=${limit}`,
  );
  const groups = {
    playlist: list(answer?.playlists).map(playlistItem).filter(Boolean),
    artist: list(answer?.artists)
      .map((a) => artistItem(hub, a))
      .filter(Boolean),
    album: list(answer?.albums)
      .map((a) => albumItem(hub, a))
      .filter(Boolean),
    track: list(answer?.tracks)
      .map((t) => trackItem(hub, t))
      .filter(Boolean),
  };
  const items =
    type === null
      ? mixResults(groups, limit)
      : Object.values(groups)
          .flat()
          .filter((item) => item.type === type)
          .slice(0, limit);
  return { items };
}

/** onMusicPlay (and the `music.play-media` scene action). */
export async function play(hub, device, media, mode = MUSIC_PLAY_MODES.REPLACE) {
  const found = serverOf(hub, device);
  const id = media?.id;
  if (
    media?.type === MUSIC_MEDIA_TYPES.FOLDER ||
    (typeof id === 'string' && id.startsWith('gladys:'))
  ) {
    throw new CommandError('folder_not_playable', hub.language);
  }
  if (!usableId(id)) {
    throw new Error('A media id is required');
  }
  let query = `uris=${encodeURIComponent(id)}`;
  if (mode === MUSIC_PLAY_MODES.REPLACE) {
    // Played on an output (a speaker of the scene action): that one only.
    if (found.kind === OUTPUT_TYPE) {
      await hub.call(
        'PUT',
        'outputs/set',
        { outputs: [found.output.id] },
        { refusedCode: 'output_refused' },
      );
    }
    query += '&clear=true&playback=start';
  } else if (mode === MUSIC_PLAY_MODES.NEXT) {
    // After the item being played, in the order the queue plays.
    const current = await currentPosition(hub);
    if (current !== null) {
      query += `&position=${current + 1}`;
    }
  } else if (mode !== MUSIC_PLAY_MODES.APPEND) {
    throw new Error(`Unknown play mode ${mode}`);
  }
  let added;
  try {
    added = await hub.call('POST', `queue/items/add?${query}`);
  } catch (err) {
    // An unknown URI is a 500 for OwnTone.
    throw err.code === 'refused' ? new CommandError('not_playable', hub.language) : err;
  }
  if (Number(added?.count) === 0) {
    throw new CommandError('not_playable', hub.language);
  }
}

/** The position of the item being played in the queue, or null. */
async function currentPosition(hub) {
  const player = await read(hub, 'player');
  const itemId = Number(player?.item_id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return null;
  }
  const item = parseQueueItem(list(await read(hub, `queue?id=${itemId}`))[0]);
  return item?.position ?? null;
}

/**
 * onMusicQueueGet: a page of OwnTone's queue, in the order it plays.
 * @returns {Promise<{ items: object[], currentIndex: number|null, total: number }>}
 */
export async function queueGet(hub, device, { offset = 0, limit = 50 } = {}) {
  serverOf(hub, device);
  const [answer, current] = await Promise.all([
    read(hub, `queue?start=${offset}&end=${offset + limit}`),
    currentPosition(hub),
  ]);
  // No row dropped: the page must stay aligned with the indexes of the queue.
  const items = list(answer).map((raw) => {
    const item = parseQueueItem(raw);
    const row = {
      id: usableId(item?.uri) ? item.uri : `queue:${item?.id ?? '?'}`,
      type: item?.stream ? MUSIC_MEDIA_TYPES.RADIO : MUSIC_MEDIA_TYPES.TRACK,
      title: item?.title || clip(baseName(item?.uri ?? '')) || '?',
      duration: item?.stream ? null : durationOf(item?.lengthMs),
      browsable: false,
      playable: true,
    };
    if (item?.artist) {
      row.subtitle = item.artist;
    }
    return withArtwork(hub, row, item?.artworkUrl);
  });
  return {
    items,
    // Stopped, OwnTone keeps an item current: play resumes it.
    currentIndex: current,
    total: Number.isInteger(answer?.count) ? answer.count : items.length,
  };
}

/** onMusicQueuePlay: jump to an item of the queue. */
export async function queuePlay(hub, device, index) {
  serverOf(hub, device);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid queue index ${index}`);
  }
  try {
    await hub.call('PUT', `player/play?position=${index}`);
  } catch (err) {
    // OwnTone answers 400 for a position past the end of the queue.
    throw err.code === 'refused' ? new CommandError('not_in_queue', hub.language) : err;
  }
}

/**
 * onMusicGetArtwork: the bytes of an artwork whose URL artworkKey recorded,
 * read with the password. OwnTone scales them (`maxwidth`); a PNG may still
 * be above the 300 KB Gladys accepts: asked again smaller.
 * @returns {Promise<string>} raw base64
 */
export async function artwork(hub, key) {
  const recorded = hub.gladys.artworkUrls.get(key);
  if (recorded === undefined) {
    throw new Error(`Unknown artwork ${key}`);
  }
  if (!hub.client) {
    throw new CommandError('not_configured', hub.language);
  }
  const url = new URL(recorded);
  const asked = Number(url.searchParams.get('maxwidth'));
  const sizes = asked > 0 ? [asked, 300, 200, 120].filter((size) => size <= asked) : [0];
  for (const size of sizes) {
    if (size > 0) {
      url.searchParams.set('maxwidth', String(size));
      url.searchParams.set('maxheight', String(size));
    }
    let image;
    try {
      image = await hub.client.fetchImage(url.href, MAX_ARTWORK_BYTES);
    } catch (err) {
      if (err instanceof OwnToneError && err.code === 'too_large') {
        continue;
      }
      throw new Error(`Artwork ${key}: ${err.message}`, { cause: err });
    }
    if (image === null) {
      throw new CommandError('no_artwork', hub.language);
    }
    return image.toString('base64');
  }
  throw new Error(`Artwork ${key}: larger than 300 KB`);
}
