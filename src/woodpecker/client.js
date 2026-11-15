// -----------------------------------------------------------------------------
// Woodpecker CI client: the REST API of the server, authenticated by a
// personal access token (`Authorization: Bearer`). One reading is two
// requests, plus one per repository whose last pipeline moved:
//
//   GET /api/user/repos                          the active repositories the
//                                                user can see, each with its
//                                                `last_pipeline` (Woodpecker 3)
//   GET /api/queue/info                          pending and running workflows,
//                                                idle agents (admin only:
//                                                a 403 leaves them unknown)
//   GET /api/repos/<id>/pipelines?perPage=10     the newest pipelines of a repo
//   GET /api/version                             once, and after an outage
//
// Restarting a pipeline (an option of the configuration, off by default):
//
//   POST /api/repos/<id>/pipelines/<number>      a new pipeline, same commit
//
// Redirects are not followed: the token would go wherever the address points
// (an http:// address redirected to https:// is reported instead).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TIMEOUT: 'timeout', // no answer in time
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // token missing or refused (401)
  FORBIDDEN: 'forbidden', // the user may not do this (403)
  NOT_WOODPECKER: 'not_woodpecker', // something answers, not the Woodpecker API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  NOT_FOUND: 'not_found', // the repository or pipeline does not exist
  TOO_LARGE: 'too_large', // an answer exceeds MAX_BODY_BYTES
  HTTP: 'http', // any other HTTP error
});

export class WoodpeckerError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'WoodpeckerError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// A repository weighs about 2 KB in /api/user/repos: thousands of them stay
// far below this, and so does the 256 MB of the sandbox.
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

// Pipelines read per repository: the events of a burst beyond that are lost.
export const PIPELINES_PER_PAGE = 10;

async function readCapped(response, max) {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > max) {
    await response.body?.cancel();
    throw Object.assign(new Error('Response too large'), { code: 'TOO_LARGE' });
  }
  if (!response.body) {
    return '';
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > max) {
      throw Object.assign(new Error('Response too large'), { code: 'TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Woodpecker
 * (test/helpers/fakeWoodpecker.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 15_000, maxBytes = MAX_BODY_BYTES } = {},
) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await readCapped(response, maxBytes) };
}

// The result of a finished pipeline, as Woodpecker names it (keys of the
// scene filters: permanent once published).
export const RESULTS = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure', // a step failed
  ERROR: 'error', // the pipeline could not run (configuration error)
  KILLED: 'killed', // cancelled
  DECLINED: 'declined', // approval refused
  SKIPPED: 'skipped', // nothing to run
});

// A pipeline not finished yet: waiting for an agent, running, or waiting for
// an approval.
export const ACTIVE = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  BLOCKED: 'blocked',
});

const STATUS_OF = {
  ...Object.fromEntries(Object.values(RESULTS).map((value) => [value, value])),
  ...Object.fromEntries(Object.values(ACTIVE).map((value) => [value, value])),
  created: ACTIVE.PENDING,
};

/** A pipeline that "breaks" a repository: a step failed, or it could not run. */
export const isBroken = (result) => result === RESULTS.FAILURE || result === RESULTS.ERROR;
/** A result that decides whether a repository passes. */
export const isDecisive = (result) => result === RESULTS.SUCCESS || isBroken(result);
export const isActive = (status) => Object.values(ACTIVE).includes(status);

const positive = (value) => (Number.isInteger(value) && value > 0 ? value : null);
const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);
const textOf = (value, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** A pipeline. Null without a number or a known status. */
export function normalizePipeline(raw) {
  const number = positive(raw?.number);
  const status = STATUS_OF[raw?.status];
  if (!number || !status) {
    return null;
  }
  const started = positive(raw.started);
  const finished = positive(raw.finished);
  return {
    number,
    status,
    event: textOf(raw.event, 40),
    branch: textOf(raw.branch, 255),
    // Seconds, as Woodpecker counts.
    created: positive(raw.created),
    started,
    finished: isActive(status) ? null : finished,
    duration:
      !isActive(status) && started && finished && finished >= started ? finished - started : null,
    author: textOf(raw.author, 100),
    message: textOf(raw.message, 500),
    commit: textOf(raw.commit, 64),
  };
}

/** An active repository. Null for anything else. */
export function normalizeRepo(raw) {
  const id = positive(raw?.id);
  const fullName = textOf(raw?.full_name, 500);
  if (!id || !fullName || raw.active === false) {
    return null;
  }
  return {
    id,
    fullName,
    defaultBranch: textOf(raw.default_branch, 255),
    forgeUrl: textOf(raw.forge_url, 500),
    last: raw.last_pipeline ? normalizePipeline(raw.last_pipeline) : null,
  };
}

export function normalizeQueue(raw) {
  const stats = raw?.stats;
  if (!stats || typeof stats !== 'object') {
    return null;
  }
  return {
    pending: count(stats.pending_count) + count(stats.waiting_on_deps_count),
    running: count(stats.running_count),
    // Agents connected and waiting for work: a busy agent is not counted.
    idleAgents: count(stats.worker_count),
    paused: raw.paused === true,
  };
}

const parse = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

export class WoodpeckerClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} options.token personal access token
   * @param {Function} [options.request] test seam (httpRequest)
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, token = '', request = httpRequest, timeoutMs = 15_000 }) {
    this.url = url;
    this.authorization = token ? `Bearer ${token}` : null;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async call(path, { method = 'GET', headers = {}, body } = {}) {
    const all = { accept: 'application/json', ...headers };
    if (this.authorization) {
      all.authorization = this.authorization;
    }
    try {
      return await this.request(`${this.url}${path}`, {
        method,
        headers: all,
        body,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new WoodpeckerError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      if (code === 'TOO_LARGE') {
        throw new WoodpeckerError(ERROR_KINDS.TOO_LARGE, 'Response too large');
      }
      if (err.name === 'TimeoutError' || code === 23) {
        throw new WoodpeckerError(ERROR_KINDS.TIMEOUT, 'No answer in time');
      }
      throw new WoodpeckerError(ERROR_KINDS.UNREACHABLE, String(code ?? err.name ?? err.message));
    }
  }

  /** Throws the error of a status that is not a success. */
  check(status, { item = false } = {}) {
    if (status === 401) {
      throw new WoodpeckerError(ERROR_KINDS.AUTH, 'Token refused (HTTP 401)', { status });
    }
    if (status === 403) {
      throw new WoodpeckerError(ERROR_KINDS.FORBIDDEN, 'Permission denied (HTTP 403)', { status });
    }
    if (status >= 300 && status < 400) {
      throw new WoodpeckerError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw item
        ? new WoodpeckerError(ERROR_KINDS.NOT_FOUND, 'Not found (HTTP 404)', { status })
        : new WoodpeckerError(ERROR_KINDS.NOT_WOODPECKER, 'No Woodpecker API here (HTTP 404)', {
            status,
          });
    }
    if (status < 200 || status >= 300) {
      throw new WoodpeckerError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, {
        status,
      });
    }
  }

  async getJson(path, options) {
    const response = await this.call(path);
    this.check(response.status, options);
    const data = parse(response.body);
    if (!data || typeof data !== 'object') {
      throw new WoodpeckerError(ERROR_KINDS.NOT_WOODPECKER, 'The answer is not the Woodpecker API');
    }
    return data;
  }

  /** The version of the server ("3.20.1"), '' when it does not say. */
  async version() {
    const data = await this.getJson('/api/version');
    return textOf(data.version, 40);
  }

  /** The active repositories the token can see, with their last pipeline. */
  async repos() {
    const data = await this.getJson('/api/user/repos');
    if (!Array.isArray(data)) {
      throw new WoodpeckerError(ERROR_KINDS.NOT_WOODPECKER, 'The answer is not the Woodpecker API');
    }
    return data.map(normalizeRepo).filter(Boolean);
  }

  /** The newest pipelines of a repository, newest first. */
  async pipelines(repoId) {
    const data = await this.getJson(
      `/api/repos/${repoId}/pipelines?page=1&perPage=${PIPELINES_PER_PAGE}`,
      { item: true },
    );
    if (!Array.isArray(data)) {
      throw new WoodpeckerError(ERROR_KINDS.NOT_WOODPECKER, 'The answer is not the Woodpecker API');
    }
    return data
      .map(normalizePipeline)
      .filter(Boolean)
      .sort((a, b) => b.number - a.number);
  }

  /** Pending and running workflows, idle agents. Admin only. */
  async queue() {
    return normalizeQueue(await this.getJson('/api/queue/info'));
  }

  /**
   * Restart a pipeline: Woodpecker creates a new one, on the same commit.
   * @returns {Promise<object|null>} the new pipeline
   */
  async restart(repoId, number) {
    const response = await this.call(`/api/repos/${repoId}/pipelines/${number}`, {
      method: 'POST',
    });
    this.check(response.status, { item: true });
    return normalizePipeline(parse(response.body));
  }
}
