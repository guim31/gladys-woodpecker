// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, pipeline statuses and events, the "Test the
// connection" report, scene summaries. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table.
// -----------------------------------------------------------------------------

import { ACTIVE, ERROR_KINDS, RESULTS } from './woodpecker/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Woodpecker server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Woodpecker dans la configuration.",
    de: 'Gib die Adresse deines Woodpecker-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Woodpecker en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:8000',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:8000',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:8000',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:8000',
  },
  noToken: {
    en: 'Enter a personal access token in the configuration (your avatar → Personal access token).',
    fr: "Saisissez un jeton d'accès personnel dans la configuration (votre avatar → Jeton d'accès personnel).",
    de: 'Gib ein persönliches Zugriffstoken in der Konfiguration ein (dein Avatar → Persönliches Zugriffstoken).',
    es: 'Introduzca un token de acceso personal en la configuración (su avatar → Token de acceso personal).',
  },
};

// One short explanation per error kind (src/woodpecker/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Woodpecker does not answer',
    fr: 'Woodpecker ne répond pas',
    de: 'Woodpecker antwortet nicht',
    es: 'Woodpecker no responde',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'Woodpecker did not answer in time',
    fr: "Woodpecker n'a pas répondu à temps",
    de: 'Woodpecker hat nicht rechtzeitig geantwortet',
    es: 'Woodpecker no ha respondido a tiempo',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'token refused: create a new one (your avatar → Personal access token)',
    fr: "jeton refusé : créez-en un nouveau (votre avatar → Jeton d'accès personnel)",
    de: 'Token abgelehnt: Erstelle ein neues (dein Avatar → Persönliches Zugriffstoken)',
    es: 'token rechazado: cree uno nuevo (su avatar → Token de acceso personal)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'access denied by Woodpecker',
    fr: 'accès refusé par Woodpecker',
    de: 'Zugriff von Woodpecker verweigert',
    es: 'acceso denegado por Woodpecker',
  },
  [ERROR_KINDS.NOT_WOODPECKER]: {
    en: 'no Woodpecker API at this address',
    fr: 'aucune API Woodpecker à cette adresse',
    de: 'keine Woodpecker-API unter dieser Adresse',
    es: 'no hay ninguna API de Woodpecker en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'not found: repository deactivated or pipeline deleted in Woodpecker',
    fr: 'introuvable : dépôt désactivé ou pipeline supprimé dans Woodpecker',
    de: 'nicht gefunden: Repository deaktiviert oder Pipeline in Woodpecker gelöscht',
    es: 'no encontrado: repositorio desactivado o pipeline eliminado en Woodpecker',
  },
  [ERROR_KINDS.TOO_LARGE]: {
    en: 'answer too large, see the logs',
    fr: 'réponse trop grosse, voir les logs',
    de: 'Antwort zu groß, sieh in den Protokollen nach',
    es: 'respuesta demasiado grande, consulte los registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The status of a repository (its last pipeline), in words (src/devices.js STATUSES).
export const STATUS_TEXT = {
  [RESULTS.SUCCESS]: { en: 'Success', fr: 'Réussi', de: 'Erfolgreich', es: 'Correcto' },
  [RESULTS.FAILURE]: { en: 'Failed', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallido' },
  [RESULTS.ERROR]: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  [RESULTS.KILLED]: { en: 'Cancelled', fr: 'Annulé', de: 'Abgebrochen', es: 'Cancelado' },
  [RESULTS.DECLINED]: { en: 'Declined', fr: 'Refusé', de: 'Abgelehnt', es: 'Rechazado' },
  [RESULTS.SKIPPED]: { en: 'Skipped', fr: 'Ignoré', de: 'Übersprungen', es: 'Omitido' },
  [ACTIVE.PENDING]: { en: 'Pending', fr: 'En attente', de: 'Wartend', es: 'En espera' },
  [ACTIVE.RUNNING]: { en: 'Running', fr: 'En cours', de: 'Läuft', es: 'En curso' },
  [ACTIVE.BLOCKED]: {
    en: 'Awaiting approval',
    fr: "En attente d'approbation",
    de: 'Wartet auf Freigabe',
    es: 'Pendiente de aprobación',
  },
  never: { en: 'No pipeline', fr: 'Aucun pipeline', de: 'Keine Pipeline', es: 'Ningún pipeline' },
};

// What started a pipeline, in words (Woodpecker events).
export const EVENT_TEXT = {
  push: { en: 'Push', fr: 'Push', de: 'Push', es: 'Push' },
  pull_request: {
    en: 'Pull request',
    fr: 'Pull request',
    de: 'Pull-Request',
    es: 'Pull request',
  },
  pull_request_closed: {
    en: 'Pull request closed',
    fr: 'Pull request fermée',
    de: 'Pull-Request geschlossen',
    es: 'Pull request cerrada',
  },
  pull_request_metadata: {
    en: 'Pull request updated',
    fr: 'Pull request modifiée',
    de: 'Pull-Request geändert',
    es: 'Pull request modificada',
  },
  tag: { en: 'Tag', fr: 'Tag', de: 'Tag', es: 'Etiqueta' },
  release: { en: 'Release', fr: 'Release', de: 'Release', es: 'Release' },
  deployment: { en: 'Deployment', fr: 'Déploiement', de: 'Deployment', es: 'Despliegue' },
  cron: { en: 'Scheduled', fr: 'Planifié', de: 'Geplant', es: 'Programado' },
  manual: { en: 'Manual', fr: 'Manuel', de: 'Manuell', es: 'Manual' },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    repos: (shown, total) => `${shown} repositories followed out of ${total}`,
    failing: (count) => `failing: ${count}`,
    queue: (pending, running, agents) =>
      `pending: ${pending} · running: ${running} · idle agents: ${agents}`,
    noQueue: 'Queue and agents: an admin token is needed',
    restart: (allowed) =>
      allowed
        ? 'Restarting pipelines from scenes: allowed'
        : 'Restarting pipelines from scenes: off',
    missing: (names) => `Not found in Woodpecker: ${names}`,
    tooMany: (max) => `Only the first ${max} repositories are followed.`,
  },
  fr: {
    ok: 'Connecté',
    repos: (shown, total) => `${shown} dépôts suivis sur ${total}`,
    failing: (count) => `en échec : ${count}`,
    queue: (pending, running, agents) =>
      `en attente : ${pending} · en cours : ${running} · agents libres : ${agents}`,
    noQueue: 'File et agents : un jeton administrateur est nécessaire',
    restart: (allowed) =>
      allowed
        ? 'Relance des pipelines depuis les scènes : autorisée'
        : 'Relance des pipelines depuis les scènes : désactivée',
    missing: (names) => `Introuvables dans Woodpecker : ${names}`,
    tooMany: (max) => `Seuls les ${max} premiers dépôts sont suivis.`,
  },
  de: {
    ok: 'Verbunden',
    repos: (shown, total) => `${shown} von ${total} Repositorys verfolgt`,
    failing: (count) => `fehlgeschlagen: ${count}`,
    queue: (pending, running, agents) =>
      `wartend: ${pending} · laufend: ${running} · freie Agenten: ${agents}`,
    noQueue: 'Warteschlange und Agenten: Ein Admin-Token ist nötig',
    restart: (allowed) =>
      allowed
        ? 'Pipelines aus Szenen neu starten: erlaubt'
        : 'Pipelines aus Szenen neu starten: aus',
    missing: (names) => `In Woodpecker nicht gefunden: ${names}`,
    tooMany: (max) => `Nur die ersten ${max} Repositorys werden verfolgt.`,
  },
  es: {
    ok: 'Conectado',
    repos: (shown, total) => `${shown} repositorios seguidos de ${total}`,
    failing: (count) => `fallidos: ${count}`,
    queue: (pending, running, agents) =>
      `en espera: ${pending} · en curso: ${running} · agentes libres: ${agents}`,
    noQueue: 'Cola y agentes: se necesita un token de administrador',
    restart: (allowed) =>
      allowed
        ? 'Relanzar pipelines desde las escenas: permitido'
        : 'Relanzar pipelines desde las escenas: desactivado',
    missing: (names) => `No encontrados en Woodpecker: ${names}`,
    tooMany: (max) => `Solo se siguen los ${max} primeros repositorios.`,
  },
};

// Errors and messages of the scene actions and the widget (shown in Gladys).
export const ACTION_TEXT = {
  notFollowed: {
    en: 'This repository is not followed (not active in Woodpecker, or not in the list of the configuration).',
    fr: "Ce dépôt n'est pas suivi (inactif dans Woodpecker, ou absent de la liste de la configuration).",
    de: 'Dieses Repository wird nicht verfolgt (in Woodpecker nicht aktiv oder nicht in der Liste der Konfiguration).',
    es: 'Este repositorio no se sigue (no está activo en Woodpecker, o no está en la lista de la configuración).',
  },
  restartDisabled: {
    en: 'Restarting is off: turn on "Allow scenes to restart pipelines" in the configuration.',
    fr: 'La relance est désactivée : activez « Autoriser les scènes à relancer des pipelines » dans la configuration.',
    de: 'Neustarten ist aus: Aktiviere „Szenen dürfen Pipelines neu starten“ in der Konfiguration.',
    es: 'El relanzamiento está desactivado: active «Permitir que las escenas relancen pipelines» en la configuración.',
  },
  noPipeline: {
    en: 'This repository has no pipeline to restart yet.',
    fr: "Ce dépôt n'a encore aucun pipeline à relancer.",
    de: 'Dieses Repository hat noch keine Pipeline zum Neustarten.',
    es: 'Este repositorio aún no tiene ningún pipeline que relanzar.',
  },
  restartForbidden: {
    en: 'Woodpecker refused: the token needs the push permission on this repository.',
    fr: 'Woodpecker a refusé : le jeton doit avoir le droit push sur ce dépôt.',
    de: 'Woodpecker hat abgelehnt: Das Token braucht das Recht push auf diesem Repository.',
    es: 'Woodpecker lo ha rechazado: el token necesita el permiso push en este repositorio.',
  },
  refreshed: {
    en: 'Pipelines read again.',
    fr: 'Pipelines relus.',
    de: 'Pipelines neu gelesen.',
    es: 'Pipelines leídos de nuevo.',
  },
};

// The `summary` variable of the scene events: ready for a message.
export const SUMMARY_TEXT = {
  en: {
    finished: (repo, number, status) => `${repo} #${number}: ${status}`,
    failure: (repo, number) => `${repo} is failing (pipeline #${number})`,
    success: (repo, number) => `${repo} is back to green (pipeline #${number})`,
  },
  fr: {
    finished: (repo, number, status) => `${repo} #${number} : ${status}`,
    failure: (repo, number) => `${repo} est en échec (pipeline #${number})`,
    success: (repo, number) => `${repo} est revenu au vert (pipeline #${number})`,
  },
  de: {
    finished: (repo, number, status) => `${repo} #${number}: ${status}`,
    failure: (repo, number) => `${repo} schlägt fehl (Pipeline #${number})`,
    success: (repo, number) => `${repo} ist wieder grün (Pipeline #${number})`,
  },
  es: {
    finished: (repo, number, status) => `${repo} #${number}: ${status}`,
    failure: (repo, number) => `${repo} está fallando (pipeline #${number})`,
    success: (repo, number) => `${repo} vuelve a estar en verde (pipeline #${number})`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
