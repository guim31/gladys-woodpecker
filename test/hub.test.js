import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS, WIDGET_KEY, transportOf } from '../src/hub.js';
import { serverIds } from '../src/devices.js';
import {
  CONFIG,
  TOKEN,
  createClock,
  createDevices,
  createWorld,
  idsOf,
  sampleWoodpecker,
} from './helpers/world.js';

const WEBSITE = 1;
const SCRIPTS = 2;
const API = 3;

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const state = (world, repo, feature) => world.fake.lastState(idsOf(world, repo).feature(feature));
const server = (world, feature) => world.fake.lastState(serverIds(world.gladys).feature(feature));
const pipelineReads = (world) =>
  world.woodpecker.requests.filter((request) => /\/pipelines\?/.test(request.url)).length;

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('the server and one device per active repository, nothing polled, no event at first', async (t) => {
  const woodpecker = sampleWoodpecker();
  woodpecker.addRepo(4, 'alice/archived', { active: false });
  const world = await createWorld({ woodpecker });
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Woodpecker CI', 'alice/website', 'alice/scripts', 'team/api'],
  );
  assert.ok(devices.every((device) => device.should_poll === false));
  assert.equal(devices[1].external_id, idsOf(world, WEBSITE).device);
  assert.match(devices[1].external_id, /:repo:1$/);
  assert.deepEqual(devices[0].params, [
    { name: 'URL', value: 'http://192.0.2.40:8000' },
    { name: 'VERSION', value: '3.20.1' },
  ]);
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states: status, passing, running, number, duration, branch, event; server figures', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(state(world, WEBSITE, 'status'), 'Success');
  assert.equal(state(world, WEBSITE, 'passing'), 1);
  assert.equal(state(world, WEBSITE, 'running'), 0);
  assert.equal(state(world, WEBSITE, 'pipeline_number'), 1);
  assert.equal(state(world, WEBSITE, 'pipeline_duration'), 42);
  assert.equal(state(world, WEBSITE, 'branch'), 'main');
  assert.equal(state(world, WEBSITE, 'event'), 'Push');
  assert.equal(state(world, API, 'status'), 'Failed');
  assert.equal(state(world, API, 'passing'), 0);
  assert.equal(state(world, API, 'pipeline_duration'), 125);
  assert.equal(server(world, 'reachable'), 1);
  assert.equal(server(world, 'pending'), 0);
  assert.equal(server(world, 'running'), 0);
  assert.equal(server(world, 'idle_agents'), 1);
  assert.equal(server(world, 'failing_repos'), 1);

  // A pipeline runs: the result of the last finished one stays.
  world.woodpecker.start(WEBSITE, { event: 'manual' });
  await world.hub.pollNow();
  assert.equal(state(world, WEBSITE, 'status'), 'Running');
  assert.equal(state(world, WEBSITE, 'running'), 1);
  assert.equal(state(world, WEBSITE, 'passing'), 1);
  assert.equal(state(world, WEBSITE, 'pipeline_number'), 2);
  assert.equal(state(world, WEBSITE, 'event'), 'Manual');
  assert.equal(server(world, 'running'), 1);

  world.woodpecker.finish(WEBSITE, 'error', { duration: 3 });
  await world.hub.pollNow();
  assert.equal(state(world, WEBSITE, 'status'), 'Error');
  assert.equal(state(world, WEBSITE, 'passing'), 0);
  assert.equal(state(world, WEBSITE, 'pipeline_duration'), 3);
  assert.equal(server(world, 'failing_repos'), 2);
});

test('the default branch decides: a failing pull request does not turn a repository red', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  // alice/scripts: #1 push on main succeeded, #2 pull request failed.
  assert.equal(state(world, SCRIPTS, 'status'), 'Success');
  assert.equal(state(world, SCRIPTS, 'passing'), 1);
  assert.equal(state(world, SCRIPTS, 'pipeline_number'), 1);
  world.woodpecker.finish(SCRIPTS, 'failure', { branch: 'feature', event: 'push' });
  await world.hub.pollNow();
  assert.deepEqual(world.fake.sceneEvents, []);

  // Every pipeline counts: the latest one is the pull request… then a push on a branch.
  const all = await createWorld({
    woodpecker: sampleWoodpecker(),
    config: { ...CONFIG, scope: 'all' },
  });
  t.after(() => all.app.stop());
  await createDevices(all);
  assert.equal(state(all, SCRIPTS, 'status'), 'Failed');
  assert.equal(state(all, SCRIPTS, 'branch'), 'feature');
  assert.equal(state(all, SCRIPTS, 'event'), 'Pull request');
});

test('a repository without any pipeline says so, and publishes no number', async (t) => {
  const woodpecker = sampleWoodpecker().addRepo(5, 'alice/new');
  const world = await createWorld({ woodpecker });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(state(world, 5, 'status'), 'No pipeline');
  assert.equal(state(world, 5, 'running'), 0);
  assert.equal(state(world, 5, 'pipeline_number'), undefined);
  assert.equal(state(world, 5, 'passing'), undefined);
});

test('every finished pipeline fires "pipeline finished", once, with its result', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.woodpecker.start(WEBSITE);
  await world.hub.pollNow();
  assert.deepEqual(world.fake.sceneEvents, [], 'nothing while it runs');
  world.woodpecker.finish(WEBSITE, 'killed', { duration: 9 });
  await world.hub.pollNow();
  await world.hub.pollNow();
  const [finished] = events(world, TRIGGERS.FINISHED);
  assert.equal(events(world, TRIGGERS.FINISHED).length, 1);
  assert.deepEqual(finished.data, {
    repo: idsOf(world, WEBSITE).device,
    repo_name: 'alice/website',
    number: 2,
    result: 'killed',
    status: 'Cancelled',
    branch: 'main',
    event: 'Push',
    duration: 9,
    url: 'http://192.0.2.40:8000/repos/1/pipeline/2',
    summary: 'alice/website #2: Cancelled',
  });
  // Cancelled is not a failure: the repository did not change.
  assert.deepEqual(events(world, TRIGGERS.STATUS), []);
});

test('pipelines that finish out of order, and a burst: three events at most, oldest first', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const first = world.woodpecker.start(WEBSITE);
  const second = world.woodpecker.start(WEBSITE);
  world.woodpecker.finish(WEBSITE, 'success', { number: second });
  await world.hub.pollNow();
  world.woodpecker.finish(WEBSITE, 'failure', { number: first });
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FINISHED).map((event) => [event.data.number, event.data.result]),
    [
      [second, 'success'],
      [first, 'failure'],
    ],
  );
  // The older failure ends after a newer success: the repository still passes.
  assert.deepEqual(events(world, TRIGGERS.STATUS), []);

  for (let i = 0; i < 5; i += 1) {
    world.woodpecker.finish(API, 'failure');
  }
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FINISHED)
      .filter((event) => event.data.repo_name === 'team/api')
      .map((event) => event.data.number),
    [4, 5, 6],
  );
});

test('failing, still failing, error, back to green: one event per change', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, language: 'fr' } });
  t.after(() => world.app.stop());
  world.woodpecker.finish(WEBSITE, 'failure');
  await world.hub.pollNow();
  world.woodpecker.finish(WEBSITE, 'error');
  await world.hub.pollNow();
  world.woodpecker.finish(WEBSITE, 'success');
  await world.hub.pollNow();
  world.woodpecker.finish(API, 'success');
  await world.hub.pollNow();
  const changes = events(world, TRIGGERS.STATUS).map((event) => [
    event.data.repo_name,
    event.data.state,
    event.data.number,
    event.data.summary,
  ]);
  assert.deepEqual(changes, [
    ['alice/website', 'failure', 2, 'alice/website est en échec (pipeline #2)'],
    ['alice/website', 'success', 4, 'alice/website est revenu au vert (pipeline #4)'],
    ['team/api', 'success', 2, 'team/api est revenu au vert (pipeline #2)'],
  ]);
});

test('a restart neither misses an event nor announces one twice', async (t) => {
  const first = await createWorld();
  first.woodpecker.finish(WEBSITE, 'failure');
  await first.hub.pollNow();
  assert.equal(events(first, TRIGGERS.FINISHED).length, 1);
  await first.app.stop();

  // Meanwhile, while the integration was stopped:
  first.woodpecker.finish(WEBSITE, 'success');
  const second = await createWorld({ woodpecker: first.woodpecker, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => [event.key, event.data.number]),
    [
      [TRIGGERS.FINISHED, 3],
      [TRIGGERS.STATUS, 3],
    ],
  );
});

test('the pipelines of a repository are read again only when they moved', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const before = pipelineReads(world);
  await world.hub.pollNow();
  assert.equal(pipelineReads(world), before, 'nothing moved: one request in all');
  world.woodpecker.start(WEBSITE);
  await world.hub.pollNow();
  assert.equal(pipelineReads(world), before + 1);
  // Still running: read at every cycle until it ends.
  await world.hub.pollNow();
  assert.equal(pipelineReads(world), before + 2);
  world.woodpecker.finish(WEBSITE, 'success');
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.equal(pipelineReads(world), before + 3);
});

test('the list of repositories: owner/name, an owner, links; missing ones reported', async (t) => {
  const world = await createWorld({
    config: {
      ...CONFIG,
      repos: 'Alice/Website, team, https://git.example.org/alice/gone.git',
    },
  });
  t.after(() => world.app.stop());
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['Woodpecker CI', 'alice/website', 'team/api'],
  );
  const ack = await world.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /2 repositories followed out of 3/);
  assert.match(ack.data.message.en, /Not found in Woodpecker: alice\/gone/);
  assert.match(ack.data.message.en, /pending: 0 · running: 0 · idle agents: 1/);
  assert.match(ack.data.message.en, /Restarting pipelines from scenes: off/);
  assert.match(ack.data.message.fr, /Connecté \(192\.0\.2\.40:8000, Woodpecker 3\.20\.1\)/);

  // A repository removed from the list is forgotten: back in it, it starts silent.
  world.woodpecker.finish(SCRIPTS, 'failure');
  await world.fake.configUpdated({ ...CONFIG, repos: 'alice/website' });
  await world.fake.configUpdated({ ...CONFIG, repos: '' });
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('a user token: no queue, no agents, the rest works', async (t) => {
  const woodpecker = sampleWoodpecker();
  woodpecker.admin = false;
  const world = await createWorld({ woodpecker });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(server(world, 'reachable'), 1);
  assert.equal(server(world, 'failing_repos'), 1);
  assert.equal(server(world, 'idle_agents'), undefined);
  const ack = await world.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /Queue and agents: an admin token is needed/);
});

test('errors: Woodpecker down, token refused — one log line each, reachable at 0', async (t) => {
  const clock = createClock();
  const world = await createWorld({ clock });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.woodpecker.down = true;
  const lines = await captureLogs(t, 'info', async () => {
    await world.hub.pollNow();
    clock.advance(60_000);
    await world.hub.pollNow();
  });
  assert.equal(lines.length, 1, 'one line for an outage, not one per read');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.connectionStatus.message.en, 'Woodpecker does not answer');
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(server(world, 'reachable'), 0);
  assert.equal(world.fake.discoveredDevices.length, 4, 'the list is kept');
  world.woodpecker.down = false;
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(server(world, 'reachable'), 1);
  // 192.0.2.x is a documentation range, not a private one: the cloud badge.
  assert.equal(world.fake.transports.at(-1).transport, 'cloud');

  await world.fake.configUpdated({ ...CONFIG, token: 'wrong' });
  assert.match(world.fake.connectionStatus.message.en, /token refused/);
});

test('the configuration is checked before anything is read', async (t) => {
  for (const [config, message] of [
    [{ url: '' }, /Enter the address of your Woodpecker server/],
    [{ url: 'ftp://nope' }, /Address not understood/],
    [{ token: '' }, /Enter a personal access token/],
  ]) {
    const world = await createWorld({ config: { ...CONFIG, ...config } });
    t.after(() => world.app.stop());
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.en, message);
    assert.equal(world.woodpecker.requests.length, 0);
  }
});

test('a normal reading cycle writes nothing at the info level, never a token', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const lines = await captureLogs(t, 'info', async () => {
    await world.hub.pollNow();
    world.woodpecker.start(WEBSITE);
    await world.hub.pollNow();
    world.woodpecker.finish(WEBSITE, 'failure');
    await world.hub.pollNow();
  });
  assert.deepEqual(lines, []);
  const debug = await captureLogs(t, 'debug', () => world.hub.pollNow());
  assert.equal(debug.join('\n').includes(TOKEN), false);
});

test('the container reads Woodpecker by itself, without onPoll', async (t) => {
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.hub.config = { ...world.hub.config, pollIntervalMs: 20 };
  world.hub.schedulePoll();
  world.woodpecker.finish(WEBSITE, 'failure');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(state(world, WEBSITE, 'status'), 'Failed');
});

test('an added device gets its states at once, and the widget a refresh', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const refreshes = world.fake.widgetRefreshes.length;
  const [, website] = world.fake.discoveredDevices;
  await world.fake.deviceCreated(website);
  assert.equal(state(world, WEBSITE, 'status'), 'Success');
  assert.ok(world.fake.widgetRefreshes.length > refreshes);
  assert.equal(world.fake.widgetRefreshes.at(-1), WIDGET_KEY);
});

test('Gladys reconnecting gets every state again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const before = world.fake.states.length;
  await world.hub.resync(world.hub.config);
  assert.ok(world.fake.states.length > before);
});

test('an event Gladys refuses (it restarts) is sent again at the next reading', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  let refuse = true;
  world.gladys.publishSceneEvent = (key, data) =>
    refuse ? Promise.reject(new Error('503')) : publish(key, data);
  world.woodpecker.finish(WEBSITE, 'failure');
  await world.hub.pollNow();
  assert.equal(world.fake.sceneEvents.length, 0);
  refuse = false;
  await world.hub.pollNow();
  assert.deepEqual(
    world.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.FINISHED, TRIGGERS.STATUS],
  );
});

test('local or cloud badge', () => {
  assert.equal(transportOf('http://192.168.1.2:8000'), 'local');
  assert.equal(transportOf('http://woodpecker:8000'), 'local');
  assert.equal(transportOf('https://ci.home.arpa'), 'local');
  assert.equal(transportOf('https://ci.woodpecker-ci.org'), 'cloud');
  assert.equal(transportOf('http://[fd00::2]:8000'), 'local');
});

test('changing the pipelines that count announces no past pipeline', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated({ ...CONFIG, scope: 'all' });
  assert.deepEqual(world.fake.sceneEvents, [], 'the failed pull request of alice/scripts is past');
  // Back to the default branch: alice/scripts was never red there.
  await world.fake.configUpdated({ ...CONFIG, scope: 'default_branch' });
  world.woodpecker.finish(SCRIPTS, 'success');
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.STATUS), []);
  assert.equal(events(world, TRIGGERS.FINISHED).length, 1);
});

test('a flow of pull requests does not hide the default branch', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  for (let i = 0; i < 12; i += 1) {
    world.woodpecker.finish(API, 'success', { branch: 'feature', event: 'pull_request' });
  }
  await world.hub.pollNow();
  assert.equal(state(world, API, 'status'), 'Failed');
  assert.equal(state(world, API, 'pipeline_number'), 1);
  assert.equal(server(world, 'failing_repos'), 1);
  assert.ok(
    world.woodpecker.requests.some((request) =>
      request.url.endsWith(
        '/api/repos/3/pipelines?page=1&perPage=10&branch=main&event=push%2Cmanual%2Ccron%2Cdeployment%2Ctag%2Crelease',
      ),
    ),
  );
});

test('pipelines unreadable at start: the repository waits, never "No pipeline"', async (t) => {
  const woodpecker = sampleWoodpecker();
  const handle = woodpecker.request;
  let broken = true;
  woodpecker.request = async (url, options) =>
    broken && url.includes('/api/repos/3/pipelines')
      ? { status: 502, body: 'Bad Gateway' }
      : handle(url, options);
  const world = await createWorld({ woodpecker });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(world.hub.repos.has(API), false, 'not shown as a repository without pipeline');
  assert.equal(world.fake.discoveredDevices.length, 3);
  broken = false;
  // The list of team/api is read again at the next cycle, without any event for the past.
  await world.hub.pollNow();
  await createDevices(world, (device) => device.external_id === idsOf(world, API).device);
  assert.equal(state(world, API, 'status'), 'Failed');
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('restart takes the newest finished pipeline; Woodpecker 2 is reported', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, allow_restart: true } });
  t.after(() => world.app.stop());
  world.woodpecker.start(WEBSITE);
  await world.hub.pollNow();
  await world.fake.sceneAction('restart_pipeline', { repo: idsOf(world, WEBSITE).device });
  const post = world.woodpecker.requests.find((request) => request.method === 'POST');
  assert.match(post.url, /\/api\/repos\/1\/pipelines\/1$/);
  world.hub.version = '2.8.3';
  world.hub.readAt = world.hub.now();
  const handle = world.woodpecker.request;
  world.hub.client.request = async (url, options) =>
    url.endsWith('/api/version')
      ? { status: 200, body: '{"version":"2.8.3"}' }
      : handle(url, options);
  world.hub.version = null;
  const ack = await world.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /Woodpecker 2\.8\.3: version 3 or later is needed/);
});
