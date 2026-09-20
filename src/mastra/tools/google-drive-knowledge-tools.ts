import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const FILE_FIELDS = 'id,name,mimeType,webViewLink,modifiedTime,owners(displayName),size';

const GOOGLE_DOC_EXPORT_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

const PLAIN_TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml'];

const NON_FOLDER_CLAUSE = "mimeType != 'application/vnd.google-apps.folder'";
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const MAX_SCOPE_FOLDERS = 200;
const PARENT_BATCH_SIZE = 25;
const FOLDER_SCOPE_TTL_MS = 10 * 60 * 1000;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'our', 'their', 'they', 'this', 'that', 'with', 'from',
  'what', 'when', 'where', 'which', 'who', 'whom', 'how', 'why', 'does', 'did', 'do', 'is', 'was', 'were',
  'can', 'could', 'should', 'would', 'about', 'into', 'have', 'has', 'had', 'any', 'all', 'get', 'tell',
  'give', 'show', 'find', 'explain', 'please', 'there', 'here', 'his', 'her', 'its', 'been', 'over',
]);

export type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  modifiedTime?: string;
  owners?: { displayName?: string }[];
};

const driveSearchInputSchema = z.object({
  query: z.string().min(1).describe('Question or search phrase to look up in the Google Drive knowledge base.'),
  pageSize: z.number().int().min(1).max(10).default(4).describe('Maximum number of Drive files to return.'),
  includeContentPreview: z.boolean().default(true).describe('Whether to include a short content excerpt for each result.'),
  previewCharLimit: z.number().int().min(200).max(2000).default(500).describe('Maximum characters of content preview per result.'),
  folderId: z.string().optional().describe('Restrict the search to a specific Drive folder ID. Defaults to GOOGLE_DRIVE_FOLDER_ID when set.'),
});

const driveSearchResultSchema = z.object({
  fileId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  webViewLink: z.string().nullable(),
  modifiedTime: z.string().nullable(),
  owner: z.string().nullable(),
  excerpt: z.string(),
});

const driveSearchOutputSchema = z.object({
  query: z.string(),
  results: z.array(driveSearchResultSchema),
});

const driveFileInputSchema = z.object({
  fileId: z.string().min(1).describe('Google Drive file ID to retrieve.'),
  maxCharacters: z.number().int().min(500).max(20_000).default(8_000).describe('Maximum number of characters of file content to return.'),
});

const driveFileOutputSchema = z.object({
  fileId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  webViewLink: z.string().nullable(),
  modifiedTime: z.string().nullable(),
  owner: z.string().nullable(),
  content: z.string(),
  truncated: z.boolean(),
});

let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let inFlightTokenRefresh: Promise<string> | null = null;

async function refreshAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Drive credentials are missing. Set GOOGLE_DRIVE_ACCESS_TOKEN, or GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.',
    );
  }

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };

  if (!response.ok) {
    const details = [payload.error, payload.error_description].filter(Boolean).join(': ');
    throw new Error(
      `Google OAuth token refresh failed with ${response.status} ${response.statusText}${details ? ` (${details})` : ''}. Regenerate GOOGLE_REFRESH_TOKEN and restart the dev server.`,
    );
  }

  if (!payload.access_token) {
    throw new Error('Google OAuth token refresh did not return an access token.');
  }

  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };

  return cachedAccessToken.token;
}

async function getAccessToken() {
  const staticToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  if (staticToken) {
    return staticToken;
  }

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  // Parallel Drive calls would otherwise each trigger their own refresh.
  inFlightTokenRefresh ??= refreshAccessToken().finally(() => {
    inFlightTokenRefresh = null;
  });

  return inFlightTokenRefresh;
}

async function driveFetch(path: string, label: string) {
  const token = await getAccessToken();
  const response = await fetch(`${DRIVE_API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label} failed with ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }

  return response;
}

// Drive query strings only escape backslashes and single quotes.
function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toResultMetadata(file: DriveFile) {
  return {
    fileId: file.id ?? '',
    name: file.name ?? 'Untitled file',
    mimeType: file.mimeType ?? 'application/octet-stream',
    webViewLink: file.webViewLink ?? null,
    modifiedTime: file.modifiedTime ?? null,
    owner: file.owners?.[0]?.displayName ?? null,
  };
}

function isReadableAsText(mimeType: string) {
  return (
    mimeType in GOOGLE_DOC_EXPORT_TYPES ||
    PLAIN_TEXT_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))
  );
}

async function listFiles(query: string, pageSize: number) {
  const params = new URLSearchParams({
    q: query,
    pageSize: String(pageSize),
    orderBy: 'modifiedTime desc',
    fields: `files(${FILE_FIELDS})`,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  });

  const response = await driveFetch(`/files?${params.toString()}`, 'Google Drive search');
  const payload = (await response.json()) as { files?: DriveFile[] };
  return payload.files ?? [];
}

async function listAllFiles(query: string, maxFiles: number) {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      pageSize: String(Math.min(100, maxFiles - files.length)),
      orderBy: 'modifiedTime desc',
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await driveFetch(`/files?${params.toString()}`, 'Google Drive file listing');
    const payload = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken && files.length < maxFiles);

  return files.slice(0, maxFiles);
}

const folderScopeCache = new Map<string, { ids: string[]; expiresAt: number }>();

function toParentClause(ids: string[]) {
  return `(${ids.map(id => `'${escapeDriveQueryValue(id)}' in parents`).join(' or ')})`;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

// Drive only matches direct children of a parent, so nested folders must be resolved explicitly.
async function resolveFolderScope(rootFolderId: string) {
  const cached = folderScopeCache.get(rootFolderId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ids;
  }

  const seen = new Set([rootFolderId]);
  let frontier = [rootFolderId];

  while (frontier.length > 0 && seen.size < MAX_SCOPE_FOLDERS) {
    const levels = await Promise.all(
      chunk(frontier, PARENT_BATCH_SIZE).map(batch =>
        listFiles(`${toParentClause(batch)} and trashed = false and mimeType = '${FOLDER_MIME_TYPE}'`, 100),
      ),
    );

    const next: string[] = [];
    for (const child of levels.flat()) {
      if (child.id && !seen.has(child.id) && seen.size < MAX_SCOPE_FOLDERS) {
        seen.add(child.id);
        next.push(child.id);
      }
    }
    frontier = next;
  }

  const ids = [...seen];
  folderScopeCache.set(rootFolderId, { ids, expiresAt: Date.now() + FOLDER_SCOPE_TTL_MS });
  return ids;
}

function extractSearchTerms(query: string) {
  const terms = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(term => term.length > 2 && !STOP_WORDS.has(term));

  return [...new Set(terms)].slice(0, 6);
}

function buildTextClause(query: string, terms: string[], mode: 'phrase' | 'all' | 'any') {
  if (mode === 'phrase' || terms.length === 0) {
    return `fullText contains '${escapeDriveQueryValue(query)}'`;
  }

  const joiner = mode === 'all' ? ' and ' : ' or ';
  const clause = terms.map(term => `fullText contains '${escapeDriveQueryValue(term)}'`).join(joiner);
  return `(${clause})`;
}

async function searchDriveFiles(query: string, pageSize: number, scopedFolderId?: string) {
  const baseClauses = ['trashed = false', NON_FOLDER_CLAUSE];

  let parentBatches: (string | null)[] = [null];
  if (scopedFolderId) {
    const folderIds = await resolveFolderScope(scopedFolderId);
    parentBatches = chunk(folderIds, PARENT_BATCH_SIZE).map(toParentClause);
  }

  const terms = extractSearchTerms(query);
  const modes: ('phrase' | 'all' | 'any')[] = terms.length > 0 ? ['all', 'any', 'phrase'] : ['phrase'];

  for (const mode of modes) {
    const textClause = buildTextClause(query, terms, mode);
    const batchResults = await Promise.all(
      parentBatches.map(parentClause =>
        listFiles([textClause, ...baseClauses, ...(parentClause ? [parentClause] : [])].join(' and '), pageSize),
      ),
    );

    const collected = new Map<string, DriveFile>();
    for (const file of batchResults.flat()) {
      if (file.id && !collected.has(file.id)) {
        collected.set(file.id, file);
      }
    }

    if (collected.size > 0) {
      return [...collected.values()]
        .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))
        .slice(0, pageSize);
    }
  }

  return [];
}

async function readFileText(fileId: string, mimeType: string, maxCharacters: number) {
  const exportMimeType = GOOGLE_DOC_EXPORT_TYPES[mimeType];

  if (exportMimeType) {
    const response = await driveFetch(
      `/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
      'Google Drive file export',
    );
    const text = await response.text();
    return {
      content: text.slice(0, maxCharacters).trim(),
      truncated: text.length > maxCharacters,
    };
  }

  if (!PLAIN_TEXT_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))) {
    return {
      content: `This file type (${mimeType}) cannot be read as text. Open it in Drive instead.`,
      truncated: false,
    };
  }

  const response = await driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`, 'Google Drive file download');
  const text = await response.text();
  return {
    content: text.slice(0, maxCharacters).trim(),
    truncated: text.length > maxCharacters,
  };
}

export async function listGoogleDriveKnowledgeFiles(maxFiles = 200, folderId = process.env.GOOGLE_DRIVE_FOLDER_ID) {
  const parentBatches = folderId
    ? chunk(await resolveFolderScope(folderId), PARENT_BATCH_SIZE).map(toParentClause)
    : [null];

  const batchResults = await Promise.all(
    parentBatches.map(parentClause =>
      listAllFiles(
        ['trashed = false', NON_FOLDER_CLAUSE, ...(parentClause ? [parentClause] : [])].join(' and '),
        maxFiles,
      ),
    ),
  );

  const files = new Map<string, DriveFile>();
  for (const file of batchResults.flat()) {
    if (file.id && isReadableAsText(file.mimeType ?? '')) {
      files.set(file.id, file);
    }
  }

  return [...files.values()]
    .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))
    .slice(0, maxFiles);
}

export async function getGoogleDriveFileText(file: DriveFile, maxCharacters: number) {
  if (!file.id) {
    throw new Error('Google Drive file is missing an id.');
  }

  return readFileText(file.id, file.mimeType ?? 'application/octet-stream', maxCharacters);
}

export const searchGoogleDriveKnowledgeTool = createTool({
  id: 'search_google_drive_knowledge',
  description:
    'Search the shared Google Drive knowledge base and return the most relevant documents. Searches nested subfolders. Pass distinctive keywords rather than a full sentence.',
  inputSchema: driveSearchInputSchema,
  outputSchema: driveSearchOutputSchema,
  execute: async ({ query, pageSize, includeContentPreview, previewCharLimit, folderId }) => {
    const scopedFolderId = folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID;
    const files = await searchDriveFiles(query, pageSize, scopedFolderId);

    const results = await Promise.all(
      files
        .map(toResultMetadata)
        .filter(metadata => metadata.fileId)
        .map(async metadata => {
          if (!includeContentPreview || !isReadableAsText(metadata.mimeType)) {
            return { ...metadata, excerpt: '' };
          }

          try {
            const { content } = await readFileText(metadata.fileId, metadata.mimeType, previewCharLimit);
            return { ...metadata, excerpt: content };
          } catch {
            return { ...metadata, excerpt: '' };
          }
        }),
    );

    return { query, results };
  },
});

export const getGoogleDriveFileContentTool = createTool({
  id: 'get_google_drive_file_content',
  description: 'Retrieve the full text content of a specific Google Drive file.',
  inputSchema: driveFileInputSchema,
  outputSchema: driveFileOutputSchema,
  execute: async ({ fileId, maxCharacters }) => {
    const params = new URLSearchParams({
      fields: FILE_FIELDS,
      supportsAllDrives: 'true',
    });

    const response = await driveFetch(
      `/files/${encodeURIComponent(fileId)}?${params.toString()}`,
      'Google Drive file metadata fetch',
    );
    const file = (await response.json()) as DriveFile;
    const metadata = toResultMetadata(file);
    const { content, truncated } = await readFileText(fileId, metadata.mimeType, maxCharacters);

    return {
      ...metadata,
      fileId,
      content,
      truncated,
    };
  },
});
