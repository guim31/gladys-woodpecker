// -----------------------------------------------------------------------------
// The Woodpecker hub: the repositories and the queue read on a timer of the
// container (every minute by default), the pipelines of a repository read
// again only when its last pipeline moved, the states published when they
// change, the scene events fired when a pipeline ends, a repository breaks or
// gets back to green, and the pipelines restarted from scenes (an option, off
// by default).
//
// Gladys never polls these devices (should_poll: false): an event must fire
// for a repository added to Gladys or not, and the interval goes beyond the
// fixed list of the core scheduler.
//
// What was seen is kept in /data (src/store.js): the finished pipelines of
// each repository and whether it was failing, so that a restart neither
// misses an event nor announces it twice. The first reading of a repository
// only sets what is known: no event for the past.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildRepoDevice,
  buildServerDevice,
  decisiveOf,
  eventText,
  isFailing,
  isRunning,
  parseRepoId,
  pipelineUrl,
  repoIds,
  repoValues,
  serverIds,
  serverValues,
} from './devices.js';
import {
  ACTIVE,
  ERROR_KINDS,
  WoodpeckerClient,
  WoodpeckerError,
  isActive,
  isBroken,
  isDecisive,
} from './woodpecker/client.js';
import { MAX_REPOS, SCOPES, hostOf, isFollowed, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  STATUS_TEXT,
  SUMMARY_TEXT,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'woodpecker-hub' });

export const WIDGET_KEY = 'pipelines';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  FINISHED: 'pipeline_finished',
  STATUS: 'repo_status_changed',
});

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A command reads Woodpecker again when the last read is older.
  freshMs: 30_000,
};

// Events fired at most per repository and reading (a burst of pipelines does
// not flood the scenes), pipeline numbers remembered per repository, refused
// events kept, pipeline lists read at once.
const MAX_EVENTS = 3;
const SEEN_PIPELINES = 20;
const MAX_PENDING = 20;
const MAX_TRANSPORTS_PER_REQUEST = 100;
const CONCURRENCY = 4;

/**
 * A server on the local network (private address, `.local`, a name without
 * a dot) shows the "local" badge, any other the "cloud" one.
 */
export function transportOf(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return DEVICE_TRANSPORTS.CLOUD;
  }
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    const local =
      a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return local || (a === 169 && b === 254) ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD;
  }
  if (isIP(host) === 6) {
    return /^(::1$|fc|fd|fe80)/.test(host) ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD;
  }
  return !host.includes('.') || /\.(local|lan|home|internal|home\.arpa)$/.test(host)
    ? DEVICE_TRANSPORTS.LOCAL
    : DEVICE_TRANSPORTS.CLOUD;
}

// The events that count on the default branch (no pull request).
export const DEFAULT_BRANCH_EVENTS = ['push', 'manual', 'cron', 'deployment', 'tag', 'release'];

/** The filter of the pipeline list for a repository (src/woodpecker/client.js). */
export const filterOf = (repo, scope) =>
  scope === SCOPES.ALL || !repo.defaultBranch
    ? {}
    : { branch: repo.defaultBranch, events: DEFAULT_BRANCH_EVENTS };

/** The pipelines that count for a repository, newest first. */
export function inScope(repo, pipelines, scope) {
  if (scope === SCOPES.ALL) {
    return pipelines;
  }
  return pipelines.filter(
    (pipeline) =>
      !pipeline.event.startsWith('pull_request') &&
      (!repo.defaultBranch || pipeline.branch === repo.defaultBranch),
  );
}

/** Run `fn` on every item, `limit` at a time. */
async function eachLimited(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// What makes the pipeline list of a repository worth reading again.
const signatureOf = (repo) => (repo.last ? `${repo.last.number}:${repo.last.status}` : '');

export class WoodpeckerHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/woodpecker/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    this.resetRead();
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = emptySaved();
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle: one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  resetRead() {
    /** @type {Map<number, object>} followed repositories, by Woodpecker id */
    this.repos = new Map();
    /** @type {Map<number, { signature: string, pipelines: object[] }>} every pipeline read */
    this.cache = new Map();
    this.totalRepos = 0;
    this.missing = [];
    this.tooMany = false;
    this.queue = null;
    this.version = null;
    this.readAt = 0;
    this.error = null;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) =>
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    this.saved = {
      url: typeof saved.url === 'string' ? saved.url : null,
      scope: typeof saved.scope === 'string' ? saved.scope : null,
      repos: object(saved.repos),
      pending: Array.isArray(saved.pending) ? saved.pending : [],
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (previous.language !== config.language) {
      // New names for the Discovery tab, texts in the new language.
      this.discovered = null;
      this.gladys.forgetPublishedStates?.();
    }
    // A read under way was made for the previous configuration.
    await this.polling?.catch(() => {});
    const signature = JSON.stringify([config.url, config.token, config.repos, config.scope]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client =
        config.url && config.token
          ? new WoodpeckerClient({ url: config.url, token: config.token, request: this.request })
          : null;
      this.resetRead();
      this.polling = null;
      // Another server: what was learnt about the previous one is worthless.
      if (config.url && this.saved.url && this.saved.url !== config.url) {
        this.saved = emptySaved();
      }
      if (config.url) {
        this.saved.url = config.url;
      }
      // Other pipelines count: what was seen under the previous scope would
      // announce the past, or a return to green of a repository never red.
      if (this.saved.scope && this.saved.scope !== config.scope) {
        this.saved.repos = {};
      }
      this.saved.scope = config.scope;
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Woodpecker works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading Woodpecker ------------------------------------------------------

  /** Read Woodpecker now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs`. */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read Woodpecker and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    // The queue (admin only) and the version are extras: a user token still
    // gets the repositories.
    const extra = (promise, label) =>
      promise.catch((err) => {
        if (!(err instanceof WoodpeckerError) || isGlobal(err)) {
          throw err;
        }
        logger.debug(`${label} unreadable: ${err.message}`);
        return null;
      });
    let result;
    try {
      const [repos, queue, version] = await Promise.all([
        client.repos(),
        extra(client.queue(), 'Queue'),
        this.version === null || this.error ? extra(client.version(), 'Version') : this.version,
      ]);
      const followed = repos.filter((repo) => isFollowed(repo.fullName, this.config.repos));
      const kept = followed.slice(0, MAX_REPOS);
      const pipelines = await this.readPipelines(client, kept);
      result = { repos, followed, kept, pipelines, queue, version: version ?? '' };
    } catch (err) {
      if (!(err instanceof WoodpeckerError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    return client === this.client && this.applySuccess(result);
  }

  /**
   * The pipelines of each repository: read again only when its last pipeline
   * moved, or while one of its pipelines runs (an older one may end after a
   * newer one).
   * @returns {Promise<Map<number, object[]>>}
   */
  async readPipelines(client, repos) {
    const out = new Map();
    await eachLimited(repos, CONCURRENCY, async (repo) => {
      const cached = this.cache.get(repo.id);
      const signature = signatureOf(repo);
      if (!repo.last) {
        out.set(repo.id, { signature, pipelines: [] });
        return;
      }
      // A pipeline awaiting approval may wait for days: not read again for it.
      if (
        cached &&
        cached.signature === signature &&
        !cached.pipelines.some(
          (pipeline) => pipeline.status === ACTIVE.RUNNING || pipeline.status === ACTIVE.PENDING,
        )
      ) {
        out.set(repo.id, cached);
        return;
      }
      try {
        out.set(repo.id, {
          signature,
          pipelines: await client.pipelines(repo.id, filterOf(repo, this.config.scope)),
        });
      } catch (err) {
        if (!(err instanceof WoodpeckerError) || isGlobal(err)) {
          throw err;
        }
        // Deactivated between the two requests, or a hiccup: what was known
        // stays, read again next time; nothing known (just started): the
        // repository waits for the next reading (null).
        this.problems.fail(`pipelines:${repo.id}`, `${repo.fullName}: ${err.message}`);
        out.set(repo.id, cached ? { signature: null, pipelines: cached.pipelines } : null);
        return;
      }
      this.problems.recover(`pipelines:${repo.id}`, `${repo.fullName}: pipelines read again`);
    });
    return out;
  }

  async applySuccess({ repos, followed, kept, pipelines, queue, version }) {
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error) {
      logger.info('Woodpecker answers again');
    }
    if (version !== this.version) {
      logger.info(`Connected to Woodpecker ${version || '(version unknown)'}`);
      if (isTooOld(version)) {
        logger.warn(`Woodpecker ${version}: version 3 or later is needed to read the pipelines`);
      }
      this.version = version;
    }
    this.error = null;
    this.readAt = this.now();

    this.totalRepos = repos.length;
    this.tooMany = followed.length > MAX_REPOS;
    const missing = this.config.repos.filter(
      (name) => !repos.some((repo) => isFollowed(repo.fullName, [name])),
    );
    if (missing.length > 0) {
      this.problems.fail('missing', `Repositories not found in Woodpecker: ${missing.join(', ')}`);
    } else {
      this.problems.recover('missing', 'Every listed repository is found');
    }
    this.missing = missing;

    this.cache = new Map([...pipelines].filter(([, entry]) => entry));
    // A repository whose pipelines could not be read yet keeps what was
    // published before, or waits: never "No pipeline" for an unread one.
    const unread = new Set(kept.filter((repo) => !pipelines.get(repo.id)).map((repo) => repo.id));
    const next = new Map();
    for (const repo of kept) {
      if (!unread.has(repo.id)) {
        next.set(repo.id, {
          ...repo,
          pipelines: inScope(repo, pipelines.get(repo.id).pipelines, this.config.scope),
        });
      } else if (this.repos.has(repo.id)) {
        next.set(repo.id, this.repos.get(repo.id));
      }
    }
    if (JSON.stringify(viewOf(this.repos, this.queue)) !== JSON.stringify(viewOf(next, queue))) {
      widgetChanged = true;
    }
    this.repos = next;
    this.queue = queue;

    let dirty = false;
    const events = [];
    for (const repo of next.values()) {
      if (unread.has(repo.id)) {
        continue;
      }
      const { saved, found } = this.compareRepo(repo);
      events.push(...found);
      if (JSON.stringify(this.saved.repos[repo.id]) !== JSON.stringify(saved)) {
        this.saved.repos[repo.id] = saved;
        dirty = true;
      }
    }
    // Repositories no longer followed are forgotten (one beyond the cap of
    // 50 keeps what was seen: the order of the list may change).
    const followedIds = new Set(followed.map((repo) => repo.id));
    for (const id of Object.keys(this.saved.repos)) {
      if (!followedIds.has(Number(id))) {
        delete this.saved.repos[id];
        dirty = true;
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    // Saved before the events: a crash in between never announces one twice.
    if (dirty) {
      await this.store.save(this.saved);
    }
    await this.publishStates();
    await this.sendEvents(events);
    return widgetChanged;
  }

  /**
   * What is new in a repository since the last reading: the pipelines that
   * finished, and whether it broke or got back to green.
   */
  compareRepo(repo) {
    const before = this.saved.repos[repo.id];
    const known = Boolean(before) && Array.isArray(before.seen);
    const seen = known ? before.seen : [];
    let broken = known && typeof before.broken === 'boolean' ? before.broken : null;
    // The newest pipeline that decided the status: an older pipeline ending
    // later does not flip it back.
    let decided = known && Number.isInteger(before.decided) ? before.decided : 0;
    const finished = repo.pipelines
      .filter((pipeline) => !isActive(pipeline.status))
      .sort((a, b) => a.number - b.number);
    const fresh = finished.filter((pipeline) => !seen.includes(pipeline.number));
    const current = finished.map((pipeline) => pipeline.number).sort((a, b) => b - a);
    const found = [];
    const device = repoIds(this.gladys, repo.id).device;
    const language = this.config.language;
    const summary = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
    const common = { repo: device, repo_name: repo.fullName };

    for (const pipeline of fresh) {
      const decisive = isDecisive(pipeline.status);
      if (!known) {
        // First reading: what is known, no event for the past.
        if (decisive && pipeline.number > decided) {
          broken = isBroken(pipeline.status);
          decided = pipeline.number;
        }
        continue;
      }
      const result = pipeline.status;
      const status = pick(STATUS_TEXT[result], language);
      const url = pipelineUrl(this.config.url, repo, pipeline.number);
      const announce = fresh.length - fresh.indexOf(pipeline) <= MAX_EVENTS;
      if (announce) {
        found.push({
          key: TRIGGERS.FINISHED,
          data: {
            ...common,
            number: pipeline.number,
            result,
            status,
            branch: pipeline.branch,
            event: eventText(pipeline.event, language),
            duration: pipeline.duration ?? 0,
            url,
            summary: summary.finished(repo.fullName, pipeline.number, status),
          },
        });
      }
      if (decisive && pipeline.number > decided) {
        decided = pipeline.number;
        const nowBroken = isBroken(pipeline.status);
        // The first failure of a repository counts; a success only after a failure.
        const turned = nowBroken ? broken !== true : broken === true;
        if (turned) {
          const state = nowBroken ? 'failure' : 'success';
          found.push({
            key: TRIGGERS.STATUS,
            data: {
              ...common,
              state,
              result,
              number: pipeline.number,
              branch: pipeline.branch,
              url,
              summary: summary[state](repo.fullName, pipeline.number),
            },
          });
        }
        broken = nowBroken;
      }
    }
    // The numbers of the current window are always kept: a pipeline dropped
    // from the list would be announced again at every reading.
    const numbers = [...current, ...seen.filter((number) => !current.includes(number))].slice(
      0,
      SEEN_PIPELINES,
    );
    return { saved: { seen: numbers, broken, decided }, found };
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Woodpecker: ${err.message}`);
    }
    if (!wasError) {
      // The server device says so at once, even with nothing else published.
      await this.publishStates();
    }
    return wasError !== err.kind;
  }

  /**
   * Send the events refused before, then the new ones. One refused (Gladys
   * restarting) is kept in /data and sent again at the next reading.
   */
  async sendEvents(events) {
    const queue = [...this.saved.pending, ...events];
    if (queue.length === 0) {
      return;
    }
    const refused = [];
    for (const event of queue) {
      if (refused.length > 0 || !(await this.fire(event.key, event.data))) {
        refused.push(event);
      }
    }
    if (refused.length > 0 || this.saved.pending.length > 0) {
      this.saved.pending = refused.slice(-MAX_PENDING);
      await this.store.save(this.saved);
    }
  }

  async fire(eventKey, data) {
    try {
      await this.gladys.publishSceneEvent(eventKey, data);
      logger.debug(`${data.repo_name}: ${eventKey}`);
      this.problems.recover('events', 'Scene events accepted again');
      return true;
    } catch (err) {
      this.problems.fail('events', `Scene event ${eventKey} refused: ${err.message}`);
      return false;
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** The figures of the server device and the widget; null when unknown. */
  summary() {
    const repos = [...this.repos.values()];
    return {
      reachable: this.readAt > 0 && !this.error,
      pending: this.queue ? this.queue.pending : null,
      running: this.queue ? this.queue.running : null,
      idleAgents: this.queue ? this.queue.idleAgents : null,
      failingRepos: repos.filter(isFailing).length,
      runningRepos: repos.filter(isRunning).length,
    };
  }

  discoveredDevices() {
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    const language = this.config.language;
    return [
      buildServerDevice(this.gladys, { url: this.config.url, version: this.version }, language),
      ...[...this.repos.values()].map((repo) =>
        buildRepoDevice(this.gladys, repo, this.config.url, language),
      ),
    ];
  }

  /** Publish the Discovery list when it changed (a repository activated, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const signature = JSON.stringify(devices);
    if (!force && signature === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = signature;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Woodpecker, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys (the SDK forgets them: they go again).
   */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.refreshIfStale();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`). While the
   * server does not answer, only "reachable" goes, at 0.
   */
  async publishStates() {
    if (this.readAt === 0) {
      return;
    }
    const states = [];
    const server = serverIds(this.gladys);
    if (this.isCreated(server.device)) {
      states.push(
        ...(this.error
          ? [{ device_feature_external_id: server.feature('reachable'), state: 0 }]
          : serverValues(this.gladys, this.summary())),
      );
    }
    if (!this.error) {
      for (const repo of this.repos.values()) {
        if (this.isCreated(repoIds(this.gladys, repo.id).device)) {
          states.push(...repoValues(this.gladys, repo, this.config.language));
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local or cloud, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : transportOf(this.config.url);
    const ids = [
      serverIds(this.gladys).device,
      ...[...this.repos.keys()].map((id) => repoIds(this.gladys, id).device),
    ];
    const entries = ids
      .filter((id) => this.isCreated(id) && this.transports.get(id) !== transport)
      .map((id) => ({ external_id: id, transport }));
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.urlTyped) {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (!this.config.token) {
      return { connected: false, message: CONNECTION_TEXT.noToken };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const signature = JSON.stringify(status);
    if (signature === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = signature;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands (scene actions, widget, report) --------------------------------

  /** Throws the reason Woodpecker cannot answer, if any. */
  assertReadable(language = this.config.language) {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, language));
    }
  }

  /** A followed repository, by device external id, read again when the last read is old. */
  async repoOf(externalId, language = this.config.language) {
    const id = parseRepoId(this.gladys, externalId);
    if (!id) {
      throw new Error(pick(ACTION_TEXT.notFollowed, language));
    }
    await this.refreshIfStale();
    this.assertReadable(language);
    const repo = this.repos.get(id);
    if (!repo) {
      throw new Error(pick(ACTION_TEXT.notFollowed, language));
    }
    return repo;
  }

  /**
   * Restart the last pipeline of a followed repository (in the scope of the
   * configuration), when the configuration allows it.
   * @returns {Promise<{ number: number }>} the number of the new pipeline (0: unknown)
   */
  async restart(repo, language = this.config.language) {
    if (!this.config.allowRestart) {
      throw new Error(pick(ACTION_TEXT.restartDisabled, language));
    }
    // The newest finished pipeline: a running one would run twice, a blocked
    // one is refused by Woodpecker.
    const last = repo.pipelines.find((pipeline) => !isActive(pipeline.status));
    if (!last) {
      throw new Error(pick(ACTION_TEXT.noPipeline, language));
    }
    try {
      const pipeline = await this.client.restart(repo.id, last.number);
      logger.info(`${repo.fullName}: pipeline #${last.number} restarted`);
      return { restarted: last.number, number: pipeline?.number ?? 0 };
    } catch (err) {
      if (!(err instanceof WoodpeckerError)) {
        throw err;
      }
      const text =
        err.kind === ERROR_KINDS.FORBIDDEN ? ACTION_TEXT.restartForbidden : ERROR_TEXT[err.kind];
      throw new Error(`${repo.fullName}: ${pick(text, language)}`, { cause: err });
    }
  }

  /** "Test the connection": Woodpecker, its version, the repositories followed. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const status = this.connectionStatus();
    if (!status.connected) {
      return status.message;
    }
    const summary = this.summary();
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const lines = [
        `${text.ok} (${hostOf(this.config.url)}, Woodpecker ${this.version || '?'})`,
        [text.repos(this.repos.size, this.totalRepos), text.failing(summary.failingRepos)].join(
          ' · ',
        ),
        summary.idleAgents === null
          ? text.noQueue
          : text.queue(summary.pending, summary.running, summary.idleAgents),
        text.restart(this.config.allowRestart),
      ];
      if (isTooOld(this.version)) {
        lines.push(text.tooOld(this.version));
      }
      if (this.missing.length > 0) {
        lines.push(text.missing(this.missing.join(', ')));
      }
      if (this.tooMany) {
        lines.push(text.tooMany(MAX_REPOS));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }
}

function emptySaved() {
  // repos: Woodpecker id → { seen: [finished pipeline numbers], broken:
  // bool|null, decided }; pending: scene events Gladys refused (it restarts),
  // sent again at the next reading.
  return { url: null, scope: null, repos: {}, pending: [] };
}

/** Woodpecker 2 and older give no last pipeline per repository. */
export const isTooOld = (version) => /^[0-2]\./.test(version ?? '');

// The whole server is concerned, not one part of the reading.
const isGlobal = (err) =>
  [
    ERROR_KINDS.UNREACHABLE,
    ERROR_KINDS.TIMEOUT,
    ERROR_KINDS.TLS,
    ERROR_KINDS.AUTH,
    ERROR_KINDS.REDIRECT,
  ].includes(err.kind);

/** What the widget shows: a change refreshes it. */
function viewOf(repos, queue) {
  return [
    [...repos.values()].map((repo) => [
      repo.id,
      repo.fullName,
      repo.pipelines[0]?.number,
      repo.pipelines[0]?.status,
      decisiveOf(repo)?.number,
    ]),
    queue,
  ];
}
