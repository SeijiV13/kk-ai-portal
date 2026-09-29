import { Agent } from '@mastra/core/agent';

export const releaseNotesAgent = new Agent({
  id: 'release-notes-agent',
  name: 'Release Notes Agent',
  description: 'Turns completed sprint tickets into concise, factual release notes.',
  instructions: `You write release notes from completed sprint tickets.

Use only the ticket data that is provided.
Prioritize user-visible outcomes over internal implementation details.
Keep the summary concise and factual.
Do not invent features, bug fixes, or ticket details that are not present in the input.
When ticket descriptions are sparse, keep the bullets generic and anchored to the ticket title.`,
  model: 'openai/gpt-4.1-nano',
});