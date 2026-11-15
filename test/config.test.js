import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  isFollowed,
  normalizeConfig,
  parseRepos,
  parseServerUrl,
} from '../src/config.js';

test('the Woodpecker address: host:port, copied URL, sub-path', () => {
  assert.equal(parseServerUrl('192.168.1.2:8000'), 'http://192.168.1.2:8000');
  assert.equal(parseServerUrl('ci.example.com'), 'https://ci.example.com');
  assert.equal(
    parseServerUrl('http://192.168.1.2:8000/repos/3/pipeline/12'),
    'http://192.168.1.2:8000',
  );
  assert.equal(
    parseServerUrl('https://example.com/woodpecker/repos'),
    'https://example.com/woodpecker',
  );
  assert.equal(parseServerUrl('https://example.com/ci/'), 'https://example.com/ci');
  assert.equal(parseServerUrl('http://user:secret@192.168.1.2:8000'), null);
  assert.equal(parseServerUrl('ftp://192.168.1.2'), null);
  assert.equal(parseServerUrl('  '), null);
});

test('the repositories: owner/name, owners, links; case and duplicates ignored', () => {
  assert.deepEqual(
    parseRepos('Alice/Website, team;https://codeberg.org/bob/tools.git\nalice/website bob/x/'),
    ['alice/website', 'team', 'bob/tools', 'bob/x'],
  );
  assert.deepEqual(parseRepos(''), []);
  assert.ok(isFollowed('Team/API', ['team']));
  assert.ok(isFollowed('alice/Website', ['alice/website']));
  assert.ok(isFollowed('anything/here', []));
  assert.ok(!isFollowed('teams/api', ['team']));
  assert.ok(!isFollowed('alice/website-old', ['alice/website']));
});

test('normalized defaults', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config, {
    url: null,
    urlTyped: false,
    token: '',
    repos: [],
    scope: 'default_branch',
    allowRestart: false,
    pollIntervalMs: 60_000,
    language: 'fr',
  });
  assert.equal(DEFAULT_CONFIG.allow_restart, false);
  assert.equal(normalizeConfig({ allow_restart: true }).allowRestart, true);
  assert.equal(normalizeConfig({ allow_restart: 'true' }).allowRestart, true);
  assert.equal(normalizeConfig({ scope: 'all' }).scope, 'all');
  assert.equal(normalizeConfig({ scope: 'tags' }).scope, 'default_branch');
  assert.equal(normalizeConfig({ poll_interval: '5' }).pollIntervalMs, 300_000);
  assert.equal(normalizeConfig({ token: ' abc \n' }).token, 'abc');
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});
