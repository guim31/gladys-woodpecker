// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `pipelines`.
//
// The use case: from the wall tablet, see at a glance the last pipeline of
// each followed repository — failed first, then running — with its number
// and branch, and whether workflows wait for an agent. A Refresh button.
//
// Every followed repository by default, or the ones chosen in the widget
// settings (devices added to Gladys). The figures are sent as values, not
// bound to device features: the widget works before the devices are added.
// The name shown is the one given in Gladys when the device is added.
//
// Budget (8 components, 2 texts): one text when Woodpecker does not answer,
// one text for the queue (hideable), one status list, the button (hideable).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { STATUSES, isFailing, isRunning, repoIds, statusOf } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, STATUS_TEXT, pick } from './texts.js';

export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  empty: {
    en: 'No active repository in Woodpecker, or none matches the list of the configuration.',
    fr: 'Aucun dépôt actif dans Woodpecker, ou aucun ne correspond à la liste de la configuration.',
    de: 'Kein aktives Repository in Woodpecker, oder keines passt zur Liste der Konfiguration.',
    es: 'Ningún repositorio activo en Woodpecker, o ninguno coincide con la lista de la configuración.',
  },
  queue: {
    en: (pending, running, agents) =>
      `Pending: ${pending} · Running: ${running} · Idle agents: ${agents}`,
    fr: (pending, running, agents) =>
      `En attente : ${pending} · En cours : ${running} · Agents libres : ${agents}`,
    de: (pending, running, agents) =>
      `Wartend: ${pending} · Laufend: ${running} · Freie Agenten: ${agents}`,
    es: (pending, running, agents) =>
      `En espera: ${pending} · En curso: ${running} · Agentes libres: ${agents}`,
  },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
};

const ROW_STYLE = {
  [STATUSES.FAILURE]: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  [STATUSES.ERROR]: { icon: 'alert-triangle', color: WIDGET_COLORS.DANGER },
  [STATUSES.RUNNING]: { icon: 'clock', color: WIDGET_COLORS.INFO },
  [STATUSES.PENDING]: { icon: 'clock', color: WIDGET_COLORS.INFO },
  [STATUSES.BLOCKED]: { icon: 'pause-circle', color: WIDGET_COLORS.WARNING },
  [STATUSES.SUCCESS]: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
};
const NEUTRAL = { icon: 'minus-circle', color: WIDGET_COLORS.NEUTRAL };

// Row order: what needs attention first (a failing repository whose new
// pipeline runs stays at the top).
const rank = (repo) => (isFailing(repo) ? 0 : isRunning(repo) ? 1 : 2);

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The repositories the widget shows: the chosen devices, or every followed one. */
export function selectRepos(hub, settings) {
  const chosen = [settings?.repos ?? []].flat().filter((id) => typeof id === 'string' && id);
  const all = [...hub.repos.values()];
  if (chosen.length === 0) {
    return all;
  }
  const ids = new Set(chosen);
  return all.filter((repo) => ids.has(repoIds(hub.gladys, repo.id).device));
}

export function sortRepos(repos) {
  return [...repos].sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName));
}

/** The name given in Gladys, else the name of the repository. */
function nameOf(hub, repo) {
  const id = repoIds(hub.gladys, repo.id).device;
  const device = (hub.gladys.devices ?? []).find((item) => item.external_id === id);
  return device?.name || repo.fullName;
}

function rowOf(hub, repo, language) {
  const status = statusOf(repo);
  const last = repo.pipelines[0];
  const parts = [pick(STATUS_TEXT[status], language)];
  if (last) {
    parts.push(`#${last.number}`);
    if (last.branch) {
      parts.push(last.branch);
    }
  }
  // A failing repository whose new pipeline runs keeps the red mark.
  const style =
    isFailing(repo) && status !== STATUSES.FAILURE && status !== STATUSES.ERROR
      ? { icon: ROW_STYLE[status]?.icon ?? 'x-circle', color: WIDGET_COLORS.DANGER }
      : (ROW_STYLE[status] ?? NEUTRAL);
  return {
    label: fit(nameOf(hub, repo), 40),
    value: fit(parts.join(' · '), 40),
    ...style,
  };
}

async function get(hub, { settings = {}, language = 'en' }) {
  const status = hub.connectionStatus();
  if (!hub.client) {
    return message(status.message ?? CONNECTION_TEXT.noUrl, language);
  }
  const components = [];
  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }
  if (!hub.error && hub.readAt > 0 && hub.repos.size === 0) {
    return message(TEXT.empty, language);
  }
  const repos = sortRepos(selectRepos(hub, settings));
  const summary = hub.summary();
  if (settings.hide_queue !== true && summary.idleAgents !== null && !hub.error) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: pick(TEXT.queue, language)(summary.pending, summary.running, summary.idleAgents),
    });
  }
  if (repos.length > 0) {
    const shown = repos.length > MAX_ROWS ? repos.slice(0, MAX_ROWS - 1) : repos;
    const items = shown.map((repo) => rowOf(hub, repo, language));
    if (repos.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${repos.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }
  if (settings.hide_refresh !== true) {
    components.push({
      type: 'button',
      label: pick(TEXT.refresh, language),
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: ACTIONS.REFRESH },
    });
  }
  // A pipeline running moves: look again sooner.
  const moving = hub.error || repos.some(isRunning) || summary.pending;
  return { ttl_seconds: moving ? 60 : 300, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  return { message: hub.error ? ERROR_TEXT[hub.error.kind] : ACTION_TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
