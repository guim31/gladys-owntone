// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// OwnTone's web interface and JSON API.
export const DEFAULT_PORT = 3689;

export const DEFAULT_CONFIG = {
  host: '',
  port: DEFAULT_PORT,
  password: '',
  language: 'fr',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function portOf(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(number) && number >= 1 && number <= 65535 ? number : null;
}

/**
 * The server address the user typed: `192.0.2.10`, `owntone.lan`,
 * `192.0.2.10:3689`, `[2001:db8::1]:3689`, or the address of the web
 * interface (`http://192.0.2.10:3689/`). Returns null when it is not usable.
 * @returns {{ host: string, port: number|null } | null}
 */
export function parseHost(raw) {
  const typed = text(raw)
    .replace(/^http:\/\//i, '')
    .replace(/\/+$/, '');
  // OwnTone serves plain HTTP: any other scheme (https://...) is refused.
  if (typed === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) || /[\s/@?#]/.test(typed)) {
    return null;
  }
  let url;
  try {
    url = new URL(`http://${typed}`);
  } catch {
    return null;
  }
  if (url.hostname === '') {
    return null;
  }
  // The API is reached as http://host:port: an IPv6 address keeps its
  // brackets in the URL, not in `host`.
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port ? Number(url.port) : null };
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const parsed = parseHost(source.host);
  return {
    configured: text(source.host) !== '',
    valid: parsed !== null,
    host: parsed?.host ?? '',
    port: parsed?.port ?? portOf(source.port) ?? DEFAULT_PORT,
    // Kept as typed: a password may start or end with a space.
    password: typeof source.password === 'string' ? source.password : '',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
