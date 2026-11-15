// The Woodpecker client against the answers recorded on a real Woodpecker
// 3.20.1 with a Forgejo forge (test/fixtures/woodpecker), and against the
// failures it can meet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ERROR_KINDS, WoodpeckerClient, normalizePipeline } from '../src/woodpecker/client.js';
import { BASE, TOKEN } from './helpers/fakeWoodpecker.js';

const fixture = async (name) =>
  readFile(new URL(`./fixtures/woodpecker/${name}.json`, import.meta.url), 'utf8');

function recorded(answers) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, ...options });
    const { pathname } = new URL(url);
    const answer = answers[pathname] ?? { status: 404, body: '404 page not found' };
    return { ...answer, body: answer.fixture ? await fixture(answer.fixture) : answer.body };
  };
  return { calls, request };
}

const client = (request, extra = {}) =>
  new WoodpeckerClient({ url: BASE, token: TOKEN, request, ...extra });

test('repositories, pipelines, queue and version from the recorded answers', async () => {
  const { calls, request } = recorded({
    '/api/version': { status: 200, fixture: 'version' },
    '/api/user/repos': { status: 200, fixture: 'repos' },
    '/api/queue/info': { status: 200, fixture: 'queue-idle' },
    '/api/repos/1/pipelines': { status: 200, fixture: 'pipelines-green' },
    '/api/repos/2/pipelines': { status: 200, fixture: 'pipelines-red' },
  });
  const woodpecker = client(request);
  assert.equal(await woodpecker.version(), '3.20.1');
  const repos = await woodpecker.repos();
  assert.deepEqual(
    repos.map((repo) => [repo.id, repo.fullName, repo.defaultBranch, repo.last?.number]),
    [
      [1, 'alice/green-repo', 'main', 3],
      [2, 'alice/red-repo', 'main', 3],
    ],
  );
  const green = await woodpecker.pipelines(1);
  assert.deepEqual(
    green.map((pipeline) => [pipeline.number, pipeline.event, pipeline.status]),
    [
      [3, 'push', 'success'],
      [2, 'push', 'failure'],
      [1, 'manual', 'error'],
    ],
  );
  assert.equal(green[0].branch, 'main');
  assert.equal(green[0].message, 'Update the pipeline');
  assert.ok(green[0].duration >= 8, 'the step sleeps 8 seconds');
  const red = await woodpecker.pipelines(2);
  assert.ok(red.every((pipeline) => pipeline.status === 'failure'));
  assert.deepEqual(await woodpecker.queue(), {
    pending: 0,
    running: 0,
    idleAgents: 1,
    paused: false,
  });
  assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.match(calls.at(-2).url, /\/api\/repos\/2\/pipelines\?page=1&perPage=10$/);
});

test('a pipeline running: no end, no duration; a busy agent is not idle', async () => {
  const { request } = recorded({
    '/api/user/repos': { status: 200, fixture: 'repos-running' },
    '/api/repos/1/pipelines': { status: 200, fixture: 'pipelines-green-running' },
    '/api/queue/info': { status: 200, fixture: 'queue-running' },
  });
  const woodpecker = client(request);
  const [repo] = await woodpecker.repos();
  assert.equal(repo.last.status, 'running');
  const [running] = await woodpecker.pipelines(1);
  assert.equal(running.status, 'running');
  assert.equal(running.finished, null);
  assert.equal(running.duration, null);
  assert.deepEqual(await woodpecker.queue(), {
    pending: 1,
    running: 1,
    idleAgents: 0,
    paused: false,
  });
});

test('the recorded restart: a new pipeline, pending', async () => {
  const { calls, request } = recorded({
    '/api/repos/2/pipelines/1': { status: 200, fixture: 'restart' },
  });
  const pipeline = await client(request).restart(2, 1);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual([pipeline.number, pipeline.status], [2, 'pending']);
});

test('statuses: created is pending, unknown ones are dropped', () => {
  assert.equal(normalizePipeline({ number: 1, status: 'created' }).status, 'pending');
  assert.equal(normalizePipeline({ number: 1, status: 'blocked' }).status, 'blocked');
  assert.equal(normalizePipeline({ number: 1, status: 'weird' }), null);
  assert.equal(normalizePipeline({ status: 'success' }), null);
  const finished = normalizePipeline({ number: 2, status: 'success', started: 100, finished: 130 });
  assert.equal(finished.duration, 30);
});

test('every HTTP and network failure has its kind', async () => {
  const cases = [
    [{ status: 401, body: 'User not authorized' }, ERROR_KINDS.AUTH],
    [{ status: 403, body: 'Forbidden' }, ERROR_KINDS.FORBIDDEN],
    [{ status: 301, body: '' }, ERROR_KINDS.REDIRECT],
    [{ status: 404, body: '' }, ERROR_KINDS.NOT_WOODPECKER],
    [{ status: 500, body: '' }, ERROR_KINDS.HTTP],
    [{ status: 200, body: '<html>a login page</html>' }, ERROR_KINDS.NOT_WOODPECKER],
    [{ status: 200, body: '{"repos": []}' }, ERROR_KINDS.NOT_WOODPECKER],
  ];
  for (const [answer, kind] of cases) {
    const woodpecker = client(async () => answer);
    await assert.rejects(woodpecker.repos(), (err) => err.kind === kind, `${answer.status}`);
  }
  const failing = (error) => client(async () => Promise.reject(error));
  const refused = Object.assign(new TypeError('fetch failed'), {
    cause: { code: 'ECONNREFUSED' },
  });
  await assert.rejects(failing(refused).repos(), { kind: ERROR_KINDS.UNREACHABLE });
  const tls = Object.assign(new TypeError('fetch failed'), {
    cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
  });
  await assert.rejects(failing(tls).repos(), { kind: ERROR_KINDS.TLS });
  const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  await assert.rejects(failing(timeout).repos(), { kind: ERROR_KINDS.TIMEOUT });
  // A pipeline list or a restart that is not there: the repository is gone.
  await assert.rejects(client(async () => ({ status: 404, body: 'null' })).pipelines(9), {
    kind: ERROR_KINDS.NOT_FOUND,
  });
  await assert.rejects(client(async () => ({ status: 404, body: 'null' })).restart(2, 99), {
    kind: ERROR_KINDS.NOT_FOUND,
  });
});

test('an inactive repository is left out', async () => {
  const body = JSON.stringify([
    { id: 1, full_name: 'a/b', active: true },
    { id: 2, full_name: 'a/c', active: false },
    { id: 3 },
  ]);
  const repos = await client(async () => ({ status: 200, body })).repos();
  assert.deepEqual(
    repos.map((repo) => repo.fullName),
    ['a/b'],
  );
});
