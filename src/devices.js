// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab.
//
// One per followed repository, identified by its Woodpecker id (it survives a
// rename of the repository on the forge):
//
//   status             text/text               "Success", "Failed", "Error",
//                                              "Running", "Pending"…
//   passing            input/binary            1 when the last finished pipeline
//                                              succeeded, 0 when it failed or
//                                              could not run; unchanged otherwise
//   running            input/binary            1 while a pipeline runs or waits
//   pipeline_number    counter-sensor/integer  number of the last pipeline
//   pipeline_duration  duration/integer (s)    duration of the last finished one
//   branch             text/text               branch of the last pipeline
//   event              text/text               what started it: push, pull
//                                              request, tag, cron, manual…
//
// One for the server:
//
//   reachable          input/binary            the server answers
//   pending            counter-sensor/integer  workflows waiting for an agent
//   running            counter-sensor/integer  workflows running
//   idle_agents        counter-sensor/integer  agents connected and free
//   failing_repos      counter-sensor/integer  followed repositories failing
//
// The queue and the agents need an admin token: unknown otherwise, never
// published. Read-only: restarting a pipeline is a scene action. Published
// with should_poll: false, the integration reads Woodpecker on its own timer
// (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { ACTIVE, RESULTS, isActive, isBroken, isDecisive } from './woodpecker/client.js';
import { EVENT_TEXT, STATUS_TEXT, pick } from './texts.js';

export const REPO_TYPE = 'repo';
export const SERVER_TYPE = 'server';
// One Woodpecker per integration: the server device keeps its id when the
// address changes (a new IP, HTTPS added).
export const SERVER_ID = 'woodpecker';

// Suffixes of the feature external ids: permanent once published.
export const REPO_FEATURES = Object.freeze({
  STATUS: 'status',
  PASSING: 'passing',
  RUNNING: 'running',
  PIPELINE_NUMBER: 'pipeline_number',
  PIPELINE_DURATION: 'pipeline_duration',
  BRANCH: 'branch',
  EVENT: 'event',
});

export const SERVER_FEATURES = Object.freeze({
  REACHABLE: 'reachable',
  PENDING: 'pending',
  RUNNING: 'running',
  IDLE_AGENTS: 'idle_agents',
  FAILING_REPOS: 'failing_repos',
});

// Statuses of a repository (src/texts.js gives their words).
export const STATUSES = Object.freeze({
  ...RESULTS,
  ...ACTIVE,
  NEVER: 'never',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in
// Gladys. The repository and server features are on different devices: the
// same key may name both.
export const NAMES = {
  en: {
    repo: {
      [REPO_FEATURES.STATUS]: 'Status',
      [REPO_FEATURES.PASSING]: 'Last pipeline passed',
      [REPO_FEATURES.RUNNING]: 'Pipeline running',
      [REPO_FEATURES.PIPELINE_NUMBER]: 'Last pipeline number',
      [REPO_FEATURES.PIPELINE_DURATION]: 'Last pipeline duration',
      [REPO_FEATURES.BRANCH]: 'Branch',
      [REPO_FEATURES.EVENT]: 'Event',
    },
    server: {
      [SERVER_FEATURES.REACHABLE]: 'Reachable',
      [SERVER_FEATURES.PENDING]: 'Pending workflows',
      [SERVER_FEATURES.RUNNING]: 'Running workflows',
      [SERVER_FEATURES.IDLE_AGENTS]: 'Idle agents',
      [SERVER_FEATURES.FAILING_REPOS]: 'Failing repositories',
    },
  },
  fr: {
    repo: {
      [REPO_FEATURES.STATUS]: 'État',
      [REPO_FEATURES.PASSING]: 'Dernier pipeline réussi',
      [REPO_FEATURES.RUNNING]: 'Pipeline en cours',
      [REPO_FEATURES.PIPELINE_NUMBER]: 'Numéro du dernier pipeline',
      [REPO_FEATURES.PIPELINE_DURATION]: 'Durée du dernier pipeline',
      [REPO_FEATURES.BRANCH]: 'Branche',
      [REPO_FEATURES.EVENT]: 'Événement',
    },
    server: {
      [SERVER_FEATURES.REACHABLE]: 'Joignable',
      [SERVER_FEATURES.PENDING]: 'Workflows en attente',
      [SERVER_FEATURES.RUNNING]: 'Workflows en cours',
      [SERVER_FEATURES.IDLE_AGENTS]: 'Agents libres',
      [SERVER_FEATURES.FAILING_REPOS]: 'Dépôts en échec',
    },
  },
  de: {
    repo: {
      [REPO_FEATURES.STATUS]: 'Status',
      [REPO_FEATURES.PASSING]: 'Letzte Pipeline erfolgreich',
      [REPO_FEATURES.RUNNING]: 'Pipeline läuft',
      [REPO_FEATURES.PIPELINE_NUMBER]: 'Nummer der letzten Pipeline',
      [REPO_FEATURES.PIPELINE_DURATION]: 'Dauer der letzten Pipeline',
      [REPO_FEATURES.BRANCH]: 'Branch',
      [REPO_FEATURES.EVENT]: 'Ereignis',
    },
    server: {
      [SERVER_FEATURES.REACHABLE]: 'Erreichbar',
      [SERVER_FEATURES.PENDING]: 'Wartende Workflows',
      [SERVER_FEATURES.RUNNING]: 'Laufende Workflows',
      [SERVER_FEATURES.IDLE_AGENTS]: 'Freie Agenten',
      [SERVER_FEATURES.FAILING_REPOS]: 'Fehlgeschlagene Repositorys',
    },
  },
  es: {
    repo: {
      [REPO_FEATURES.STATUS]: 'Estado',
      [REPO_FEATURES.PASSING]: 'Último pipeline correcto',
      [REPO_FEATURES.RUNNING]: 'Pipeline en curso',
      [REPO_FEATURES.PIPELINE_NUMBER]: 'Número del último pipeline',
      [REPO_FEATURES.PIPELINE_DURATION]: 'Duración del último pipeline',
      [REPO_FEATURES.BRANCH]: 'Rama',
      [REPO_FEATURES.EVENT]: 'Evento',
    },
    server: {
      [SERVER_FEATURES.REACHABLE]: 'Accesible',
      [SERVER_FEATURES.PENDING]: 'Workflows en espera',
      [SERVER_FEATURES.RUNNING]: 'Workflows en curso',
      [SERVER_FEATURES.IDLE_AGENTS]: 'Agentes libres',
      [SERVER_FEATURES.FAILING_REPOS]: 'Repositorios fallidos',
    },
  },
};

export const MODEL = 'Woodpecker CI';
// Display bounds (the core never applies them on write).
export const MAX_COUNT = 1_000_000;
export const MAX_DURATION_S = 7 * 24 * 3600;

export const repoIds = (gladys, id) => gladys.externalIds(REPO_TYPE, String(id));
export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);

/** The Woodpecker id of a repository device external id, null when it is not one of ours. */
export function parseRepoId(gladys, externalId) {
  const prefix = repoIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = Number(externalId.slice(prefix.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The link to a pipeline in the Woodpecker interface. */
export const pipelineUrl = (base, repo, number) =>
  number ? `${base}/repos/${repo.id}/pipeline/${number}` : `${base}/repos/${repo.id}`;

/** The last pipeline, finished or not, and the last finished one. */
export function pipelinesOf(repo) {
  const last = repo.pipelines[0] ?? null;
  const finished = repo.pipelines.find((pipeline) => !isActive(pipeline.status)) ?? null;
  return { last, finished };
}

/** The newest pipeline that decided whether the repository passes. */
export const decisiveOf = (repo) =>
  repo.pipelines.find((pipeline) => isDecisive(pipeline.status)) ?? null;

/** What a repository is now: its last pipeline, finished or not. */
export function statusOf(repo) {
  const { last } = pipelinesOf(repo);
  return last ? last.status : STATUSES.NEVER;
}

/** Failing: its last decisive pipeline failed or could not run. */
export const isFailing = (repo) => isBroken(decisiveOf(repo)?.status);
/** A pipeline of the repository runs or waits for an agent. */
export const isRunning = (repo) =>
  repo.pipelines.some(
    (pipeline) => pipeline.status === ACTIVE.RUNNING || pipeline.status === ACTIVE.PENDING,
  );

export const eventText = (event, language) =>
  EVENT_TEXT[event] ? pick(EVENT_TEXT[event], language) : event;

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const counter = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max: MAX_COUNT },
  );

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    min: 0,
    max: 0,
  });

/**
 * The discovery payload of a repository.
 * @param {object} repo normalized (src/woodpecker/client.js)
 */
export function buildRepoDevice(gladys, repo, base, language = 'en') {
  const ids = repoIds(gladys, repo.id);
  const names = (NAMES[language] ?? NAMES.en).repo;
  const feature = (key) => ids.feature(key);
  return {
    name: repo.fullName,
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [
      { name: 'REPOSITORY', value: repo.fullName },
      { name: 'URL', value: pipelineUrl(base, repo) },
    ],
    features: [
      text(names[REPO_FEATURES.STATUS], feature(REPO_FEATURES.STATUS)),
      binary(names[REPO_FEATURES.PASSING], feature(REPO_FEATURES.PASSING)),
      binary(names[REPO_FEATURES.RUNNING], feature(REPO_FEATURES.RUNNING)),
      counter(names[REPO_FEATURES.PIPELINE_NUMBER], feature(REPO_FEATURES.PIPELINE_NUMBER)),
      sensor(
        names[REPO_FEATURES.PIPELINE_DURATION],
        feature(REPO_FEATURES.PIPELINE_DURATION),
        DEVICE_FEATURE_CATEGORIES.DURATION,
        DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        { keep_history: true, min: 0, max: MAX_DURATION_S, unit: DEVICE_FEATURE_UNITS.SECONDS },
      ),
      text(names[REPO_FEATURES.BRANCH], feature(REPO_FEATURES.BRANCH)),
      text(names[REPO_FEATURES.EVENT], feature(REPO_FEATURES.EVENT)),
    ],
  };
}

/** The discovery payload of the server. */
export function buildServerDevice(gladys, { url, version }, language = 'en') {
  const ids = serverIds(gladys);
  const names = (NAMES[language] ?? NAMES.en).server;
  const params = [{ name: 'URL', value: url }];
  if (version) {
    params.push({ name: 'VERSION', value: version });
  }
  return {
    name: 'Woodpecker CI',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features: [
      binary(names[SERVER_FEATURES.REACHABLE], ids.feature(SERVER_FEATURES.REACHABLE)),
      ...[
        SERVER_FEATURES.PENDING,
        SERVER_FEATURES.RUNNING,
        SERVER_FEATURES.IDLE_AGENTS,
        SERVER_FEATURES.FAILING_REPOS,
      ].map((key) => counter(names[key], ids.feature(key))),
    ],
  };
}

/** The values of the features of a repository: `{ device_feature_external_id, state|text }`. */
export function repoValues(gladys, repo, language) {
  const ids = repoIds(gladys, repo.id);
  const { last, finished } = pipelinesOf(repo);
  const decisive = decisiveOf(repo);
  const values = [
    { key: REPO_FEATURES.STATUS, text: pick(STATUS_TEXT[statusOf(repo)], language) },
    { key: REPO_FEATURES.RUNNING, state: isRunning(repo) ? 1 : 0 },
  ];
  if (decisive) {
    values.push({
      key: REPO_FEATURES.PASSING,
      state: decisive.status === RESULTS.SUCCESS ? 1 : 0,
    });
  }
  if (last) {
    values.push({ key: REPO_FEATURES.PIPELINE_NUMBER, state: Math.min(last.number, MAX_COUNT) });
    // A text is never empty: Gladys ignores an empty one.
    if (last.branch) {
      values.push({ key: REPO_FEATURES.BRANCH, text: last.branch });
    }
    if (last.event) {
      values.push({ key: REPO_FEATURES.EVENT, text: eventText(last.event, language) });
    }
  }
  if (finished?.duration != null) {
    values.push({
      key: REPO_FEATURES.PIPELINE_DURATION,
      state: Math.min(finished.duration, MAX_DURATION_S),
    });
  }
  return values.map(({ key, ...value }) => ({
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

/** The values of the server features; unknown figures (null) are left out. */
export function serverValues(gladys, summary) {
  const ids = serverIds(gladys);
  const cap = (value) => Math.min(value, MAX_COUNT);
  return [
    [SERVER_FEATURES.REACHABLE, summary.reachable ? 1 : 0],
    [SERVER_FEATURES.PENDING, summary.pending],
    [SERVER_FEATURES.RUNNING, summary.running],
    [SERVER_FEATURES.IDLE_AGENTS, summary.idleAgents],
    [SERVER_FEATURES.FAILING_REPOS, summary.failingRepos],
  ]
    .filter(([, value]) => Number.isInteger(value))
    .map(([key, value]) => ({ device_feature_external_id: ids.feature(key), state: cap(value) }));
}
