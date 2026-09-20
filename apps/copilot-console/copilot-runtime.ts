// @ts-nocheck
import { createServer } from 'node:http';
import { CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotNodeListener } from '@copilotkit/runtime/v2/node';
import { MastraAgent } from '@ag-ui/mastra';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

import { mastra } from '../../src/mastra/index';
import { auth0Config } from './src/app/auth0.config';

const agents = {
  default: new MastraAgent({ agent: mastra.getAgent('knowledgeBaseAgent') }),
  'knowledge-base-agent': new MastraAgent({ agent: mastra.getAgent('knowledgeBaseAgent') }),
  'asana-agent': new MastraAgent({ agent: mastra.getAgent('asanaAgent') }),
  'release-notes-agent': new MastraAgent({ agent: mastra.getAgent('releaseNotesAgent') }),
};

const runtime = new CopilotRuntime({ agents });
const port = Number(process.env['COPILOT_RUNTIME_PORT'] ?? 8200);
const mastraApiBaseUrl = process.env['MASTRA_API_BASE_URL'] ?? 'http://localhost:4111/api';
const allowedOrigins = [
  'https://front-end-production-56ea.up.railway.app',
  'http://localhost:4200',
];
const auth0Issuer = `https://${auth0Config.domain}/`;
const jwks = createRemoteJWKSet(new URL(`${auth0Issuer}.well-known/jwks.json`));
const permissions = {
  admin: 'admin',
  knowledgeChat: 'knowledge-agent:chat',
  asanaChat: 'asana-agent:chat',
  releaseNotesExecute: 'release-notes:execute',
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'access-control-allow-headers': 'authorization,content-type,x-auth0-token',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'content-type': 'application/json',
  });
  response.end(JSON.stringify(payload));
}

function getTokenDiagnostics(token) {
  try {
    const claims = decodeJwt(token);
    return {
      expectedIssuer: auth0Issuer,
      expectedAudience: auth0Config.audience,
      tokenIssuer: claims.iss,
      tokenAudience: claims.aud,
      tokenExpiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
      tokenSubject: claims.sub,
    };
  } catch {
    return {
      expectedIssuer: auth0Issuer,
      expectedAudience: auth0Config.audience,
      tokenFormat: 'not a decodable JWT',
    };
  }
}

async function verifyBearerToken(token) {
  return jwtVerify(token, jwks, {
    issuer: auth0Issuer,
    audience: auth0Config.audience,
  });
}

function getTokenFromRequest(request) {
  const authorization = request.headers.authorization ?? '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : (request.headers['x-auth0-token'] ?? '');
}

function getPermissionSet(payload) {
  const namespaces = [`${auth0Config.audience}/`, 'https://kadakareer.com/'];
  return new Set([
    ...(Array.isArray(payload.permissions) ? payload.permissions : []),
    ...(Array.isArray(payload.roles) ? payload.roles : []),
    ...namespaces.flatMap(namespace => Array.isArray(payload[`${namespace}permissions`]) ? payload[`${namespace}permissions`] : []),
    ...namespaces.flatMap(namespace => Array.isArray(payload[`${namespace}roles`]) ? payload[`${namespace}roles`] : []),
    ...(typeof payload.scope === 'string' ? payload.scope.split(' ') : []),
  ]);
}

function getClaimSummary(payload) {
  const namespace = `${auth0Config.audience}/`;
  const legacyNamespace = 'https://kadakareer.com/';
  return {
    scope: payload.scope ?? null,
    permissions: payload.permissions ?? null,
    roles: payload.roles ?? null,
    namespacedPermissions: payload[`${namespace}permissions`] ?? null,
    namespacedRoles: payload[`${namespace}roles`] ?? null,
    legacyNamespacedPermissions: payload[`${legacyNamespace}permissions`] ?? null,
    legacyNamespacedRoles: payload[`${legacyNamespace}roles`] ?? null,
  };
}

function hasPermission(payload, permission) {
  const userPermissions = getPermissionSet(payload);
  return userPermissions.has(permissions.admin) || userPermissions.has(permission);
}

function canAccessAgent(payload, agentId) {
  if (hasPermission(payload, permissions.admin)) {
    return true;
  }

  return (
    (agentId === 'knowledge-base-agent' && hasPermission(payload, permissions.knowledgeChat)) ||
    (agentId === 'asana-agent' && hasPermission(payload, permissions.asanaChat))
  );
}

function canAccessWorkflow(payload, workflowId) {
  if (hasPermission(payload, permissions.admin)) {
    return true;
  }

  return ['asanaReleaseNotesWorkflow', 'asana-release-notes-workflow'].includes(workflowId)
    && hasPermission(payload, permissions.releaseNotesExecute);
}

function filterAgentsByPermissions(payload, agentsPayload) {
  if (Array.isArray(agentsPayload)) {
    return agentsPayload.filter(agent => canAccessAgent(payload, agent.id));
  }

  return Object.fromEntries(
    Object.entries(agentsPayload).filter(([agentKey, agent]) => canAccessAgent(payload, agent?.id ?? agentKey)),
  );
}

function filterWorkflowsByPermissions(payload, workflowsPayload) {
  if (Array.isArray(workflowsPayload)) {
    return workflowsPayload.filter(workflow => canAccessWorkflow(payload, workflow.workflowId ?? workflow.id ?? workflow.name));
  }

  return Object.fromEntries(
    Object.entries(workflowsPayload).filter(([workflowKey, workflow]) =>
      canAccessWorkflow(payload, workflow?.workflowId ?? workflow?.id ?? workflow?.name ?? workflowKey),
    ),
  );
}

async function getVerifiedPayload(request, response) {
  const token = getTokenFromRequest(request);

  if (!token) {
    sendJson(response, 401, { error: 'Missing bearer token.' });
    return null;
  }

  try {
    const { payload } = await verifyBearerToken(token);
    return payload;
  } catch (error) {
    sendJson(response, 401, {
      error: 'Invalid or expired bearer token.',
      details: error instanceof Error ? error.message : 'Token verification failed.',
      diagnostics: getTokenDiagnostics(token),
    });
    return null;
  }
}

async function requireAuth(request, response) {
  return Boolean(await getVerifiedPayload(request, response));
}

async function sendAuthDiagnostics(request, response) {
  const token = getTokenFromRequest(request);

  if (!token) {
    sendJson(response, 401, { error: 'Missing bearer token.' });
    return;
  }

  try {
    const { payload } = await verifyBearerToken(token);
    sendJson(response, 200, {
      ok: true,
      diagnostics: getTokenDiagnostics(token),
      permissions: [...getPermissionSet(payload)],
      claims: getClaimSummary(payload),
      allowedAgents: ['knowledge-base-agent', 'asana-agent', 'release-notes-agent'].filter(agentId => canAccessAgent(payload, agentId)),
      allowedWorkflows: ['asanaReleaseNotesWorkflow', 'knowledge-base-agent-input-processor'].filter(workflowId =>
        canAccessWorkflow(payload, workflowId),
      ),
    });
  } catch (error) {
    sendJson(response, 401, {
      ok: false,
      error: 'Invalid or expired bearer token.',
      details: error instanceof Error ? error.message : 'Token verification failed.',
      diagnostics: getTokenDiagnostics(token),
    });
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyMastraApi(request, response) {
  const payload = await getVerifiedPayload(request, response);
  if (!payload) {
    return;
  }

  const sourceUrl = new URL(request.url ?? '/', `http://localhost:${port}`);
  const targetPath = sourceUrl.pathname.replace(/^\/api\/mastra/, '');

  const workflowMatch = targetPath.match(/^\/workflows\/([^/]+)/);
  if (workflowMatch && !canAccessWorkflow(payload, decodeURIComponent(workflowMatch[1]))) {
    sendJson(response, 403, { error: 'Missing required permission: release-notes:execute.' });
    return;
  }

  const targetUrl = `${mastraApiBaseUrl}${targetPath}${sourceUrl.search}`;
  const body = ['GET', 'HEAD'].includes(request.method ?? '') ? undefined : await readBody(request);
  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers: {
      'content-type': request.headers['content-type'] ?? 'application/json',
    },
    body,
  });

  if (sourceUrl.pathname === '/api/mastra/agents' && upstream.ok) {
    let agentsPayload = filterAgentsByPermissions(payload, await upstream.json());
    const excludedAgentIds = sourceUrl.searchParams
      .get('excludeAgentIds')
      ?.split(',')
      .map(agentId => agentId.trim())
      .filter(Boolean) ?? [];

    if (excludedAgentIds.length > 0) {
      if (Array.isArray(agentsPayload)) {
        sendJson(response, upstream.status, agentsPayload.filter(agent => !excludedAgentIds.includes(agent.id)));
        return;
      }

      for (const [agentKey, agent] of Object.entries(agentsPayload)) {
        if (excludedAgentIds.includes(agentKey) || excludedAgentIds.includes(agent?.id)) {
          delete agentsPayload[agentKey];
        }
      }
    }

    sendJson(response, upstream.status, agentsPayload);
    return;
  }

  if (sourceUrl.pathname === '/api/mastra/workflows' && upstream.ok) {
    let workflowsPayload = filterWorkflowsByPermissions(payload, await upstream.json());
    const excludedWorkflowIds = sourceUrl.searchParams
      .get('excludeWorkflowIds')
      ?.split(',')
      .map(workflowId => workflowId.trim())
      .filter(Boolean) ?? [];

    if (excludedWorkflowIds.length > 0) {
      if (Array.isArray(workflowsPayload)) {
        sendJson(
          response,
          upstream.status,
          workflowsPayload.filter(workflow => !excludedWorkflowIds.includes(workflow.workflowId ?? workflow.id ?? workflow.name)),
        );
        return;
      }

      for (const [workflowKey, workflow] of Object.entries(workflowsPayload)) {
        if (
          excludedWorkflowIds.includes(workflowKey) ||
          excludedWorkflowIds.includes(workflow?.workflowId) ||
          excludedWorkflowIds.includes(workflow?.id) ||
          excludedWorkflowIds.includes(workflow?.name)
        ) {
          delete workflowsPayload[workflowKey];
        }
      }
    }

    sendJson(response, upstream.status, workflowsPayload);
    return;
  }

  response.writeHead(upstream.status, {
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function requireAuthHeader(request, response) {
  const payload = await getVerifiedPayload(request, response);
  if (!payload) {
    return false;
  }

  const pathname = new URL(request.url ?? '/', `http://localhost:${port}`).pathname;
  const agentId = pathname.match(/^\/api\/copilotkit\/agent\/([^/]+)/)?.[1];
  if (agentId && !canAccessAgent(payload, decodeURIComponent(agentId))) {
    sendJson(response, 403, { error: 'Missing required agent chat permission.' });
    return false;
  }

  return true;
}

const copilotListener = createCopilotNodeListener({
  runtime,
  basePath: '/api/copilotkit',
  cors: {
    origin: allowedOrigins,
    allowHeaders: ['authorization', 'content-type', 'x-auth0-token'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  },
});

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://localhost:${port}`).pathname;
  const requestOrigin = request.headers.origin;

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    response.setHeader('access-control-allow-origin', requestOrigin);
    response.setHeader('vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (pathname.startsWith('/api/auth/diagnostics')) {
    await sendAuthDiagnostics(request, response);
    return;
  }

  if (pathname.startsWith('/api/mastra')) {
    await proxyMastraApi(request, response);
    return;
  }

  if (pathname.startsWith('/api/copilotkit') && pathname !== '/api/copilotkit/info') {
    if (!(await requireAuthHeader(request, response))) {
      return;
    }

    copilotListener(request, response);
    return;
  }

  if (pathname.startsWith('/api/copilotkit')) {
    copilotListener(request, response);
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}).listen(port, () => {
  console.log(`Protected Copilot Runtime listening at http://localhost:${port}`);
});