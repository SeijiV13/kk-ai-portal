# Backend

CopilotKit runtime/proxy: `apps/copilot-console/copilot-runtime.ts`
Mastra server: `src/mastra/index.ts`, served by `npm run dev`

See [flowchart.md](./flowchart.md) for diagrams and [authentication.md](./authentication.md) for JWT verification and RBAC setup details.

## Protected Runtime and Proxy

The protected runtime lives at:

```text
apps/copilot-console/copilot-runtime.ts
```

It does three jobs:

1. Serves CopilotKit chat routes under `http://localhost:8200/api/copilotkit/*`
2. Proxies Mastra API routes under `http://localhost:8200/api/mastra/*`
3. Verifies Auth0 JWTs and enforces permissions

### Route Protection

| Route | Auth Required | Notes |
|---|---:|---|
| `/api/copilotkit/info` | No | Public runtime discovery endpoint |
| `/api/copilotkit/agent/:agentId/run` | Yes | Requires matching agent permission |
| `/api/mastra/agents` | Yes | Response filtered by permissions |
| `/api/mastra/workflows` | Yes | Response filtered by permissions |
| `/api/mastra/workflows/:workflowId/*` | Yes | Requires `release-notes:execute` or `admin` |

The frontend uses `x-auth0-token` for CopilotKit chat requests so the Auth0 token is not forwarded as the standard `Authorization` header to OpenAI.

Mastra proxy calls use `Authorization: Bearer <token>`.

## Running Locally

```shell
# Root project: Mastra API and Studio
npm run dev
```

```shell
# apps/copilot-console: Auth0-protected Copilot runtime and proxy
npm run copilot-runtime
```

Default local URLs:

| Service | URL |
|---|---|
| Protected Copilot runtime/proxy | `http://localhost:8200` |
| Raw Mastra API/Studio | `http://localhost:4111` |

Do not expose the raw Mastra API publicly in production. Expose the protected runtime/proxy or put Mastra behind another Auth0-validating gateway.

## Runbook

### Check protected runtime

```shell
curl -i http://localhost:8200/api/copilotkit/info
```

Should return `200`.

```shell
curl -i http://localhost:8200/api/mastra/agents
```

Without a token, should return `401`.
