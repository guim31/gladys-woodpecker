// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Restart the last Woodpecker pipeline": restarts the newest pipeline of a
// followed repository (in the scope of the configuration), on the same
// commit. Off unless "Allow scenes to restart pipelines" is on in the
// configuration. The "Pipeline finished" trigger reports its end.
//
// "Read a Woodpecker repository": the state of a followed repository as
// outputs, for the next actions of the scene (a message, a condition). Read
// again when the last reading is older than 30 seconds.
// -----------------------------------------------------------------------------

import { decisiveOf, eventText, isRunning, pipelineUrl, pipelinesOf, statusOf } from './devices.js';
import { RESULTS } from './woodpecker/client.js';
import { ACTION_TEXT, STATUS_TEXT, pick } from './texts.js';

export const SCENE_ACTIONS = {
  async restart_pipeline(hub, { fields = {} }) {
    const language = hub.config.language;
    // Checked first: no request to Woodpecker when restarting is off.
    if (!hub.config.allowRestart) {
      throw new Error(pick(ACTION_TEXT.restartDisabled, language));
    }
    const repo = await hub.repoOf(fields.repo, language);
    const { restarted, number } = await hub.restart(repo, language);
    return {
      repo_name: repo.fullName,
      restarted_number: restarted,
      number,
      url: pipelineUrl(hub.config.url, repo, number || restarted),
    };
  },

  async get_repo(hub, { fields = {} }) {
    const language = hub.config.language;
    const repo = await hub.repoOf(fields.repo, language);
    const { last, finished } = pipelinesOf(repo);
    const decisive = decisiveOf(repo);
    return {
      repo_name: repo.fullName,
      status: pick(STATUS_TEXT[statusOf(repo)], language),
      result: finished?.status ?? '',
      passing: decisive?.status === RESULTS.SUCCESS,
      running: isRunning(repo),
      pipeline_number: last?.number ?? 0,
      duration: finished?.duration ?? 0,
      branch: last?.branch ?? '',
      event: last?.event ? eventText(last.event, language) : '',
      url: pipelineUrl(hub.config.url, repo, last?.number),
    };
  },
};
