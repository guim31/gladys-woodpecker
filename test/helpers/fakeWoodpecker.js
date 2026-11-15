// -----------------------------------------------------------------------------
// An in-memory Woodpecker answering like the real one (Woodpecker 3.20.1, see
// test/fixtures/woodpecker): the active repositories with their last
// pipeline, the pipelines of a repository, the queue (admin only), the
// version, restarts by POST, bearer token authentication. It replaces
// `httpRequest` (src/woodpecker/client.js).
// -----------------------------------------------------------------------------

export const BASE = 'http://192.0.2.40:8000';
export const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0eXBlIjoidXNlciJ9.fake-signature-for-tests';
export const FORGE = 'https://git.example.org';

// Seconds, as Woodpecker counts.
const START = Date.UTC(2026, 9, 20, 9, 0, 0) / 1000;

const json = (status, data) => ({ status, body: JSON.stringify(data) });

export class FakeWoodpecker {
  constructor() {
    /** @type {Map<number, { id, fullName, defaultBranch, active, pipelines }>} */
    this.repos = new Map();
    this.admin = true;
    this.idleAgents = 1;
    this.down = false;
    this.requests = [];
    this.request = this.handle.bind(this);
  }

  addRepo(id, fullName, { defaultBranch = 'main', active = true } = {}) {
    this.repos.set(id, { id, fullName, defaultBranch, active, pipelines: [] });
    return this;
  }

  /** A pipeline that starts now (running). */
  start(id, { branch, event = 'push', status = 'running' } = {}) {
    const repo = this.repos.get(id);
    const number = (repo.pipelines[0]?.number ?? 0) + 1;
    const time = START + number * 60;
    repo.pipelines.unshift({
      number,
      status,
      event,
      branch: branch ?? repo.defaultBranch,
      created: time,
      started: status === 'pending' ? 0 : time,
      finished: 0,
    });
    return number;
  }

  /** The newest pipeline (or a given one) ends, or a new one runs and ends. */
  finish(id, status, { duration = 42, number, branch, event } = {}) {
    const repo = this.repos.get(id);
    let pipeline = number
      ? repo.pipelines.find((item) => item.number === number)
      : repo.pipelines.find((item) => ['running', 'pending'].includes(item.status));
    if (!pipeline || (!number && (branch || event))) {
      this.start(id, { branch, event });
      pipeline = repo.pipelines[0];
    }
    pipeline.started ||= pipeline.created;
    Object.assign(pipeline, { status, finished: pipeline.started + duration });
    return pipeline.number;
  }

  pipelineJson(repo, pipeline) {
    return {
      id: repo.id * 1000 + pipeline.number,
      number: pipeline.number,
      author: 'alice',
      parent: 0,
      event: pipeline.event,
      event_reason: null,
      status: pipeline.status,
      errors: null,
      created: pipeline.created,
      updated: pipeline.finished || pipeline.created,
      started: pipeline.started,
      finished: pipeline.finished,
      deploy_to: '',
      deploy_task: '',
      commit: '213225ed98a93652d99c0cabe89e86ac430e3fb4',
      branch: pipeline.branch,
      rerun_count: 0,
      ref: `refs/heads/${pipeline.branch}`,
      refspec: '',
      forge_url: `${FORGE}/${repo.fullName}/commit/213225ed98a93652d99c0cabe89e86ac430e3fb4`,
      version: '3.20.1',
      title: '',
      message: 'Update the pipeline',
      timestamp: pipeline.created,
      sender: 'alice',
      author_email: 'alice@example.com',
    };
  }

  repoJson(repo) {
    const [owner, name] = repo.fullName.split('/');
    return {
      id: repo.id,
      forge_id: 1,
      forge_remote_id: String(repo.id),
      owner,
      name,
      full_name: repo.fullName,
      forge_url: `${FORGE}/${repo.fullName}`,
      default_branch: repo.defaultBranch,
      active: repo.active,
      ...(repo.pipelines[0] ? { last_pipeline: this.pipelineJson(repo, repo.pipelines[0]) } : {}),
    };
  }

  queueJson() {
    const all = [...this.repos.values()].flatMap((repo) => repo.pipelines);
    return {
      pending: [],
      waiting_on_deps: [],
      running: [],
      stats: {
        worker_count: this.idleAgents,
        pending_count: all.filter((pipeline) => pipeline.status === 'pending').length,
        waiting_on_deps_count: 0,
        running_count: all.filter((pipeline) => pipeline.status === 'running').length,
      },
      paused: false,
    };
  }

  async handle(url, { method = 'GET', headers = {} } = {}) {
    this.requests.push({ method, url, headers });
    if (this.down) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    const { pathname, searchParams } = new URL(url);
    if (method === 'GET' && pathname === '/api/version') {
      return json(200, {
        source: 'https://github.com/woodpecker-ci/woodpecker',
        version: '3.20.1',
      });
    }
    if (headers.authorization !== `Bearer ${TOKEN}`) {
      return { status: 401, body: 'User not authorized' };
    }
    if (method === 'GET' && pathname === '/api/user/repos') {
      // Without `all`, only the active repositories.
      return json(
        200,
        [...this.repos.values()].filter((repo) => repo.active).map((repo) => this.repoJson(repo)),
      );
    }
    if (method === 'GET' && pathname === '/api/queue/info') {
      return this.admin ? json(200, this.queueJson()) : { status: 403, body: 'Forbidden' };
    }
    const list = /^\/api\/repos\/(\d+)\/pipelines$/.exec(pathname);
    if (list) {
      const repo = this.repos.get(Number(list[1]));
      if (!repo) {
        return { status: 404, body: 'null' };
      }
      if (method === 'GET') {
        // Filters as on Woodpecker 3.20: one branch, events separated by commas.
        const perPage = Number(searchParams.get('perPage') ?? 50);
        const branch = searchParams.get('branch');
        const events = searchParams.get('event')?.split(',');
        return json(
          200,
          repo.pipelines
            .filter((pipeline) => !branch || pipeline.branch === branch)
            .filter((pipeline) => !events || events.includes(pipeline.event))
            .slice(0, perPage)
            .map((pipeline) => this.pipelineJson(repo, pipeline)),
        );
      }
    }
    const one = /^\/api\/repos\/(\d+)\/pipelines\/(\d+)$/.exec(pathname);
    if (one && method === 'POST') {
      const repo = this.repos.get(Number(one[1]));
      const source = repo?.pipelines.find((pipeline) => pipeline.number === Number(one[2]));
      if (!source) {
        return { status: 404, body: 'null' };
      }
      const number = this.start(repo.id, {
        branch: source.branch,
        event: source.event,
        status: 'pending',
      });
      return json(
        200,
        this.pipelineJson(
          repo,
          repo.pipelines.find((p) => p.number === number),
        ),
      );
    }
    return { status: 404, body: '404 page not found' };
  }
}

/**
 * Three repositories: alice/website (green), alice/scripts (green, a pull
 * request failing), team/api (failing).
 */
export function sampleWoodpecker() {
  const woodpecker = new FakeWoodpecker();
  woodpecker.addRepo(1, 'alice/website').addRepo(2, 'alice/scripts').addRepo(3, 'team/api');
  woodpecker.finish(1, 'success');
  woodpecker.finish(2, 'success');
  woodpecker.finish(2, 'failure', { branch: 'feature', event: 'pull_request' });
  woodpecker.finish(3, 'failure', { duration: 125 });
  return woodpecker;
}
