// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of Woodpecker 3.20.1 (test/fixtures/woodpecker: a repository whose
// pipelines errored, failed then passed, one that always fails, a pipeline
// running), in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const fixture = (name) =>
  readFile(new URL(`./fixtures/woodpecker/${name}.json`, import.meta.url), 'utf8');

/** The recorded answers of Woodpecker, by request. */
function recorded(state) {
  return async (url) => {
    const { pathname } = new URL(url);
    const name = {
      '/api/version': 'version',
      '/api/user/repos': state === 'running' ? 'repos-running' : 'repos',
      '/api/queue/info': state === 'running' ? 'queue-running' : 'queue-idle',
      '/api/repos/1/pipelines': state === 'running' ? 'pipelines-green-running' : 'pipelines-green',
      '/api/repos/2/pipelines': 'pipelines-red',
    }[pathname];
    if (!name) {
      return { status: 404, body: '' };
    }
    return { status: 200, body: await fixture(name) };
  };
}

async function discover(language, state, scope) {
  const gladys = createFakeGladys({
    config: { url: 'http://192.0.2.40:8000', token: 'x'.repeat(120), language, scope },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-woodpecker-rules-'))),
    timers: false,
    request: recorded(state),
  });
  await gladys.connect();
  await app.ready;
  // The states, too: added devices, every value checked by the fake Gladys.
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await app.stop();
  return gladys.fake;
}

const scenarios = [
  { label: 'pipelines finished, English names', language: 'en', state: 'idle' },
  { label: 'a pipeline running, French names', language: 'fr', state: 'running' },
  { label: 'every pipeline, German names', language: 'de', state: 'idle', scope: 'all' },
  { label: 'a pipeline running, Spanish names', language: 'es', state: 'running' },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const fake = await discover(scenario.language, scenario.state, scenario.scope);
    const devices = fake.discoveredDevices;
    assert.equal(devices.length, 3, 'the server and the two repositories of the fixture');
    assert.ok(fake.states.length >= 15, 'states accepted by the fake Gladys');
    assert.ok(
      fake.states.every((state) => state.text === undefined || state.text.length > 0),
      'no empty text',
    );
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
