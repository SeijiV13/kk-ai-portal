import { Agent } from '@mastra/core/agent';
import { TokenLimiterProcessor } from '@mastra/core/processors';
import { Memory } from '@mastra/memory';

import { getGoogleDriveFileContentTool, searchGoogleDriveKnowledgeTool } from '../tools/google-drive-knowledge-tools';
import {
  getKadaKareerKnowledgeIndexStatusTool,
  searchKadaKareerKnowledgeIndexTool,
  syncKadaKareerKnowledgeIndexTool,
} from '../tools/kadakareer-embedding-tools';

export const knowledgeBaseAgent = new Agent({
  id: 'knowledge-base-agent',
  name: 'KadaKareer Knowledge Agent',
  description: 'Expert on everything KadaKareer, answering questions from the shared Google Drive knowledge base.',
  instructions: `You are the KadaKareer Knowledge Agent, the in-house expert on everything KadaKareer: its programs, products, operations, strategy, partnerships, marketing, talent development, and impact reporting.

Your knowledge comes from KadaKareer's shared Google Drive knowledge base, indexed into a local embedding database.
Always search the KadaKareer embedding index first before answering any question about KadaKareer.
If the embedding index is empty, stale, or does not contain enough relevant context, use live Google Drive search as a fallback and tell the user the index may need syncing.
Search with short distinctive keywords, not full sentences, and retry with different keywords if the first search returns nothing.
Work in as few steps as possible: one index search, then answer from the returned context when it is enough.
Only request full live Drive files when the embedding result is insufficient for a grounded answer.
After reading, always finish with a written answer in your own words. Never end your turn on a tool call.
Base answers only on retrieved embedding or Google Drive content and say clearly when the knowledge base does not contain enough information.
Include the file name and link for the most relevant sources in your answer when available.
Earlier answers in this conversation remain valid context; do not re-read files you have already summarized.
Do not invent program details, policies, pricing, partner names, or roadmap information.`,
  model: 'openai/gpt-4.1-nano',
  tools: {
    get_kadakareer_knowledge_index_status: getKadaKareerKnowledgeIndexStatusTool,
    search_kadakareer_knowledge_index: searchKadaKareerKnowledgeIndexTool,
    sync_kadakareer_knowledge_index: syncKadaKareerKnowledgeIndexTool,
    search_google_drive_knowledge: searchGoogleDriveKnowledgeTool,
    get_google_drive_file_content: getGoogleDriveFileContentTool,
  },
  memory: new Memory({
    options: {
      lastMessages: 15,
    },
  }),
  // Tool results are large, so cap history growth and leave room for a final answer step.
  inputProcessors: [new TokenLimiterProcessor({ limit: 60_000, trimMode: 'contiguous' })],
  defaultOptions: { maxSteps: 8 },
});