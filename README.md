# product-management-control

Welcome to your new [Mastra](https://mastra.ai) project! We're excited to see what you build.

This starter provides you with a general-purpose Mastra agent that can research current information, manage multi-step tasks, work with local files, run approved shell commands, and create recurring schedules.

## Features

- A project-level `workspace/` for files and command execution
- Approval gates for file changes, deletions, and shell commands
- Conversation memory, generated thread titles, and task tracking
- OpenAI web search and direct web page fetching
- Recurring schedules that persist across restarts
- Local libSQL storage and DuckDB observability, with optional Turso storage
- A bundled Mastra skill that helps coding agents use current Mastra APIs

## Get started

Set your `OPENAI_API_KEY` in `.env` or in your environment, then run:

```shell
npm run dev
```

Open [http://localhost:4111](http://localhost:4111) in your browser to access [Mastra Studio](https://mastra.ai/docs/studio/overview).

Select **Agent** in Mastra Studio and try one of these prompts:

- `Get the weather forecast for Austin this weekend.`
- `Create a landing page for a Japanese sakura festival.`
- `Check the SPCX stock price now, then check it every minute.`

The agent asks for approval before it changes files or runs commands. When it creates a schedule, it returns an ID that you can use to pause the schedule.

## Copilot Console Authentication

The Angular Copilot console uses Auth0 for login. Configure the app values in `apps/copilot-console/src/app/auth0.config.ts`:

```typescript
export const auth0Config = {
	domain: 'YOUR_AUTH0_DOMAIN',
	clientId: 'YOUR_AUTH0_CLIENT_ID',
	connection: 'Username-Password-Authentication',
	audience: 'http://localhost:4111/api',
	scope: 'openid profile email knowledge-agent:chat asana-agent:chat release-notes:execute admin',
};
```

In the Auth0 application settings, add these URLs for local development:

```text
Allowed Callback URLs: http://localhost:4200
Allowed Logout URLs: http://localhost:4200
Allowed Web Origins: http://localhost:4200
```

Create an Auth0 API for the console backend and use its identifier as the Angular audience:

```text
Auth0 Dashboard -> Applications -> APIs -> Create API
Name: KadaKareer Console API
Identifier: http://localhost:4111/api
Signing Algorithm: RS256
```

The console is configured to request access tokens for that audience in `apps/copilot-console/src/app/auth0.config.ts`.

Add these API permissions in Auth0:

```text
Auth0 Dashboard -> Applications -> APIs -> Local Mastra API -> Permissions

knowledge-agent:chat      Allows the user to see and chat with the KadaKareer Knowledge Agent
asana-agent:chat          Allows the user to see and chat with the Asana Agent
release-notes:execute     Allows the user to see and execute the release notes workflow
admin                     Allows the user to see all agents and workflows
```

Enable RBAC and include permissions in access tokens:

```text
Auth0 Dashboard -> Applications -> APIs -> Local Mastra API -> Settings
Enable RBAC: on
Add Permissions in the Access Token: on
```

Create roles and assign them to users:

```text
Auth0 Dashboard -> User Management -> Roles

Knowledge Agent User: knowledge-agent:chat
Asana Agent User: asana-agent:chat
Release Notes User: release-notes:execute
Console Admin: admin
```

Then assign roles from:

```text
User Management -> Users -> select user -> Roles
```

If the console still shows `No Auth0 API permissions found in the access token`, add a Post Login Action to explicitly copy assigned roles into the access token. The runtime reads both standard claims and these namespaced claims.

```text
Auth0 Dashboard -> Actions -> Library -> Build Custom -> Post Login
```

Use this action:

```javascript
exports.onExecutePostLogin = async (event, api) => {
	const namespace = 'http://localhost:4111/api/';
	const roles = event.authorization?.roles || [];
	const directPermissions = event.authorization?.permissions || [];
	const metadataPermissions = event.user.app_metadata?.permissions || [];

	const rolePermissions = {
		'Knowledge Agent User': ['knowledge-agent:chat'],
		'Asana Agent User': ['asana-agent:chat'],
		'Release Notes User': ['release-notes:execute'],
		'Console Admin': ['admin'],
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

Deploy the action, then attach it to the Login flow:

```text
Auth0 Dashboard -> Actions -> Flows -> Login -> drag the action into the flow -> Apply
```

After changing roles or actions, log out and log back in so Auth0 issues a fresh access token.

If Auth0 still does not include permissions, set them explicitly on the user as metadata:

```text
Auth0 Dashboard -> User Management -> Users -> select user -> Metadata -> app_metadata
```

Example:

```json
{
	"permissions": ["admin"]
}
```

or:

```json
{
	"permissions": ["knowledge-agent:chat", "asana-agent:chat", "release-notes:execute"]
}
```

The Post Login Action above reads `app_metadata.permissions` and copies it into the access token claim that the console backend validates.

To keep access admin-only with no public registration, disable signups in Auth0 for the database connection used by this app:

```text
Auth0 Dashboard -> Authentication -> Database -> your connection -> Settings -> Disable Sign Ups
```

Then add users from the Auth0 Dashboard as an admin:

```text
User Management -> Users -> Create User
```

This hides public signup in the app flow and prevents new users from self-registering through the database connection.

The browser-facing APIs are protected through the Copilot runtime server:

```text
Protected Mastra proxy: http://localhost:8200/api/mastra/*
Protected Copilot runtime: http://localhost:8200/api/copilotkit/*
```

Do not expose the raw local Mastra dev server at `http://localhost:4111` directly in production. Put it behind the protected runtime/proxy or another Auth0-validating gateway.

## Workspace safety

The local filesystem tools stay inside the project-level `workspace/` directory. Shell commands start in that directory, but `LocalSandbox` does not provide operating-system isolation by default. Review command approvals carefully, and do not expose this template through an unauthenticated public server.

## Storage

The default `file:./mastra.db` database stores agent memory, tasks, and schedules locally. To use Turso, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `.env`.

Recurring schedules continue to use model tokens until you pause them. Ask the agent to pause a schedule with the ID returned by `start_schedule`.

## Making it yours

- Edit `src/mastra/agents/agent.ts` to change the model, instructions, memory, workspace, or approval policy.
- Edit `src/mastra/tools/` to customize web fetching and scheduling.
- Edit `src/mastra/index.ts` to change storage and observability.
- Add files or reusable skills under `workspace/` for the agent to use.

## Sprint Release Workflow

This repo includes an `asana-release-notes-workflow` that:

- Reads completed tickets for a sprint from Asana
- Summarizes the sprint into a short release note with bullet points
- Posts the rendered release note to Slack

Required environment variables:

```shell
OPENAI_API_KEY=...
ASANA_ACCESS_TOKEN=...
ASANA_PROGRAMS_PROJECT_GID=...
ASANA_KOACHEX_PROJECT_GID=...
SLACK_PROGRAMS_RELEASE_WEBHOOK_URL=...
SLACK_KOACHEX_RELEASE_WEBHOOK_URL=...
```

- `asanaProject`: dropdown selector for the Asana project, currently `Programs`
- `sprintName`: sprint label to match
- `sprintFieldName`: Asana custom field name for the sprint label, defaults to `Sprints`
- `sprintFieldValue`: optional exact field value when it differs from `sprintName`
- `asanaSectionGid`: optional section filter for the sprint
- `doneSectionName`: section name treated as done when the Asana task itself is not marked completed, defaults to `Done`
- `slackWebhook`: dropdown selector for the Slack destination, currently `Programs`

Run `npm run dev`, open Mastra Studio, and execute the registered workflow with the sprint inputs above.

## Asana Agent

This repo includes an `asana-agent` that acts like a product manager for the Programs and KoachEx Asana boards. It can answer project status questions, summarize what is happening in a board, inspect sprint progress, and search tickets by sprint, status, owner, section, or keyword.

Required environment variables:

```shell
OPENAI_API_KEY=...
ASANA_ACCESS_TOKEN=...
ASANA_PROGRAMS_PROJECT_GID=...
ASANA_KOACHEX_PROJECT_GID=...
```

The agent is read-only. It uses:

- `get_asana_project_status` for project, sprint, section, and assignee summaries
- `query_asana_project_tasks` for specific ticket/status questions

Grant `asana-agent:chat` in Auth0 to let a non-admin user see and chat with this agent.

## KadaKareer Knowledge Agent

This repo also includes a `knowledge-base-agent` (displayed as the KadaKareer Knowledge Agent) that uses an embedding index built from a shared Google Drive folder. It acts as the in-house expert on everything KadaKareer: programs, products, operations, strategy, partnerships, marketing, talent development, and impact reporting.

Required environment variables:

```shell
OPENAI_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DRIVE_FOLDER_ID=...
```

Optional environment variables:

```shell
NEON_DATABASE_URL=postgresql://...
KADAKAREER_EMBEDDING_MODEL=text-embedding-3-small
KADAKAREER_EMBEDDING_DIMENSIONS=1536
KADAKAREER_KNOWLEDGE_INDEX_PATH=.mastra/kadakareer-knowledge-index.json
```

Setup notes:

- Create a Google Cloud OAuth client and generate a refresh token with the `https://www.googleapis.com/auth/drive.readonly` scope
- Alternatively set a short-lived `GOOGLE_DRIVE_ACCESS_TOKEN` instead of the client/refresh token trio
- Set `GOOGLE_DRIVE_FOLDER_ID` to scope searches to your knowledge-base folder, or leave it empty to search all accessible files

How it works:

- `sync_kadakareer_knowledge_index` reads the scoped Drive folder, exports readable docs, chunks them, embeds them, and writes the index to Neon/Postgres when `NEON_DATABASE_URL`, `KADAKAREER_DATABASE_URL`, or `DATABASE_URL` is set
- When no database URL is configured, the same sync tool falls back to `.mastra/kadakareer-knowledge-index.json` for local development
- `search_kadakareer_knowledge_index` searches the embedding index first, so normal questions do not need to traverse Drive
- `search_google_drive_knowledge` runs a full-text Drive search and returns matching files with short excerpts
- `get_google_drive_file_content` exports the full text of a chosen file (Docs, Sheets, Slides, and plain-text files) for answer grounding
- `knowledge-base-agent` uses the embedding index first and falls back to live Drive search when the index is empty or insufficient

After changing Drive docs, refresh the embedding index locally:

```shell
npm run dev
npx mastra api --url http://localhost:4111 tool execute sync_kadakareer_knowledge_index '{"maxFiles":200}'
```

For Neon, create a Postgres database and set `NEON_DATABASE_URL` to the pooled or direct connection string. The sync tool creates the required `vector` extension and the `kadakareer_knowledge_files` / `kadakareer_knowledge_chunks` tables automatically. If the database user cannot create extensions, run this once in Neon SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Run `npm run dev`, open Mastra Studio, select `knowledge-base-agent`, and ask questions like `What programs does KadaKareer run?` or `How does the KadaKareer mentorship program work?`.

## Production Deployment

This project now includes a production deployment path for both the Mastra Server API and hosted Mastra Studio.

Local production commands:

```shell
npm run lint:preflight
npm run deploy
npm run deploy:studio
```

Recommended first-time setup:

1. Copy `.env.production.example` to `.env.production` and fill in the production secrets.
2. Run `npm run lint:preflight` to catch local-file storage or missing env issues before deployment.
3. Run `npm run deploy` to deploy the production Mastra Server.
4. Run `npm run deploy:studio` to deploy the hosted Studio for your team.
5. Commit `.mastra-project.json` so later deploys and CI runs target the same Mastra project.

Notes:

- `mastra deploy` is the recommended production path for new Mastra projects.
- `mastra studio deploy` is still the correct path when you specifically want the hosted Studio UI.
- If Mastra preflight asks to provision a hosted Turso database for `production`, accept it, or run `mastra env db create production --kind turso` and redeploy.
- After the first deploy, prefer managing long-lived production variables from the Mastra platform dashboard instead of local env files.

## GitHub Deploys

This repo includes a GitHub Actions workflow at `.github/workflows/mastra-deploy.yml`.

It deploys on pushes to `main` when Mastra sources or deploy config change, and it can also be run manually from GitHub Actions.

Create these repository secrets before enabling the workflow:

- `MASTRA_API_TOKEN`
- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`
- `ASANA_ACCESS_TOKEN`
- `ASANA_PROGRAMS_PROJECT_GID`
- `ASANA_KOACHEX_PROJECT_GID`
- `SLACK_PROGRAMS_RELEASE_WEBHOOK_URL`
- `SLACK_KOACHEX_RELEASE_WEBHOOK_URL`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

Create the Mastra CI token locally with:

```shell
mastra auth tokens create ci-deploy
```

The workflow uses the committed `.mastra-project.json` file to target this Mastra project automatically.

## Share With Teammates

Hosted Studio access is scoped through your Mastra organization and project, not through a public anonymous URL.

Exact teammate flow:

1. Deploy Studio with `npm run deploy:studio` or let the GitHub workflow publish it.
2. Open the Mastra platform dashboard at `https://projects.mastra.ai`.
3. Go to the organization that owns this project.
4. Invite teammates to that organization from the dashboard settings.
5. Have them sign in to Mastra platform and open the deployed Studio URL.
6. Confirm they can open the same project and use the Studio instance attached to it.

Use hosted Studio for internal team access only. If you need customer-facing access with your own authentication layer, deploy the Mastra Server and put your own app in front of it with auth.

## Learn more

To learn more about Mastra, visit our [documentation](https://mastra.ai/docs/). If you're new to AI agents, check out our [course](https://mastra.ai/learn) and [YouTube videos](https://youtube.com/@mastra-ai). You can also join our [Discord](https://discord.gg/BTYqqHKUrf) community to get help and share your projects.

## Deploy to the Mastra platform

The [Mastra platform](https://projects.mastra.ai) provides two products for deploying and managing AI applications built with the Mastra framework. Learn more in the [Mastra platform documentation](https://mastra.ai/docs/mastra-platform/overview).
