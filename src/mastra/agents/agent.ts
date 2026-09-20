import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { askUserTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';

import {
  fetchAsanaSprintTasksTool,
  postSlackReleaseNotesTool,
} from '../tools/release-automation-tools';

export const agent = new Agent({
  id: 'agent',
  name: 'Release Automation Agent',
  description: 'Helps collect sprint tickets from Asana and prepare release notes for Slack and GitHub.',
  instructions: `You help produce sprint release notes from Asana tickets.

When the user wants release notes, collect the sprint context, fetch completed sprint tickets, and produce a concise release summary.
Use only the provided ticket data for summaries and release bullets.
Ask concise follow-up questions only when required identifiers or destinations are missing.`,
  model: 'openai/gpt-5.6-terra',
  memory: new Memory({
    options: {
      generateTitle: true,
      observationalMemory: {
        model: 'openai/gpt-5-mini',
      },
    },
  }),
  tools: {
    ask_user: askUserTool,
    fetch_asana_sprint_tasks: fetchAsanaSprintTasksTool,
    post_slack_release_notes: postSlackReleaseNotesTool,
    web_search: openai.tools.webSearch(),
  },
});