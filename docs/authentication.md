# Authentication

See [flowchart.md](./flowchart.md) for diagrams (Authentication Overview, RBAC Flow).

The frontend uses Auth0 through `@auth0/auth0-angular`.

Auth config lives in:

```text
apps/copilot-console/src/app/auth0.config.ts
```

Current shape:

```typescript
export const auth0Config = {
  domain: 'dev-ew42azyb.us.auth0.com',
  clientId: '...',
  connection: 'Username-Password-Authentication',
  audience: 'http://localhost:4111/api',
  scope: 'openid profile email knowledge-agent:chat release-notes:execute admin',
};
```

The `audience` must exactly match the Auth0 API Identifier.

## Auth0 Dashboard Setup

### Application URLs

In the Auth0 application settings, configure:

```text
Allowed Callback URLs: http://localhost:4200
Allowed Logout URLs: http://localhost:4200
Allowed Web Origins: http://localhost:4200
```

The application should be a Single Page Application.

### Disable Public Signup

To make the console invite/admin-only:

```text
Authentication -> Database -> Username-Password-Authentication -> Settings -> Disable Sign Ups
```

Create users manually from:

```text
User Management -> Users -> Create User
```

### API and Permissions

Create an Auth0 API:

```text
Applications -> APIs -> Create API
Name: Local Mastra API
Identifier: http://localhost:4111/api
Signing Algorithm: RS256
```

Add these API permissions:

| Permission | Purpose |
|---|---|
| `knowledge-agent:chat` | Can see and chat with the KadaKareer Knowledge Agent |
| `release-notes:execute` | Can see and execute the release notes workflow |
| `admin` | Can see all user-facing agents and workflows |

Enable these API settings:

```text
Enable RBAC: ON
Add Permissions in the Access Token: ON
```

### Roles

Recommended roles:

| Role | Permissions |
|---|---|
| Knowledge Agent User | `knowledge-agent:chat` |
| Release Notes User | `release-notes:execute` |
| Console Admin | `admin` |

Assign roles from:

```text
User Management -> Users -> select user -> Roles
```

### Optional Post Login Action

If Auth0 does not include permissions in the access token, add a Post Login Action that copies roles/permissions into custom claims.

```javascript
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'http://localhost:4111/api/';
  const roles = event.authorization?.roles || [];
  const directPermissions = event.authorization?.permissions || [];
  const metadataPermissions = event.user.app_metadata?.permissions || [];

  const rolePermissions = {
    'Knowledge Agent User': ['knowledge-agent:chat'],
    'Release Notes User': ['release-notes:execute'],
    'Console Admin': ['admin'],
    'Administrator': ['admin'],
  };

  const permissions = [
    ...new Set([
      ...directPermissions,
      ...metadataPermissions,
      ...roles.flatMap(role => rolePermissions[role] || []),
    ]),
  ];

  api.accessToken.setCustomClaim(`${namespace}roles`, roles);
  api.accessToken.setCustomClaim(`${namespace}permissions`, permissions);
  api.idToken.setCustomClaim(`${namespace}roles`, roles);
  api.idToken.setCustomClaim(`${namespace}permissions`, permissions);
};
```

Attach it here:

```text
Actions -> Flows -> Login -> drag action into flow -> Apply
```

After changing Auth0 roles/actions, log out and log back in to receive a fresh token.

## Tool-Level Service Auth (not user auth)

Mastra tools authenticate to third-party services independently of the end user's Auth0 identity, using service credentials from environment variables:

| Tool | Auth Mechanism |
|---|---|
| Google Drive (`google-drive-knowledge-tools.ts`) | OAuth2 refresh token (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`), or static `GOOGLE_DRIVE_ACCESS_TOKEN` |
| Asana (`release-automation-tools.ts`) | Static bearer token (`ASANA_ACCESS_TOKEN`) |
| OpenAI embeddings (`kadakareer-embedding-tools.ts`) | API key (`OPENAI_API_KEY`) |

## Troubleshooting

### User logs in but sees no agents/workflows

Check the access token contains permissions:

```json
{
  "permissions": ["admin"]
}
```

or:

```json
{
  "http://localhost:4111/api/permissions": ["admin"]
}
```

If missing, enable Auth0 RBAC and Add Permissions in Access Token, or use the Post Login Action above.

### Copilot chat reaches OpenAI with invalid issuer

Do not send Auth0 tokens in the standard `Authorization` header for CopilotKit chat. The console uses `x-auth0-token` for chat and the runtime validates it before invoking agents.
