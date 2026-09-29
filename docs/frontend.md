# Frontend

Angular console: `apps/copilot-console`

See [flowchart.md](./flowchart.md) for the high-level flow and RBAC diagrams, and [authentication.md](./authentication.md) for Auth0 setup details.

## Overview

The console is an Angular app that lets authenticated KadaKareer users chat with the KadaKareer Knowledge Agent and, when permitted, run internal workflows.

The browser never calls the raw Mastra API directly. It calls the protected Copilot runtime on port `8200`, which verifies Auth0 tokens and proxies allowed requests to Mastra on port `4111`.

## Running Locally

```shell
# apps/copilot-console: Angular dev server
ng serve
```

Default local URL: `http://localhost:4200`

### Rebuild the Angular console

```shell
cd apps/copilot-console
npm run build -- --configuration development
```

## Frontend Permission Logic

The frontend decodes the Auth0 access token directly and extracts permissions from multiple possible claim locations:

- `permissions`
- `roles`
- `scope`
- `http://localhost:4111/api/permissions`
- `http://localhost:4111/api/roles`
- `https://kadakareer.com/permissions` (legacy support)
- `https://kadakareer.com/roles` (legacy support)

It maps role aliases to permissions:

| Role / Alias | Permission |
|---|---|
| `Administrator` | `admin` |
| `Admin` | `admin` |
| `Console Admin` | `admin` |
| `Knowledge Agent User` | `knowledge-agent:chat` |
| `Release Notes User` | `release-notes:execute` |

The backend still enforces permissions, so frontend visibility is not the security boundary.

## Troubleshooting

### Release notes or internal processor appears unexpectedly

The frontend hides internal resources by ID. The proxy also supports:

```text
excludeAgentIds=...
excludeWorkflowIds=...
```

Internal hidden workflow:

```text
knowledge-base-agent-input-processor
```
