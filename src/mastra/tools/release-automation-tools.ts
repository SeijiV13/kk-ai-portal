import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const ASANA_API_BASE_URL = 'https://app.asana.com/api/1.0';

const asanaListResponseSchema = z.object({
  data: z.array(z.unknown()),
  next_page: z
    .object({
      offset: z.string().optional(),
    })
    .nullable()
    .optional(),
});

const sprintNameOptions = [
  'Sprint Q3.26.1',
  'Sprint Q3.26.2',
  'Sprint Q3.26.3',
  'Sprint Q3.26.4',
] as const;

const asanaProjectEnvVars = {
  Programs: 'ASANA_PROGRAMS_PROJECT_GID',
  KoachEx: 'ASANA_KOACHEX_PROJECT_GID'
} as const;

const slackWebhookEnvVars = {
  Programs: 'SLACK_PROGRAMS_RELEASE_WEBHOOK_URL',
  KoachEx: 'SLACK_KOACHEX_RELEASE_WEBHOOK_URL',
} as const;

const asanaProjectLabels = Object.keys(asanaProjectEnvVars) as [keyof typeof asanaProjectEnvVars];
const slackWebhookLabels = Object.keys(slackWebhookEnvVars) as [keyof typeof slackWebhookEnvVars];

type AsanaProjectLabel = keyof typeof asanaProjectEnvVars;

export const asanaTaskSchema = z.object({
  gid: z.string(),
  name: z.string(),
  notes: z.string(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  completedBy: z.string().nullable(),
  assignee: z.string().nullable(),
  permalinkUrl: z.string().url().nullable(),
  sprintValue: z.string().nullable(),
  sectionName: z.string().nullable(),
});

export const asanaSprintFetchInputSchema = z.object({
  asanaProject: z.enum(asanaProjectLabels).default('Programs').describe('Named Asana project to read sprint tickets from.'),
  asanaProjectGid: z.string().min(1).optional().describe('Optional Asana project GID override. When omitted, the selected project label is used.'),
  sprintName: z.enum(sprintNameOptions).describe('Sprint name that should appear in the release notes.'),
  sprintFieldName: z.string().min(1).default('Sprint').describe('Asana custom field name used to store the sprint label.'),
  sprintFieldValue: z.string().min(1).optional().describe('Optional exact custom field value to match when it differs from sprintName.'),
  asanaSectionGid: z.string().min(1).optional().describe('Optional Asana section GID to further narrow the sprint tickets.'),
  doneSectionName: z.string().min(1).default('Done').describe('Section name required for tickets that are not marked completed in Asana.'),
  completedSince: z.string().optional().describe('Optional ISO timestamp lower bound for completed task lookup.'),
  maxTasks: z.number().int().min(1).max(200).default(100).describe('Maximum number of project tasks to inspect.'),
});

export const asanaSprintFetchOutputSchema = z.object({
  sprintName: z.string(),
  asanaProjectGidSuffix: z.string(),
  tasks: z.array(asanaTaskSchema),
  taskCount: z.number().int().nonnegative(),
});

export const asanaProjectTaskQueryInputSchema = z.object({
  asanaProject: z.enum(asanaProjectLabels).default('Programs').describe('Named Asana project to inspect.'),
  asanaProjectGid: z.string().min(1).optional().describe('Optional Asana project GID override. When omitted, the selected project label is used.'),
  query: z.string().min(1).optional().describe('Optional text to match in task title, notes, assignee, section, or sprint value.'),
  sprintName: z.string().min(1).optional().describe('Optional sprint value to filter tasks by.'),
  sprintFieldName: z.string().min(1).default('Sprints').describe('Asana custom field name used to store the sprint label.'),
  sectionName: z.string().min(1).optional().describe('Optional section name to filter tasks by.'),
  assignee: z.string().min(1).optional().describe('Optional assignee name to filter tasks by.'),
  completed: z.boolean().optional().describe('Optional completion state filter.'),
  completedSince: z.string().optional().describe('Optional ISO timestamp lower bound for completed task lookup.'),
  maxTasks: z.number().int().min(1).max(200).default(100).describe('Maximum number of project tasks to inspect.'),
});

export const asanaProjectTaskQueryOutputSchema = z.object({
  asanaProject: z.enum(asanaProjectLabels),
  asanaProjectGidSuffix: z.string(),
  tasks: z.array(asanaTaskSchema),
  taskCount: z.number().int().nonnegative(),
});

export const asanaProjectStatusInputSchema = z.object({
  asanaProject: z.enum(asanaProjectLabels).default('Programs').describe('Named Asana project to summarize.'),
  asanaProjectGid: z.string().min(1).optional().describe('Optional Asana project GID override. When omitted, the selected project label is used.'),
  sprintFieldName: z.string().min(1).default('Sprints').describe('Asana custom field name used to group sprint status.'),
  completedSince: z.string().optional().describe('Optional ISO timestamp lower bound for completed task lookup.'),
  maxTasks: z.number().int().min(1).max(200).default(200).describe('Maximum number of project tasks to inspect.'),
});

const asanaBreakdownSchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  incompleteCount: z.number().int().nonnegative(),
});

export const asanaProjectStatusOutputSchema = z.object({
  asanaProject: z.enum(asanaProjectLabels),
  asanaProjectGidSuffix: z.string(),
  taskCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  incompleteCount: z.number().int().nonnegative(),
  sectionBreakdown: z.array(asanaBreakdownSchema),
  sprintBreakdown: z.array(asanaBreakdownSchema),
  assigneeBreakdown: z.array(asanaBreakdownSchema),
  recentlyCompletedTasks: z.array(asanaTaskSchema),
  openTasks: z.array(asanaTaskSchema),
});

export const slackReleasePostInputSchema = z.object({
  markdown: z.string().min(1).describe('Release note body to send to Slack.'),
  slackWebhook: z.enum(slackWebhookLabels).default('Programs').describe('Named Slack destination for the release note.'),
  webhookUrl: z.url().optional().describe('Optional Slack incoming webhook URL override. Falls back to the selected destination environment variable.'),
});

export const slackReleasePostOutputSchema = z.object({
  ok: z.boolean(),
});

type AsanaTask = z.infer<typeof asanaTaskSchema>;
type AsanaSprintFetchInput = z.infer<typeof asanaSprintFetchInputSchema>;
type AsanaProjectTaskQueryInput = z.infer<typeof asanaProjectTaskQueryInputSchema>;
type AsanaProjectStatusInput = z.infer<typeof asanaProjectStatusInputSchema>;

type AsanaApiTask = {
  gid?: string;
  name?: string;
  notes?: string | null;
  completed?: boolean;
  completed_at?: string | null;
  completed_by?: { name?: string | null } | null;
  assignee?: { name?: string | null } | null;
  permalink_url?: string | null;
  memberships?: Array<{ section?: { gid?: string | null; name?: string | null } | null }>;
  custom_fields?: Array<{
    name?: string | null;
    display_value?: string | null;
    text_value?: string | null;
    number_value?: number | null;
    enum_value?: { name?: string | null } | null;
  }>;
};

type AsanaCustomField = NonNullable<AsanaApiTask['custom_fields']>[number];

function requireValue(value: string | undefined, message: string) {
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function normalizeValue(value: string) {
  return value.trim().toLowerCase();
}

function getCustomFieldDisplayValue(field: AsanaCustomField | undefined) {
  if (!field) {
    return undefined;
  }

  const candidates = [
    field.display_value,
    field.text_value,
    field.enum_value?.name,
    typeof field.number_value === 'number' ? String(field.number_value) : undefined,
  ];

  return candidates.find(candidate => typeof candidate === 'string' && candidate.trim().length > 0)?.trim();
}

function toAsanaTask(task: AsanaApiTask, sprintFieldName: string): AsanaTask {
  const sprintField = task.custom_fields?.find(field => normalizeValue(field.name ?? '') === normalizeValue(sprintFieldName));
  const firstSection = task.memberships?.find(membership => membership.section?.name)?.section;

  return {
    gid: task.gid ?? 'unknown',
    name: task.name ?? 'Untitled task',
    notes: task.notes?.trim() ?? '',
    completed: Boolean(task.completed),
    completedAt: task.completed_at ?? null,
    completedBy: task.completed_by?.name ?? null,
    assignee: task.assignee?.name ?? null,
    permalinkUrl: task.permalink_url ?? null,
    sprintValue: getCustomFieldDisplayValue(sprintField) ?? null,
    sectionName: firstSection?.name ?? null,
  };
}

function matchesSprint(task: AsanaTask, sprintName: string, sprintFieldValue?: string) {
  const expected = normalizeValue(sprintFieldValue ?? sprintName);
  const actual = task.sprintValue ? normalizeValue(task.sprintValue) : '';
  return actual === expected;
}

function matchesDoneSection(task: AsanaTask, doneSectionName: string) {
  const actual = task.sectionName ? normalizeValue(task.sectionName) : '';
  return actual === normalizeValue(doneSectionName);
}

function matchesCompletion(task: AsanaTask, doneSectionName: string) {
  if (task.completed) {
    return true;
  }

  return matchesDoneSection(task, doneSectionName);
}

function matchesSection(task: AsanaApiTask, asanaSectionGid?: string) {
  if (!asanaSectionGid) {
    return true;
  }

  return Boolean(task.memberships?.some(membership => membership.section?.gid === asanaSectionGid));
}

async function fetchJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${label} failed with ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

function resolveAsanaProjectGid(project: AsanaProjectLabel, projectGid?: string) {
  return projectGid ?? requireValue(
    process.env[asanaProjectEnvVars[project]],
    `Asana project GID is required. Set ${asanaProjectEnvVars[project]} or provide asanaProjectGid.`,
  );
}

function resolveSlackWebhookUrl(destination: keyof typeof slackWebhookEnvVars, webhookUrl?: string) {
  return webhookUrl ?? process.env[slackWebhookEnvVars[destination]];
}

async function fetchAsanaProjectTasks(input: {
  asanaProject: AsanaProjectLabel;
  asanaProjectGid?: string;
  sprintFieldName: string;
  completedSince?: string;
  maxTasks: number;
}) {
  const token = requireValue(process.env['ASANA_ACCESS_TOKEN'], 'ASANA_ACCESS_TOKEN is required to read tickets from Asana.');
  const asanaProjectGid = resolveAsanaProjectGid(input.asanaProject, input.asanaProjectGid);
  const tasks: AsanaTask[] = [];
  let offset: string | undefined;

  while (tasks.length < input.maxTasks) {
    const url = new URL(`${ASANA_API_BASE_URL}/projects/${asanaProjectGid}/tasks`);
    url.searchParams.set('completed_since', input.completedSince ?? '1970-01-01T00:00:00.000Z');
    url.searchParams.set('limit', String(Math.min(100, input.maxTasks - tasks.length)));
    url.searchParams.set(
      'opt_fields',
      [
        'gid',
        'name',
        'notes',
        'completed',
        'completed_at',
        'completed_by.name',
        'assignee.name',
        'permalink_url',
        'memberships.section.gid',
        'memberships.section.name',
        'custom_fields.name',
        'custom_fields.display_value',
        'custom_fields.text_value',
        'custom_fields.number_value',
        'custom_fields.enum_value.name',
      ].join(','),
    );

    if (offset) {
      url.searchParams.set('offset', offset);
    }

    const response = asanaListResponseSchema.parse(
      await fetchJson<unknown>(
        url.toString(),
        {
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
            'user-agent': 'Mastra Asana Agent/1.0',
          },
        },
        'Asana project task fetch',
      ),
    );

    const pageTasks = response.data as AsanaApiTask[];
    tasks.push(...pageTasks.map(task => toAsanaTask(task, input.sprintFieldName)));

    if (!response.next_page?.offset || pageTasks.length === 0) {
      break;
    }

    offset = response.next_page.offset;
  }

  return { asanaProjectGid, tasks };
}

function includesQuery(task: AsanaTask, query?: string) {
  if (!query) {
    return true;
  }

  const needle = normalizeValue(query);
  return [
    task.name,
    task.notes,
    task.assignee,
    task.sectionName,
    task.sprintValue,
    task.completedBy,
  ].some(value => value ? normalizeValue(value).includes(needle) : false);
}

function buildBreakdown(tasks: AsanaTask[], getName: (task: AsanaTask) => string | null) {
  const counts = new Map<string, { count: number; completedCount: number; incompleteCount: number }>();

  for (const task of tasks) {
    const name = getName(task) || 'Unspecified';
    const current = counts.get(name) ?? { count: 0, completedCount: 0, incompleteCount: 0 };
    current.count += 1;
    if (task.completed) {
      current.completedCount += 1;
    } else {
      current.incompleteCount += 1;
    }
    counts.set(name, current);
  }

  return [...counts.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function byMostRecentCompletion(left: AsanaTask, right: AsanaTask) {
  return Date.parse(right.completedAt ?? '') - Date.parse(left.completedAt ?? '');
}

export async function queryAsanaProjectTasks(input: AsanaProjectTaskQueryInput) {
  const { asanaProjectGid, tasks } = await fetchAsanaProjectTasks(input);
  const filteredTasks = tasks.filter(task => {
    if (typeof input.completed === 'boolean' && task.completed !== input.completed) {
      return false;
    }

    if (input.sprintName && normalizeValue(task.sprintValue ?? '') !== normalizeValue(input.sprintName)) {
      return false;
    }

    if (input.sectionName && normalizeValue(task.sectionName ?? '') !== normalizeValue(input.sectionName)) {
      return false;
    }

    if (input.assignee && normalizeValue(task.assignee ?? '') !== normalizeValue(input.assignee)) {
      return false;
    }

    return includesQuery(task, input.query);
  });

  return {
    asanaProject: input.asanaProject,
    asanaProjectGidSuffix: asanaProjectGid.slice(-6),
    tasks: filteredTasks,
    taskCount: filteredTasks.length,
  };
}

export async function getAsanaProjectStatus(input: AsanaProjectStatusInput) {
  const { asanaProjectGid, tasks } = await fetchAsanaProjectTasks(input);
  const completedTasks = tasks.filter(task => task.completed);
  const openTasks = tasks.filter(task => !task.completed);

  return {
    asanaProject: input.asanaProject,
    asanaProjectGidSuffix: asanaProjectGid.slice(-6),
    taskCount: tasks.length,
    completedCount: completedTasks.length,
    incompleteCount: openTasks.length,
    sectionBreakdown: buildBreakdown(tasks, task => task.sectionName),
    sprintBreakdown: buildBreakdown(tasks, task => task.sprintValue),
    assigneeBreakdown: buildBreakdown(tasks, task => task.assignee),
    recentlyCompletedTasks: completedTasks.sort(byMostRecentCompletion).slice(0, 10),
    openTasks: openTasks.slice(0, 20),
  };
}

export async function fetchCompletedAsanaSprintTasks(input: AsanaSprintFetchInput) {
  const token = requireValue(process.env['ASANA_ACCESS_TOKEN'], 'ASANA_ACCESS_TOKEN is required to read sprint tickets from Asana.');
  const asanaProjectGid = resolveAsanaProjectGid(input.asanaProject, input.asanaProjectGid);
  const tasks: AsanaTask[] = [];
  let offset: string | undefined;

  while (tasks.length < input.maxTasks) {
    const url = new URL(`${ASANA_API_BASE_URL}/projects/${asanaProjectGid}/tasks`);
    url.searchParams.set('completed_since', input.completedSince ?? '1970-01-01T00:00:00.000Z');
    url.searchParams.set('limit', String(Math.min(100, input.maxTasks - tasks.length)));
    url.searchParams.set(
      'opt_fields',
      [
        'gid',
        'name',
        'notes',
        'completed',
        'completed_at',
        'completed_by.name',
        'assignee.name',
        'permalink_url',
        'memberships.section.gid',
        'memberships.section.name',
        'custom_fields.name',
        'custom_fields.display_value',
        'custom_fields.text_value',
        'custom_fields.number_value',
        'custom_fields.enum_value.name',
      ].join(','),
    );

    if (offset) {
      url.searchParams.set('offset', offset);
    }

    const response = asanaListResponseSchema.parse(
      await fetchJson<unknown>(
        url.toString(),
        {
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
            'user-agent': 'Mastra Release Automation/1.0',
          },
        },
        'Asana project task fetch',
      ),
    );

    const pageTasks = response.data as AsanaApiTask[];
    for (const task of pageTasks) {
      if (!matchesSection(task, input.asanaSectionGid)) {
        continue;
      }

      const normalizedTask = toAsanaTask(task, input.sprintFieldName);
      if (
        matchesCompletion(normalizedTask, input.doneSectionName)
        &&
        matchesSprint(normalizedTask, input.sprintName, input.sprintFieldValue)
      ) {
        tasks.push(normalizedTask);
      }
    }

    if (!response.next_page?.offset || pageTasks.length === 0) {
      break;
    }

    offset = response.next_page.offset;
  }

  return {
    sprintName: input.sprintName,
    asanaProjectGidSuffix: asanaProjectGid.slice(-6),
    tasks,
    taskCount: tasks.length,
  };
}

export async function postReleaseNotesToSlack(input: z.infer<typeof slackReleasePostInputSchema>) {
  const webhookUrl = requireValue(
    resolveSlackWebhookUrl(input.slackWebhook, input.webhookUrl),
    `Slack webhook is required. Provide webhookUrl or set ${slackWebhookEnvVars[input.slackWebhook]}.`,
  );

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: input.markdown,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Slack webhook failed with ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }

  return { ok: true };
}

export const fetchAsanaSprintTasksTool = createTool({
  id: 'fetch_asana_sprint_tasks',
  description: 'Fetch completed Asana tasks for a sprint from a specific project.',
  inputSchema: asanaSprintFetchInputSchema,
  outputSchema: asanaSprintFetchOutputSchema,
  execute: fetchCompletedAsanaSprintTasks,
});

export const queryAsanaProjectTasksTool = createTool({
  id: 'query_asana_project_tasks',
  description: 'Search and filter Asana tasks from the Programs or KoachEx project by text, sprint, section, assignee, and completion state.',
  inputSchema: asanaProjectTaskQueryInputSchema,
  outputSchema: asanaProjectTaskQueryOutputSchema,
  execute: queryAsanaProjectTasks,
});

export const getAsanaProjectStatusTool = createTool({
  id: 'get_asana_project_status',
  description: 'Summarize current Asana project status for Programs or KoachEx, grouped by section, sprint, and assignee.',
  inputSchema: asanaProjectStatusInputSchema,
  outputSchema: asanaProjectStatusOutputSchema,
  execute: getAsanaProjectStatus,
});

export const postSlackReleaseNotesTool = createTool({
  id: 'post_slack_release_notes',
  description: 'Send rendered release notes to Slack through an incoming webhook.',
  inputSchema: slackReleasePostInputSchema,
  outputSchema: slackReleasePostOutputSchema,
  execute: postReleaseNotesToSlack,
});