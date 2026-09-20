import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { knowledgeBaseAgent } from './agents/knowledge-base-agent';
import { releaseNotesAgent } from './agents/release-notes-agent';
import { asanaAgent } from './agents/asana-agent';
import { getGoogleDriveFileContentTool, searchGoogleDriveKnowledgeTool } from './tools/google-drive-knowledge-tools';
import {
  getKadaKareerKnowledgeIndexStatusTool,
  searchKadaKareerKnowledgeIndexTool,
  syncKadaKareerKnowledgeIndexTool,
} from './tools/kadakareer-embedding-tools';
import {
  fetchAsanaSprintTasksTool,
  getAsanaProjectStatusTool,
  postSlackReleaseNotesTool,
  queryAsanaProjectTasksTool,
} from './tools/release-automation-tools';
import { asanaReleaseNotesWorkflow } from './workflows/asana-release-notes-workflow';


export const mastra = new Mastra({
  agents: { releaseNotesAgent, knowledgeBaseAgent, asanaAgent },
  workflows: { asanaReleaseNotesWorkflow },
  tools: {
    fetchAsanaSprintTasksTool,
    getAsanaProjectStatusTool,
    queryAsanaProjectTasksTool,
    postSlackReleaseNotesTool,
    getKadaKareerKnowledgeIndexStatusTool,
    searchKadaKareerKnowledgeIndexTool,
    syncKadaKareerKnowledgeIndexTool,
    searchGoogleDriveKnowledgeTool,
    getGoogleDriveFileContentTool,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
