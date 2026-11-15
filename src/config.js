// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Woodpecker server: its address, a personal access token, the
// repositories to follow (empty: every active one), which pipelines count,
// and the option that lets scenes restart a pipeline.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in minutes.
export const POLL_INTERVALS = ['1', '2', '5', '10', '15'];

// Which pipelines decide the status of a repository.
export const SCOPES = Object.freeze({
  // Pushes, cron and manual runs, deployments on the default branch: a pull
  // request or a feature branch failing does not turn the repository red.
  DEFAULT_BRANCH: 'default_branch',
  ALL: 'all',
});

// Repositories followed, at most: as many devices in the Discovery tab.
export const MAX_REPOS = 50;

export const DEFAULT_CONFIG = {
  url: '',
  token: '',
  repos: '',
  scope: SCOPES.DEFAULT_BRANCH,
  allow_restart: false,
  poll_interval: '1',
  language: 'fr',
};

// Pages of the web interface: a URL copied from the browser may point at one.
const INTERFACE_PATH = /\/(repos|api|admin|user|org|login|settings)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: `host:port` (HTTP), a
 * host alone (HTTPS), or a URL copied from the browser. A sub-path (the
 * WOODPECKER_ROOT_PATH of the server, a reverse proxy) is kept.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `${/^[^/]+:\d+/.test(text) ? 'http' : 'https'}://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * The repositories typed by the user: `owner/name`, an owner alone (every
 * repository of that user or organization), or links copied from the forge,
 * separated by commas, semicolons, spaces or new lines. Case-insensitive, as
 * the forges are.
 * @returns {string[]} lower-case
 */
export function parseRepos(raw) {
  const names = [];
  const text = typeof raw === 'string' ? raw : '';
  for (const part of text.split(/[,;\s]+/)) {
    let name = part.trim();
    if (/^https?:\/\//i.test(name)) {
      try {
        // https://codeberg.org/owner/name(.git)(/…) → owner/name
        name = new URL(name).pathname.split('/').filter(Boolean).slice(0, 2).join('/');
      } catch {
        name = '';
      }
    }
    name = name
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase();
    if (name && !names.includes(name)) {
      names.push(name.slice(0, 500));
    }
  }
  return names;
}

/** Whether a repository is followed: listed, or its owner listed; every one when the list is empty. */
export function isFollowed(fullName, followed) {
  const name = fullName.toLowerCase();
  return (
    followed.length === 0 ||
    followed.some(
      (entry) => name === entry || (!entry.includes('/') && name.startsWith(`${entry}/`)),
    )
  );
}

const truthy = (value) => value === true || value === 'true' || value === 1 || value === '1';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  const typed = text('url');
  return {
    // null: nothing typed, or not understood (see hub.connectionStatus).
    url: typed ? parseServerUrl(typed) : null,
    urlTyped: Boolean(typed),
    // A pasted token often carries a trailing space or new line.
    token: text('token'),
    repos: parseRepos(source.repos),
    scope: Object.values(SCOPES).includes(source.scope) ? source.scope : DEFAULT_CONFIG.scope,
    allowRestart: truthy(source.allow_restart),
    pollIntervalMs: Number(pollInterval) * 60_000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
