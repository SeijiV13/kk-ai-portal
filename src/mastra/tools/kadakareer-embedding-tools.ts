import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createTool } from '@mastra/core/tools';
import pg from 'pg';
import { z } from 'zod';

import {
  type DriveFile,
  getGoogleDriveFileText,
  listGoogleDriveKnowledgeFiles,
} from './google-drive-knowledge-tools';

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_INDEX_PATH = '.mastra/kadakareer-knowledge-index.json';
const DEFAULT_CHUNK_SIZE = 3200;
const DEFAULT_CHUNK_OVERLAP = 400;
const DEFAULT_MAX_FILE_CHARACTERS = 80_000;
const DEFAULT_MAX_CHUNKS_PER_FILE = 30;
const EMBEDDING_BATCH_SIZE = 64;
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

const { Pool } = pg;

type KnowledgeChunk = {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    fileId: string;
    fileName: string;
    mimeType: string;
    webViewLink: string | null;
    modifiedTime: string | null;
    chunkIndex: number;
  };
};

type IndexedFile = {
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  chunkCount: number;
};

type KnowledgeIndex = {
  version: 1;
  embeddingModel: string;
  updatedAt: string;
  files: Record<string, IndexedFile>;
  chunks: KnowledgeChunk[];
};

const syncIndexInputSchema = z.object({
  forceRebuild: z.boolean().default(false).describe('Re-index every readable Drive file even if modifiedTime did not change.'),
  maxFiles: z.number().int().min(1).max(1000).default(200).describe('Maximum readable Drive files to inspect.'),
  maxFileCharacters: z.number().int().min(1000).max(500_000).default(DEFAULT_MAX_FILE_CHARACTERS),
  maxChunksPerFile: z.number().int().min(1).max(100).default(DEFAULT_MAX_CHUNKS_PER_FILE),
});

const syncIndexOutputSchema = z.object({
  indexedFiles: z.number(),
  updatedFiles: z.number(),
  removedFiles: z.number(),
  chunks: z.number(),
  embeddingModel: z.string(),
  indexPath: z.string(),
  updatedAt: z.string(),
});

const indexStatusOutputSchema = z.object({
  indexReady: z.boolean(),
  indexedFiles: z.number(),
  chunks: z.number(),
  embeddingModel: z.string(),
  indexPath: z.string(),
  updatedAt: z.string().nullable(),
  storage: z.enum(['postgres', 'local-json']),
});

const searchIndexInputSchema = z.object({
  query: z.string().min(1).describe('Question or phrase to search in the local KadaKareer embedding index.'),
  topK: z.number().int().min(1).max(12).default(5),
  minScore: z.number().min(-1).max(1).default(0.2),
});

const searchIndexSourceSchema = z.object({
  fileId: z.string(),
  fileName: z.string(),
  webViewLink: z.string().nullable(),
  modifiedTime: z.string().nullable(),
  chunkIndex: z.number(),
  score: z.number(),
  text: z.string(),
});

const searchIndexOutputSchema = z.object({
  query: z.string(),
  indexReady: z.boolean(),
  relevantContext: z.string(),
  sources: z.array(searchIndexSourceSchema),
});

function getEmbeddingModel() {
  return process.env.KADAKAREER_EMBEDDING_MODEL ?? process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
}

function getIndexPath() {
  return resolve(process.env.KADAKAREER_KNOWLEDGE_INDEX_PATH ?? DEFAULT_INDEX_PATH);
}

function getDatabaseUrl() {
  return process.env.KADAKAREER_DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
}

function getEmbeddingDimensions() {
  return Number(process.env.KADAKAREER_EMBEDDING_DIMENSIONS ?? DEFAULT_EMBEDDING_DIMENSIONS);
}

function getIndexLocation() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return getIndexPath();
  }

  try {
    const url = new URL(databaseUrl);
    return `postgres://${url.host}${url.pathname}`;
  } catch {
    return 'postgres';
  }
}

function emptyIndex(model = getEmbeddingModel()): KnowledgeIndex {
  return {
    version: 1,
    embeddingModel: model,
    updatedAt: new Date(0).toISOString(),
    files: {},
    chunks: [],
  };
}

async function loadIndex() {
  try {
    const raw = await readFile(getIndexPath(), 'utf8');
    const index = JSON.parse(raw) as KnowledgeIndex;
    if (index.version !== 1 || index.embeddingModel !== getEmbeddingModel()) {
      return emptyIndex();
    }
    return index;
  } catch {
    return emptyIndex();
  }
}

async function saveIndex(index: KnowledgeIndex) {
  const indexPath = getIndexPath();
  await mkdir(dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(index, null, 2));
  await rename(tempPath, indexPath);
}

let pool: pg.Pool | null = null;
let schemaReady = false;

function getPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  pool ??= new Pool({
    connectionString: databaseUrl,
    ssl: process.env.KADAKAREER_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 5,
  });

  return pool;
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(',')}]`;
}

async function ensureDatabaseIndex() {
  const activePool = getPool();
  if (!activePool || schemaReady) {
    return activePool;
  }

  const dimensions = getEmbeddingDimensions();
  await activePool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS kadakareer_knowledge_files (
      file_id text PRIMARY KEY,
      name text NOT NULL,
      mime_type text NOT NULL,
      web_view_link text,
      modified_time timestamptz,
      chunk_count integer NOT NULL DEFAULT 0,
      embedding_model text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS kadakareer_knowledge_chunks (
      id text PRIMARY KEY,
      file_id text NOT NULL REFERENCES kadakareer_knowledge_files(file_id) ON DELETE CASCADE,
      chunk_index integer NOT NULL,
      text text NOT NULL,
      embedding vector(${dimensions}) NOT NULL,
      metadata jsonb NOT NULL,
      embedding_model text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await activePool.query(
    'CREATE INDEX IF NOT EXISTS kadakareer_knowledge_chunks_file_id_idx ON kadakareer_knowledge_chunks(file_id)',
  );
  await activePool.query(
    'CREATE INDEX IF NOT EXISTS kadakareer_knowledge_chunks_embedding_idx ON kadakareer_knowledge_chunks USING hnsw (embedding vector_cosine_ops)',
  );

  schemaReady = true;
  return activePool;
}

async function embedTexts(texts: string[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required to build or query the KadaKareer embedding index.');
  }

  const embeddings: number[][] = [];
  for (let index = 0; index < texts.length; index += EMBEDDING_BATCH_SIZE) {
    const input = texts.slice(index, index + EMBEDDING_BATCH_SIZE);
    const response = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: getEmbeddingModel(), input }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI embedding request failed with ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }

    const payload = (await response.json()) as { data?: { embedding?: number[] }[] };
    embeddings.push(...(payload.data ?? []).map(item => item.embedding ?? []));
  }

  return embeddings;
}

function chunkText(text: string, chunkSize: number, overlap: number, maxChunks: number) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length && chunks.length < maxChunks) {
    const hardEnd = Math.min(start + chunkSize, normalized.length);
    const softEnd = normalized.lastIndexOf('\n\n', hardEnd);
    const end = softEnd > start + chunkSize * 0.55 ? softEnd : hardEnd;
    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= normalized.length) {
      break;
    }
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function toIndexedFile(file: DriveFile, chunkCount: number): IndexedFile {
  return {
    fileId: file.id ?? '',
    name: file.name ?? 'Untitled file',
    mimeType: file.mimeType ?? 'application/octet-stream',
    webViewLink: file.webViewLink ?? null,
    modifiedTime: file.modifiedTime ?? null,
    chunkCount,
  };
}

async function syncDatabaseIndex(options: {
  forceRebuild: boolean;
  maxFiles: number;
  maxFileCharacters: number;
  maxChunksPerFile: number;
}) {
  const activePool = await ensureDatabaseIndex();
  if (!activePool) {
    return null;
  }

  const embeddingModel = getEmbeddingModel();
  const files = await listGoogleDriveKnowledgeFiles(options.maxFiles);
  const liveFileIds = new Set(files.map(file => file.id).filter(Boolean) as string[]);
  const existingRows = await activePool.query<{ file_id: string; modified_time: Date | null }>(
    'SELECT file_id, modified_time FROM kadakareer_knowledge_files WHERE embedding_model = $1',
    [embeddingModel],
  );
  const existingModifiedTimes = new Map(
    existingRows.rows.map(row => [row.file_id, row.modified_time?.toISOString() ?? null]),
  );
  let updatedFiles = 0;

  for (const file of files) {
    if (!file.id) {
      continue;
    }

    if (!options.forceRebuild && existingModifiedTimes.get(file.id) === (file.modifiedTime ?? null)) {
      continue;
    }

    const { content } = await getGoogleDriveFileText(file, options.maxFileCharacters);
    const texts = chunkText(content, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, options.maxChunksPerFile);
    const embeddings = texts.length > 0 ? await embedTexts(texts) : [];
    const metadataFile = toIndexedFile(file, texts.length);
    const client = await activePool.connect();

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM kadakareer_knowledge_chunks WHERE file_id = $1 AND embedding_model = $2', [
        file.id,
        embeddingModel,
      ]);
      await client.query(
        `INSERT INTO kadakareer_knowledge_files
          (file_id, name, mime_type, web_view_link, modified_time, chunk_count, embedding_model, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (file_id) DO UPDATE SET
          name = EXCLUDED.name,
          mime_type = EXCLUDED.mime_type,
          web_view_link = EXCLUDED.web_view_link,
          modified_time = EXCLUDED.modified_time,
          chunk_count = EXCLUDED.chunk_count,
          embedding_model = EXCLUDED.embedding_model,
          updated_at = now()`,
        [
          metadataFile.fileId,
          metadataFile.name,
          metadataFile.mimeType,
          metadataFile.webViewLink,
          metadataFile.modifiedTime,
          metadataFile.chunkCount,
          embeddingModel,
        ],
      );

      for (const [chunkIndex, text] of texts.entries()) {
        const metadata = {
          fileId: file.id,
          fileName: file.name ?? 'Untitled file',
          mimeType: file.mimeType ?? 'application/octet-stream',
          webViewLink: file.webViewLink ?? null,
          modifiedTime: file.modifiedTime ?? null,
          chunkIndex,
        };
        await client.query(
          `INSERT INTO kadakareer_knowledge_chunks
            (id, file_id, chunk_index, text, embedding, metadata, embedding_model, updated_at)
          VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb, $7, now())
          ON CONFLICT (id) DO UPDATE SET
            text = EXCLUDED.text,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata,
            embedding_model = EXCLUDED.embedding_model,
            updated_at = now()`,
          [
            `${file.id}:${chunkIndex}`,
            file.id,
            chunkIndex,
            text,
            vectorLiteral(embeddings[chunkIndex] ?? []),
            JSON.stringify(metadata),
            embeddingModel,
          ],
        );
      }

      await client.query('COMMIT');
      updatedFiles += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  let removedFiles = 0;
  if (liveFileIds.size > 0) {
    const removeResult = await activePool.query(
      'DELETE FROM kadakareer_knowledge_files WHERE embedding_model = $1 AND NOT (file_id = ANY($2::text[]))',
      [embeddingModel, [...liveFileIds]],
    );
    removedFiles = removeResult.rowCount ?? 0;
  }

  const stats = await activePool.query<{ indexed_files: string; chunks: string }>(
    `SELECT
      (SELECT count(*) FROM kadakareer_knowledge_files WHERE embedding_model = $1) AS indexed_files,
      (SELECT count(*) FROM kadakareer_knowledge_chunks WHERE embedding_model = $1) AS chunks`,
    [embeddingModel],
  );
  const updatedAt = new Date().toISOString();

  return {
    indexedFiles: Number(stats.rows[0]?.indexed_files ?? 0),
    updatedFiles,
    removedFiles,
    chunks: Number(stats.rows[0]?.chunks ?? 0),
    embeddingModel,
    indexPath: getIndexLocation(),
    updatedAt,
  };
}

async function searchDatabaseIndex(query: string, topK: number, minScore: number) {
  const activePool = await ensureDatabaseIndex();
  if (!activePool) {
    return null;
  }

  const embeddingModel = getEmbeddingModel();
  const countResult = await activePool.query<{ count: string }>(
    'SELECT count(*) FROM kadakareer_knowledge_chunks WHERE embedding_model = $1',
    [embeddingModel],
  );
  if (Number(countResult.rows[0]?.count ?? 0) === 0) {
    return { query, indexReady: false, relevantContext: '', sources: [] };
  }

  const [queryEmbedding] = await embedTexts([query]);
  const result = await activePool.query<{
    file_id: string;
    chunk_index: number;
    text: string;
    metadata: KnowledgeChunk['metadata'];
    score: number;
  }>(
    `SELECT
      file_id,
      chunk_index,
      text,
      metadata,
      1 - (embedding <=> $1::vector) AS score
    FROM kadakareer_knowledge_chunks
    WHERE embedding_model = $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3`,
    [vectorLiteral(queryEmbedding), embeddingModel, topK],
  );

  const sources = result.rows
    .filter(row => Number(row.score) >= minScore)
    .map(row => ({
      fileId: row.file_id,
      fileName: row.metadata.fileName,
      webViewLink: row.metadata.webViewLink,
      modifiedTime: row.metadata.modifiedTime,
      chunkIndex: row.chunk_index,
      score: Number(Number(row.score).toFixed(4)),
      text: row.text,
    }));

  return {
    query,
    indexReady: true,
    relevantContext: sources
      .map(source => `Source: ${source.fileName}\nURL: ${source.webViewLink ?? 'n/a'}\nScore: ${source.score}\n${source.text}`)
      .join('\n\n---\n\n'),
    sources,
  };
}

async function getDatabaseIndexStatus() {
  const activePool = await ensureDatabaseIndex();
  if (!activePool) {
    return null;
  }

  const embeddingModel = getEmbeddingModel();
  const result = await activePool.query<{
    indexed_files: string;
    chunks: string;
    updated_at: string | null;
  }>(
    `SELECT
      (SELECT count(*) FROM kadakareer_knowledge_files WHERE embedding_model = $1) AS indexed_files,
      (SELECT count(*) FROM kadakareer_knowledge_chunks WHERE embedding_model = $1) AS chunks,
      (SELECT max(updated_at)::text FROM kadakareer_knowledge_chunks WHERE embedding_model = $1) AS updated_at`,
    [embeddingModel],
  );
  const row = result.rows[0];
  const chunks = Number(row?.chunks ?? 0);

  return {
    indexReady: chunks > 0,
    indexedFiles: Number(row?.indexed_files ?? 0),
    chunks,
    embeddingModel,
    indexPath: getIndexLocation(),
    updatedAt: row?.updated_at ?? null,
    storage: 'postgres' as const,
  };
}

async function getLocalIndexStatus() {
  const index = await loadIndex();
  return {
    indexReady: index.chunks.length > 0,
    indexedFiles: Object.keys(index.files).length,
    chunks: index.chunks.length,
    embeddingModel: index.embeddingModel,
    indexPath: getIndexPath(),
    updatedAt: index.updatedAt === new Date(0).toISOString() ? null : index.updatedAt,
    storage: 'local-json' as const,
  };
}

export const getKadaKareerKnowledgeIndexStatusTool = createTool({
  id: 'get_kadakareer_knowledge_index_status',
  description: 'Return the current KadaKareer embedding index status, including storage backend and record counts.',
  inputSchema: z.object({}),
  outputSchema: indexStatusOutputSchema,
  execute: async () => (await getDatabaseIndexStatus()) ?? getLocalIndexStatus(),
});

export const syncKadaKareerKnowledgeIndexTool = createTool({
  id: 'sync_kadakareer_knowledge_index',
  description: 'Build or refresh the local KadaKareer embedding index from the shared Google Drive knowledge base.',
  inputSchema: syncIndexInputSchema,
  outputSchema: syncIndexOutputSchema,
  execute: async ({ forceRebuild, maxFiles, maxFileCharacters, maxChunksPerFile }) => {
    const databaseResult = await syncDatabaseIndex({ forceRebuild, maxFiles, maxFileCharacters, maxChunksPerFile });
    if (databaseResult) {
      return databaseResult;
    }

    const index = await loadIndex();
    const files = await listGoogleDriveKnowledgeFiles(maxFiles);
    const liveFileIds = new Set(files.map(file => file.id).filter(Boolean) as string[]);
    let updatedFiles = 0;

    index.chunks = index.chunks.filter(chunk => liveFileIds.has(chunk.metadata.fileId));

    for (const file of files) {
      if (!file.id) {
        continue;
      }

      const existing = index.files[file.id];
      if (!forceRebuild && existing?.modifiedTime === (file.modifiedTime ?? null)) {
        continue;
      }

      const { content } = await getGoogleDriveFileText(file, maxFileCharacters);
      const texts = chunkText(content, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, maxChunksPerFile);
      const embeddings = texts.length > 0 ? await embedTexts(texts) : [];

      index.chunks = index.chunks.filter(chunk => chunk.metadata.fileId !== file.id);
      const chunks = texts.map<KnowledgeChunk>((text, chunkIndex) => ({
        id: `${file.id}:${chunkIndex}`,
        text,
        embedding: embeddings[chunkIndex] ?? [],
        metadata: {
          fileId: file.id ?? '',
          fileName: file.name ?? 'Untitled file',
          mimeType: file.mimeType ?? 'application/octet-stream',
          webViewLink: file.webViewLink ?? null,
          modifiedTime: file.modifiedTime ?? null,
          chunkIndex,
        },
      }));

      index.chunks.push(...chunks);
      index.files[file.id] = toIndexedFile(file, chunks.length);
      updatedFiles += 1;
    }

    const removedFiles = Object.keys(index.files).filter(fileId => !liveFileIds.has(fileId));
    for (const fileId of removedFiles) {
      delete index.files[fileId];
    }

    index.updatedAt = new Date().toISOString();
    await saveIndex(index);

    return {
      indexedFiles: Object.keys(index.files).length,
      updatedFiles,
      removedFiles: removedFiles.length,
      chunks: index.chunks.length,
      embeddingModel: index.embeddingModel,
      indexPath: getIndexPath(),
      updatedAt: index.updatedAt,
    };
  },
});

export const searchKadaKareerKnowledgeIndexTool = createTool({
  id: 'search_kadakareer_knowledge_index',
  description: 'Fast semantic search over the prebuilt KadaKareer embedding index. Use this before live Google Drive search.',
  inputSchema: searchIndexInputSchema,
  outputSchema: searchIndexOutputSchema,
  execute: async ({ query, topK, minScore }) => {
    const databaseResult = await searchDatabaseIndex(query, topK, minScore);
    if (databaseResult) {
      return databaseResult;
    }

    const index = await loadIndex();
    if (index.chunks.length === 0) {
      return { query, indexReady: false, relevantContext: '', sources: [] };
    }

    const [queryEmbedding] = await embedTexts([query]);
    const sources = index.chunks
      .map(chunk => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .filter(result => result.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(result => ({
        fileId: result.chunk.metadata.fileId,
        fileName: result.chunk.metadata.fileName,
        webViewLink: result.chunk.metadata.webViewLink,
        modifiedTime: result.chunk.metadata.modifiedTime,
        chunkIndex: result.chunk.metadata.chunkIndex,
        score: Number(result.score.toFixed(4)),
        text: result.chunk.text,
      }));

    return {
      query,
      indexReady: true,
      relevantContext: sources
        .map(source => `Source: ${source.fileName}\nURL: ${source.webViewLink ?? 'n/a'}\nScore: ${source.score}\n${source.text}`)
        .join('\n\n---\n\n'),
      sources,
    };
  },
});
