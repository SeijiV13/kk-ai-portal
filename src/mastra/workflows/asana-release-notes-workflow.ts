import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { releaseNotesAgent } from '../agents/release-notes-agent';
import {
  asanaSprintFetchInputSchema,
  asanaTaskSchema,
  fetchCompletedAsanaSprintTasks,
  postReleaseNotesToSlack,
  slackReleasePostInputSchema,
} from '../tools/release-automation-tools';

const slackConfigSchema = z.object({
  publishToSlack: z.boolean().default(true),
  slackWebhook: slackReleasePostInputSchema.shape.slackWebhook,
});

export const asanaReleaseNotesWorkflowInputSchema = asanaSprintFetchInputSchema
  .omit({
    asanaProjectGid: true,
  })
  .extend({
    includeTaskLinks: z.boolean().default(true),
  })
  .merge(slackConfigSchema);

const collectedTicketsSchema = asanaReleaseNotesWorkflowInputSchema.extend({
  asanaProjectGidSuffix: z.string(),
  tasks: z.array(asanaTaskSchema),
  taskCount: z.number().int().nonnegative(),
});

const generatedReleaseNotesSchema = collectedTicketsSchema.extend({
  releaseTitle: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()),
  ticketBullets: z.array(z.string()),
});

const renderedReleaseNotesSchema = generatedReleaseNotesSchema.extend({
  markdown: z.string(),
});

export const asanaReleaseNotesWorkflowOutputSchema = renderedReleaseNotesSchema.extend({
  slackPosted: z.boolean(),
});

function formatTaskLine(task: z.infer<typeof asanaTaskSchema>, includeTaskLinks: boolean) {
  const details = [task.assignee ? `Owner: ${task.assignee}` : undefined, task.completedAt ? `Completed: ${task.completedAt}` : undefined]
    .filter(Boolean)
    .join(' | ');
  const link = includeTaskLinks && task.permalinkUrl ? ` (${task.permalinkUrl})` : '';
  return `- ${task.name}${link}${details ? ` - ${details}` : ''}`;
}

const collectSprintTicketsStep = createStep({
  id: 'collect-sprint-tickets',
  description: 'Collects completed Asana tickets for the requested sprint.',
  inputSchema: asanaReleaseNotesWorkflowInputSchema,
  outputSchema: collectedTicketsSchema,
  execute: async ({ inputData }) => {
    if (inputData.asanaProject !== inputData.slackWebhook) {
      throw new Error(`Asana project (${inputData.asanaProject}) must match Slack destination (${inputData.slackWebhook}).`);
    }

    const result = await fetchCompletedAsanaSprintTasks(inputData);

    return {
      ...inputData,
      asanaProjectGidSuffix: result.asanaProjectGidSuffix,
      tasks: result.tasks,
      taskCount: result.taskCount,
    };
  },
});

const summarizeReleaseNotesStep = createStep({
  id: 'summarize-release-notes',
  description: 'Creates a user-facing summary and bullet points from completed sprint tickets.',
  inputSchema: collectedTicketsSchema,
  outputSchema: generatedReleaseNotesSchema,
  execute: async ({ inputData }) => {
    const releaseTitle = `${inputData.sprintName} Release Notes`;

    if (inputData.taskCount === 0) {
      return {
        ...inputData,
        releaseTitle,
        summary: `No completed tickets matched ${inputData.sprintName}.`,
        highlights: ['No completed tickets matched the configured sprint filters.'],
        ticketBullets: [],
      };
    }

    const taskDigest = inputData.tasks.map(task => ({
      name: task.name,
      notes: task.notes.slice(0, 400),
      completedAt: task.completedAt,
      assignee: task.assignee,
      sectionName: task.sectionName,
      sprintValue: task.sprintValue,
    }));

    const result = await releaseNotesAgent.generate(
      [
        {
          role: 'user',
          content: `Write release notes for sprint ${inputData.sprintName} using only these completed tickets. Return concise, user-facing content with a short summary, 3 to 6 highlights, and one bullet for each completed ticket. Ticket data: ${JSON.stringify(taskDigest)}`,
        },
      ],
      {
        structuredOutput: {
          schema: z.object({
            summary: z.string(),
            highlights: z.array(z.string()).min(1),
            ticketBullets: z.array(z.string()),
          }),
        },
      },
    );

    return {
      ...inputData,
      releaseTitle,
      summary: result.object.summary,
      highlights: result.object.highlights,
      ticketBullets: result.object.ticketBullets,
    };
  },
});

const renderReleaseNotesStep = createStep({
  id: 'render-release-notes',
  description: 'Renders the generated release note sections into Markdown for Slack.',
  inputSchema: generatedReleaseNotesSchema,
  outputSchema: renderedReleaseNotesSchema,
  execute: async ({ inputData }) => {
    const highlightLines = inputData.highlights.map(highlight => `- ${highlight}`).join('\n');
    const ticketSummaryLines = inputData.ticketBullets.length > 0
      ? inputData.ticketBullets.map(bullet => `- ${bullet}`).join('\n')
      : '- No completed tickets matched the configured sprint filters.';
    const ticketLines = inputData.tasks.map(task => formatTaskLine(task, inputData.includeTaskLinks)).join('\n');

    const markdown = [
      `# ${inputData.releaseTitle}`,
      '',
      `Asana project: ${inputData.asanaProject} (${inputData.asanaProjectGidSuffix})`,
      '',
      `Sprint: ${inputData.sprintName}`,
      '',
      '## Summary',
      inputData.summary,
      '',
      '## Highlights',
      highlightLines,
      '',
      `## Completed Tickets (${inputData.taskCount})`,
      ticketSummaryLines,
      '',
      '## Ticket Inventory',
      ticketLines || '- No completed tickets matched the configured sprint filters.',
    ].join('\n');

    return {
      ...inputData,
      markdown,
    };
  },
});

const publishReleaseNotesStep = createStep({
  id: 'publish-release-notes',
  description: 'Publishes the rendered release notes to Slack.',
  inputSchema: renderedReleaseNotesSchema,
  outputSchema: asanaReleaseNotesWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    let slackPosted = false;
    if (inputData.publishToSlack) {
      await postReleaseNotesToSlack({
        markdown: inputData.markdown,
        slackWebhook: inputData.slackWebhook,
      });
      slackPosted = true;
    }

    return {
      ...inputData,
      slackPosted,
    };
  },
});

export const asanaReleaseNotesWorkflow = createWorkflow({
  id: 'asana-release-notes-workflow',
  description: 'Fetches completed Asana sprint tickets, summarizes them, and publishes release notes to Slack.',
  inputSchema: asanaReleaseNotesWorkflowInputSchema,
  outputSchema: asanaReleaseNotesWorkflowOutputSchema,
})
  .then(collectSprintTicketsStep)
  .then(summarizeReleaseNotesStep)
  .then(renderReleaseNotesStep)
  .then(publishReleaseNotesStep)
  .commit();