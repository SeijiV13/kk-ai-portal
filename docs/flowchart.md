# Flowcharts

Diagrams for the KadaKareer Copilot Console. See [frontend.md](./frontend.md), [backend.md](./backend.md), [authentication.md](./authentication.md), and [ai-architecture.md](./ai-architecture.md) for the accompanying explanations.

## High-Level Flow

```mermaid
flowchart LR
  User[User] --> FE[Angular Copilot Console]
  FE --> Auth0[Auth0 Login]
  Auth0 --> FE
  FE -->|Bearer token| Runtime[Copilot Runtime + Protected Proxy]
  Runtime -->|verify JWT / permissions| Auth0JWKS[Auth0 JWKS]
  Runtime -->|allowed API calls| Mastra[Mastra API]
  Mastra --> Agent[KadaKareer Knowledge Agent]
  Agent --> Index[Neon pgvector Knowledge Index]
  Agent -->|fallback/sync source| Drive[Google Drive]
```

## Authentication Overview (FE / BE / Tools)

```mermaid
flowchart LR
    subgraph Frontend["Frontend (Angular copilot-console)"]
        direction TB
        FE1["Auth0 SDK\n(provideAuth0)"]
        FE2["HTTP Interceptor\n(attaches Bearer token)"]
        FE3["CopilotKit Chat UI"]
    end

    subgraph Auth0["Auth0 (Identity Provider)"]
        direction TB
        A1["Universal Login"]
        A2["Issues JWT\n(aud + scopes)"]
        A3["JWKS endpoint\n(public keys)"]
    end

    subgraph Backend["Backend API Server (copilot-runtime.ts)"]
        direction TB
        B1["Verify JWT\n(issuer, audience, signature)"]
        B2["Extract permissions\n(scope/roles/claims)"]
        B3["Authorize agent/workflow\naccess"]
        B4["Route to Mastra Agent"]
    end

    subgraph Tools["Mastra Tools (service auth)"]
        direction TB
        T1["Google Drive\n(OAuth2 refresh token)"]
        T2["Asana\n(static API token)"]
        T3["OpenAI\n(API key)"]
    end

    FE1 -- "1. Login" --> A1
    A1 -- "2. Redirect back" --> FE1
    FE1 -- "3. Request token" --> A2
    A2 -- "4. JWT access token" --> FE2
    FE2 -- "5. Bearer <JWT>" --> B1
    B1 -. "verify signature" .-> A3
    B1 --> B2 --> B3 --> B4
    B4 --> T1
    B4 --> T2
    B4 --> T3
    T1 --> FE3
    T2 --> FE3
    T3 --> FE3
```

## RBAC Flow

```mermaid
flowchart TD
  Login[User logs in with Auth0] --> Token[Auth0 access token]
  Token --> FEParse[Frontend decodes token]
  Token --> RuntimeVerify[Runtime verifies token signature/audience]

  FEParse --> UI{Permission check}
  UI -->|knowledge-agent:chat| ShowKA[Show Knowledge Agent]
  UI -->|release-notes:execute| ShowRN[Show Release Notes Workflow]
  UI -->|admin| ShowAll[Show all user-facing resources]

  RuntimeVerify --> API{Backend permission check}
  API -->|allowed| Forward[Forward to Mastra]
  API -->|denied| Deny[403 Forbidden]
```

## Knowledge Query Flow

```mermaid
sequenceDiagram
  participant User
  participant Console as Angular Console
  participant Runtime as Protected Copilot Runtime
  participant Agent as Knowledge Agent
  participant Neon as Neon pgvector
  participant Drive as Google Drive

  User->>Console: Ask question
  Console->>Runtime: Chat request with x-auth0-token
  Runtime->>Runtime: Verify Auth0 JWT and permissions
  Runtime->>Agent: Forward authorized chat request
  Agent->>Neon: search_kadakareer_knowledge_index
  Neon-->>Agent: relevant chunks + sources
  opt Index insufficient
    Agent->>Drive: fallback live Drive search/read
    Drive-->>Agent: source content
  end
  Agent-->>Runtime: grounded answer
  Runtime-->>Console: streamed response
```
