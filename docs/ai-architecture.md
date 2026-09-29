# AI Architecture

Neon/Postgres vector index: stores embedded Google Drive knowledge chunks

See [flowchart.md](./flowchart.md) for the Knowledge Query Flow sequence diagram.

## Knowledge Index

The Knowledge Agent answers from a Neon/Postgres `pgvector` index built from Google Drive.

Tools:

| Tool | Purpose |
|---|---|
| `sync_kadakareer_knowledge_index` | Reads Google Drive, chunks docs, embeds chunks, stores vectors |
| `search_kadakareer_knowledge_index` | Semantic search over indexed chunks |
| `get_kadakareer_knowledge_index_status` | Returns index status/counts |

Sync command:

```shell
npx mastra api --url http://localhost:4111 tool execute sync_kadakareer_knowledge_index '{"maxFiles":200,"forceRebuild":true}'
```

The frontend calls the sync/status tools through the protected proxy, not directly through `4111`.

## Google Drive Sync

Google Drive is the source of truth. Neon is the retrieval layer.

Required environment variables:

```shell
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DRIVE_FOLDER_ID=...
OPENAI_API_KEY=...
NEON_DATABASE_URL=...
```

`GOOGLE_REFRESH_TOKEN` is used to mint Drive access tokens. If sync fails with `invalid_grant`, regenerate the refresh token.

## Troubleshooting

### Neon tables exist but have no records

Run the sync tool successfully. Tables are created on startup/schema init, but records appear only after sync.

```shell
npx mastra api --url http://localhost:4111 tool execute sync_kadakareer_knowledge_index '{"maxFiles":200,"forceRebuild":true}'
```
