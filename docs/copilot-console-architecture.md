# KadaKareer Copilot Console Architecture

This documentation explains the KadaKareer Copilot Console, split into focused topics:

- [Frontend](./frontend.md) — Angular console, permission logic, local dev
- [Backend](./backend.md) — CopilotKit runtime/proxy, route protection, Mastra API
- [Authentication](./authentication.md) — Auth0 setup, RBAC, tool-level service auth
- [AI Architecture](./ai-architecture.md) — Knowledge index, Google Drive sync, embeddings
- [Flowcharts](./flowchart.md) — All Mermaid diagrams in one place

## System Overview

The system has four main runtime pieces:

- Angular console: `apps/copilot-console`
- CopilotKit runtime/proxy: `apps/copilot-console/copilot-runtime.ts`
- Mastra server: `src/mastra/index.ts`, served by `npm run dev`
- Neon/Postgres vector index: stores embedded Google Drive knowledge chunks

The browser never calls the raw Mastra API directly. It calls the protected Copilot runtime on port `8200`, which verifies Auth0 tokens and proxies allowed requests to Mastra on port `4111`.

See [flowchart.md](./flowchart.md) for the high-level flow diagram.
