# Woodpecker CI for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows the pipelines of a [Woodpecker CI](https://woodpecker-ci.org/)
server: pipeline status, failure alerts, queue and agents, as devices, scene
triggers and a dashboard widget, and restarts the last pipeline from a scene
when you allow it.

- **One device per followed repository**: status of the last pipeline
  (success, failed, error, cancelled, running, pending, awaiting approval…),
  last pipeline passed, pipeline running, number, duration, branch and event.
- **A Woodpecker CI device**: server reachable, pending and running workflows,
  idle agents (admin token), failing repositories.
- **Scene triggers**: pipeline finished (filter on the result), repository
  failing or back to green.
- **Scene actions**: restart the last pipeline (an option, off by default);
  read a repository, its state as variables for the next actions.
- **Dashboard widget**: the last pipeline of every repository, failing first,
  with the queue.
- The default branch alone decides by default: a failing pull request does
  not turn a repository red (an option counts every pipeline).
- Texts in English, French, German and Spanish.

Tested against a real Woodpecker 3.20.1 server in Docker, with a Forgejo forge
and an agent (a repository that passes, one that fails, a configuration error,
pipelines started by push webhooks and by hand, running and pending, a
restart, a refused token, a server down), the integration image running locked
down as in the Gladys sandbox. Not tested yet on a real Gladys instance:
feedback welcome on [the issues](https://github.com/guim31/gladys-woodpecker/issues).

## Requirements

- Gladys Assistant **5.1.0** or later.
- Woodpecker **3** or later, reachable from Gladys.
- A personal access token (your avatar → Personal access token). An admin's
  token also gives the queue and the agents; restarting a pipeline needs the
  push permission on the repository.

## Installation

In Gladys: **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-woodpecker`. Then open its configuration: the
Woodpecker address, the token, the repositories to follow (empty: all active
ones), and click **Test the connection**. Add the devices from the
**Discovery** tab.

The user documentation: [English](docs/en.md), [français](docs/fr.md),
[Deutsch](docs/de.md), [español](docs/es.md).

## How it works

Every minute by default (1 to 15 minutes), the container reads
`/api/user/repos` (the active repositories, each with its last pipeline) and
`/api/queue/info` (admin only), then `/api/repos/<id>/pipelines` for the
repositories whose pipelines moved since the previous reading. Finished
pipelines, failures and returns to green become scene events; what was seen is
kept in `/data`, so a restart neither misses nor repeats an event. Restarting
posts to `/api/repos/<id>/pipelines/<number>`, only when **Allow scenes to
restart pipelines** is on.

## Limits

- Restarting the last pipeline is the only command, off by default; pipelines
  cannot be cancelled or approved.
- 50 repositories at most; an event arrives up to one refresh interval late;
  more than ten pipelines of a repository between two readings: the oldest are
  not announced.
- Steps, logs and individual agents are not read.
- A self-signed certificate is refused: use the `http://` address on the local
  network.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests never touch the network: `test/helpers/fakeWoodpecker.js` answers
like Woodpecker, and `test/fixtures/woodpecker` holds real answers recorded on
Woodpecker 3.20.1 (anonymized).

## Credits

- [Woodpecker CI](https://github.com/woodpecker-ci/woodpecker) (Apache-2.0),
  whose REST API this integration reads. The cover uses the Woodpecker logo
  from its repository (`web/src/assets/logo.svg`, Apache-2.0).
- The structure follows [gladys-jenkins](https://github.com/guim31/gladys-jenkins).

This project is not affiliated with the Woodpecker CI project.

## License

[Apache-2.0](LICENSE)
