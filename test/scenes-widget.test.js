import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { MAX_ROWS } from '../src/widgets.js';
import { CONFIG, createDevices, createWorld, idsOf, sampleWoodpecker } from './helpers/world.js';

const RESTART = { ...CONFIG, allow_restart: true };

const widget = async (world, settings = {}, language = 'en') => {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  return ack.data.content;
};

test('the widget: failing first, then running, the queue, Refresh', async (t) => {
  const woodpecker = sampleWoodpecker();
  woodpecker.start(1);
  woodpecker.start(2, { status: 'pending' });
  const world = await createWorld({ woodpecker });
  t.after(() => world.app.stop());
  const content = await widget(world, {}, 'fr');
  const [note, list, button] = content.components;
  assert.equal(note.text, 'En attente : 1 · En cours : 1 · Agents libres : 1');
  assert.deepEqual(
    list.items.map((item) => [item.label, item.value, item.icon]),
    [
      ['team/api', 'En échec · #1 · main', 'x-circle'],
      ['alice/scripts', 'En attente · #3 · main', 'clock'],
      ['alice/website', 'En cours · #2 · main', 'clock'],
    ],
  );
  assert.equal(button.action.key, 'refresh');
  assert.equal(content.ttl_seconds, 60, 'a pipeline runs: sooner');

  // A failing repository whose new pipeline runs stays red, at the top.
  world.woodpecker.start(3);
  await world.hub.pollNow();
  const again = (await widget(world)).components.find((c) => c.type === 'status');
  assert.deepEqual(
    [again.items[0].label, again.items[0].value, again.items[0].color],
    ['team/api', 'Running · #2 · main', 'danger'],
  );

  const ack = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {});
  assert.equal(ack.success, true, ack.error);
});

test('the widget: the names given in Gladys, the chosen repositories, hidden parts', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const id = idsOf(world, 3).device;
  world.gladys.devices.find((device) => device.external_id === id).name = 'API CI';
  const chosen = await widget(world, { repos: [id], hide_queue: true, hide_refresh: true });
  assert.deepEqual(
    chosen.components.map((c) => c.type),
    ['status'],
  );
  assert.deepEqual(
    chosen.components[0].items.map((item) => item.label),
    ['API CI'],
  );
});

test('the widget says why it is empty, and when Woodpecker is down', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.woodpecker.down = true;
  await world.hub.pollNow();
  const down = await widget(world);
  assert.equal(down.components[0].text, 'Woodpecker does not answer');

  const empty = await createWorld({ config: { ...CONFIG, repos: 'nobody/nothing' } });
  t.after(() => empty.app.stop());
  assert.match((await widget(empty)).components[0].text, /No active repository/);

  const unset = await createWorld({ config: { ...CONFIG, url: '' } });
  t.after(() => unset.app.stop());
  assert.match((await widget(unset)).components[0].text, /Enter the address/);
});

test('many repositories: the widget keeps ten rows', async (t) => {
  const woodpecker = sampleWoodpecker();
  for (let i = 0; i < 15; i += 1) {
    woodpecker.addRepo(10 + i, `bob/repo-${String(i).padStart(2, '0')}`);
  }
  const world = await createWorld({ woodpecker });
  t.after(() => world.app.stop());
  const list = (await widget(world)).components.find((c) => c.type === 'status');
  assert.equal(list.items.length, MAX_ROWS);
  assert.equal(list.items.at(-1).value, '+9');
});

test('"Read a Woodpecker repository" gives its state', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, language: 'de' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_repo', { repo: idsOf(world, 3).device });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    repo_name: 'team/api',
    status: 'Fehlgeschlagen',
    result: 'failure',
    passing: false,
    running: false,
    pipeline_number: 1,
    duration: 125,
    branch: 'main',
    event: 'Push',
    url: 'http://192.0.2.40:8000/repos/3/pipeline/1',
  });
  const unknown = await world.fake.sceneAction('get_repo', { repo: 'nope' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /nicht verfolgt/);
});

test('"Restart the last Woodpecker pipeline": off by default, then restarted', async (t) => {
  const off = await createWorld();
  t.after(() => off.app.stop());
  const before = off.woodpecker.requests.length;
  const refused = await off.fake.sceneAction('restart_pipeline', { repo: idsOf(off, 3).device });
  assert.equal(refused.success, false);
  assert.match(refused.error, /Restarting is off/);
  assert.equal(off.woodpecker.requests.length, before, 'nothing asked to Woodpecker');

  const world = await createWorld({ config: RESTART });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('restart_pipeline', { repo: idsOf(world, 3).device });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    repo_name: 'team/api',
    restarted_number: 1,
    number: 2,
    url: 'http://192.0.2.40:8000/repos/3/pipeline/2',
  });
  const post = world.woodpecker.requests.find((request) => request.method === 'POST');
  assert.equal(post.url, 'http://192.0.2.40:8000/api/repos/3/pipelines/1');
  // The default branch only: the pull request of alice/scripts is not restarted.
  await world.fake.sceneAction('restart_pipeline', { repo: idsOf(world, 2).device });
  const second = world.woodpecker.requests.filter((request) => request.method === 'POST')[1];
  assert.equal(second.url, 'http://192.0.2.40:8000/api/repos/2/pipelines/1');
});

test('"Restart" says why it cannot: no pipeline, not followed, no permission', async (t) => {
  const woodpecker = sampleWoodpecker().addRepo(5, 'alice/new');
  const world = await createWorld({ woodpecker, config: { ...RESTART, language: 'es' } });
  t.after(() => world.app.stop());
  const none = await world.fake.sceneAction('restart_pipeline', { repo: idsOf(world, 5).device });
  assert.match(none.error, /ningún pipeline/);
  const other = await world.fake.sceneAction('restart_pipeline', { repo: idsOf(world, 99).device });
  assert.match(other.error, /no se sigue/);
  const handle = world.woodpecker.request;
  world.hub.client.request = async (url, options) =>
    options.method === 'POST' ? { status: 403, body: 'Forbidden' } : handle(url, options);
  const forbidden = await world.fake.sceneAction('restart_pipeline', {
    repo: idsOf(world, 1).device,
  });
  assert.match(forbidden.error, /alice\/website: .*permiso push/);
});
