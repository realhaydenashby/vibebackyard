# Agency Architecture Technical Feasibility Plan

> RFC Analysis and Implementation Roadmap for the "Tethered Preview" Architecture

---

## Executive Summary

**Verdict: FEASIBLE with caveats**

The "Agency" architecture is technically achievable within the existing VibeSDK codebase. The core infrastructure (secrets vault, OAuth, WebSocket messaging, template system) already exists. However, several gaps require new implementation work, and one critical assumption in the RFC needs correction.

---

## 1. The Tunnel Test: Critical Feasibility Analysis

### 1.1 Can the Sandbox Call Back to the Agent DO?

**Answer: YES, but not directly.**

The sandbox runs in an isolated `@cloudflare/sandbox` environment. It cannot directly invoke the Agent's Durable Object. However, the sandbox CAN make HTTP requests to any URL.

**The Solution: HTTP Proxy Route**

```
┌─────────────────────────────────────────────────────────────────────┐
│  SANDBOX (Preview App)                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  fetch(`https://${AGENT_URL}/api/proxy/plaid/transactions`) │    │
│  │  Headers: { "X-Preview-Session": previewToken }             │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  MAIN WORKER (worker/index.ts)                                      │
│  Route: /api/proxy/:service/:endpoint                               │
│  1. Validate X-Preview-Session token                                │
│  2. Lookup agentId from token                                       │
│  3. Forward to Agent DO                                             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  AGENT DURABLE OBJECT (CodeGeneratorAgent)                          │
│  1. Retrieve secret from UserSecretsStore                           │
│  2. Call external API (Plaid, Stripe)                               │
│  3. Return sanitized JSON                                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Files to Modify:**
- `worker/index.ts` - Add route handler for `/api/proxy/*`
- `worker/agents/core/codingAgent.ts` - Add `handleProxyRequest()` method
- New: `worker/api/routes/proxyRoutes.ts` - Proxy route definitions

### 1.2 Preview Token Generation

The sandbox already receives environment variables during bootstrap:

```typescript
// From: worker/services/sandbox/sandboxTypes.ts:56
export const InstanceCreationRequestSchema = z.object({
    files: z.array(TemplateFileSchema),
    projectName: z.string(),
    webhookUrl: z.string().url().optional(),
    envVars: z.record(z.string(), z.string()).optional(),  // <-- THIS
    initCommand: z.string().default('bun run dev'),
})
```

We can inject `VITE_AGENT_URL` and `VITE_PREVIEW_SESSION_TOKEN` here.

**Implementation:**
```typescript
// In DeploymentManager.deployToSandbox()
const previewToken = generatePreviewToken(this.getAgentId());
const envVars = {
    VITE_AGENT_URL: `https://${env.CUSTOM_DOMAIN}`,
    VITE_PREVIEW_SESSION_TOKEN: previewToken,
};
```

---

## 2. Phase-by-Phase Implementation Analysis

### Phase 1: Core Infrastructure (The Proxy Tunnel)

#### 2.1.1 New Route: `/api/proxy/:service/:endpoint`

**Location:** `worker/api/routes/proxyRoutes.ts` (new file)

```typescript
import { Hono } from 'hono';
import { getAgentStub } from '../../agents';

export function registerProxyRoutes(app: Hono<{ Bindings: Env }>) {
    // Proxy route for preview apps to call external services
    app.all('/api/proxy/:service/*', async (c) => {
        const previewToken = c.req.header('X-Preview-Session');
        if (!previewToken) {
            return c.json({ error: 'Missing preview token' }, 401);
        }

        // Validate token and extract agentId
        const agentId = await validatePreviewToken(c.env, previewToken);
        if (!agentId) {
            return c.json({ error: 'Invalid preview token' }, 403);
        }

        // Forward to agent
        const agentStub = await getAgentStub(c.env, agentId);
        return agentStub.handleProxyRequest(c.req.raw);
    });
}
```

**Effort:** 1-2 days

#### 2.1.2 Agent Proxy Handler

**Location:** `worker/agents/core/codingAgent.ts`

```typescript
async handleProxyRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const service = pathParts[3]; // 'plaid', 'stripe', etc.
    const endpoint = pathParts.slice(4).join('/');

    // Get secret from UserSecretsStore
    const secretsClient = this.getSecretsClient();
    const accessToken = await secretsClient.get({ provider: service });

    if (!accessToken) {
        return new Response(JSON.stringify({
            error: `No ${service} credentials configured`
        }), { status: 400 });
    }

    // Route to appropriate service handler
    switch (service) {
        case 'plaid':
            return this.handlePlaidProxy(endpoint, accessToken, request);
        case 'stripe':
            return this.handleStripeProxy(endpoint, accessToken, request);
        default:
            return new Response(JSON.stringify({
                error: `Unknown service: ${service}`
            }), { status: 400 });
    }
}
```

**Effort:** 2-3 days

#### 2.1.3 Preview Token System

**Location:** New `worker/services/preview-token/` directory

```typescript
// preview-token/generator.ts
import { SignJWT, jwtVerify } from 'jose';

export async function generatePreviewToken(
    agentId: string,
    env: Env
): Promise<string> {
    const secret = new TextEncoder().encode(env.PREVIEW_TOKEN_SECRET);
    return new SignJWT({ agentId })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);
}

export async function validatePreviewToken(
    env: Env,
    token: string
): Promise<string | null> {
    try {
        const secret = new TextEncoder().encode(env.PREVIEW_TOKEN_SECRET);
        const { payload } = await jwtVerify(token, secret);
        return payload.agentId as string;
    } catch {
        return null;
    }
}
```

**Effort:** 1 day

---

### Phase 2: The "Agency" Template

#### 2.2.1 Template Structure

**New Directory:** `templates/definitions/agency-fintech-preview/`

```
agency-fintech-preview/
├── prompts/
│   ├── selection.md      # When to use this template
│   └── usage.md          # LLM instructions (CRITICAL)
├── src/
│   └── lib/
│       └── agency-api.ts # LOCKED infrastructure file
├── shared/
│   └── types.ts
├── worker/
│   └── user-routes.ts
└── wrangler.jsonc
```

#### 2.2.2 The Locked API Client

**File:** `templates/definitions/agency-fintech-preview/src/lib/agency-api.ts`

```typescript
// src/lib/agency-api.ts
// THIS FILE IS INFRASTRUCTURE - AI MUST NOT MODIFY

const AGENT_URL = import.meta.env.VITE_AGENT_URL;
const PREVIEW_TOKEN = import.meta.env.VITE_PREVIEW_SESSION_TOKEN;

export interface AgencyResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export async function agencyFetch<T>(
    service: string,
    endpoint: string,
    options?: RequestInit
): Promise<AgencyResponse<T>> {
    if (!AGENT_URL || !PREVIEW_TOKEN) {
        console.warn('Agency API not configured - using mock mode');
        return { success: false, error: 'Agency not configured' };
    }

    try {
        const response = await fetch(
            `${AGENT_URL}/api/proxy/${service}/${endpoint}`,
            {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Preview-Session': PREVIEW_TOKEN,
                    ...options?.headers,
                },
            }
        );

        if (!response.ok) {
            const error = await response.json();
            return { success: false, error: error.message || 'Request failed' };
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Network error'
        };
    }
}

// Convenience wrappers
export const plaid = {
    getTransactions: (startDate: string, endDate: string) =>
        agencyFetch<PlaidTransaction[]>('plaid', `transactions?start=${startDate}&end=${endDate}`),
    getAccounts: () =>
        agencyFetch<PlaidAccount[]>('plaid', 'accounts'),
    getBalance: () =>
        agencyFetch<PlaidBalance>('plaid', 'balance'),
};

export const stripe = {
    getCharges: (limit?: number) =>
        agencyFetch<StripeCharge[]>('stripe', `charges?limit=${limit || 10}`),
    getSubscriptions: () =>
        agencyFetch<StripeSubscription[]>('stripe', 'subscriptions'),
};
```

#### 2.2.3 Lock File Configuration

**Add to:** `templates/reference/vite-reference/.donttouch_files.json`

```json
[
    "wrangler.jsonc",
    "wrangler.toml",
    "package.json",
    "src/lib/agency-api.ts",  // NEW - locked for Agency templates
    // ... existing entries
]
```

**Effort:** 2 days

---

### Phase 3: The "Configuration" State Machine

#### 2.3.1 New State: `PHASE_CONFIGURING`

**File:** `worker/agents/core/state.ts`

```typescript
export enum CurrentDevState {
    IDLE,
    PHASE_CONFIGURING,    // NEW: Awaiting user configuration
    PHASE_GENERATING,
    PHASE_IMPLEMENTING,
    REVIEWING,
    FINALIZING,
}

// Add to PhasicState
export interface PhasicState extends BaseProjectState {
    // ... existing fields

    // Agency configuration
    pendingConfiguration?: {
        requiredServices: string[];  // ['plaid', 'stripe']
        configuredServices: string[];
        configCardId: string;
    };
}
```

#### 2.3.2 State Machine Modification

**File:** `worker/agents/core/behaviors/phasic.ts`

```typescript
private async launchStateMachine() {
    // ... existing setup code

    while (currentDevState !== CurrentDevState.IDLE) {
        switch (currentDevState) {
            case CurrentDevState.PHASE_CONFIGURING:
                currentDevState = await this.executeConfigurationPhase();
                break;
            case CurrentDevState.PHASE_GENERATING:
                // Check if configuration is needed before generating
                if (await this.needsConfiguration()) {
                    currentDevState = CurrentDevState.PHASE_CONFIGURING;
                    break;
                }
                executionResults = await this.executePhaseGeneration();
                // ... rest of existing code
        }
    }
}

private async needsConfiguration(): Promise<boolean> {
    // Analyze blueprint for external service requirements
    const blueprint = this.state.blueprint;
    const detectedServices = this.detectRequiredServices(blueprint);

    if (detectedServices.length === 0) return false;

    // Check if services are already configured
    const secretsClient = this.getSecretsClient();
    for (const service of detectedServices) {
        const hasSecret = await secretsClient.has({ provider: service });
        if (!hasSecret) return true;
    }

    return false;
}

private async executeConfigurationPhase(): Promise<CurrentDevState> {
    const detectedServices = this.detectRequiredServices(this.state.blueprint);
    const unconfiguredServices: string[] = [];

    const secretsClient = this.getSecretsClient();
    for (const service of detectedServices) {
        if (!await secretsClient.has({ provider: service })) {
            unconfiguredServices.push(service);
        }
    }

    if (unconfiguredServices.length === 0) {
        return CurrentDevState.PHASE_GENERATING;
    }

    // Emit configuration card
    const configCardId = `config-${Date.now()}`;
    this.broadcast(WebSocketMessageResponses.CONFIGURATION_CARD, {
        cardId: configCardId,
        title: 'Connect External Services',
        message: 'To build with real data, please connect the following services:',
        services: unconfiguredServices.map(s => ({
            id: s,
            name: this.getServiceDisplayName(s),
            type: this.getServiceAuthType(s), // 'oauth' | 'api_key'
            status: 'pending',
        })),
        actions: [
            { id: 'skip', label: 'Skip - Use Mock Data', variant: 'secondary' },
            { id: 'continue', label: 'Continue with Connected Services', variant: 'primary' },
        ],
    });

    // Store pending configuration
    this.setState({
        ...this.state,
        pendingConfiguration: {
            requiredServices: unconfiguredServices,
            configuredServices: [],
            configCardId,
        },
    });

    // Pause generation - wait for user action
    return CurrentDevState.IDLE;
}
```

#### 2.3.3 WebSocket Message Types

**File:** `worker/api/websocketTypes.ts`

```typescript
// Add new message types
export type ConfigurationCardMessage = {
    type: 'configuration_card';
    cardId: string;
    title: string;
    message: string;
    services: Array<{
        id: string;
        name: string;
        type: 'oauth' | 'api_key';
        status: 'pending' | 'connected' | 'failed';
    }>;
    actions: Array<{
        id: string;
        label: string;
        variant: 'primary' | 'secondary' | 'destructive';
    }>;
};

export type ConfigurationResponseMessage = {
    type: 'configuration_response';
    cardId: string;
    action: 'skip' | 'continue' | 'service_connected';
    serviceId?: string;
};
```

**Effort:** 3-4 days

---

### Phase 4: The Ejection Strategy

#### 2.4.1 Current Export Mechanism

The codebase already has deployment and export capabilities:

- **Sandbox Deploy:** `DeploymentManager.deployToSandbox()`
- **Cloudflare Deploy:** `DeploymentManager.deployToCloudflare()` via Workers for Platforms
- **GitHub Export:** `ProjectObjective.exportToGitHub()`

#### 2.4.2 Ejection Refactor Operation

**New File:** `worker/agents/operations/EjectionRefactor.ts`

```typescript
export class EjectionRefactorOperation implements AgentOperation<EjectionContext, EjectionResult> {
    async execute(options: OperationOptions<EjectionContext>): Promise<EjectionResult> {
        const { agent, context, logger } = options;

        // 1. Rewrite agency-api.ts to direct API calls
        const rewrittenApiClient = await this.generateDirectApiClient(context);

        // 2. Generate secrets configuration
        const secretsConfig = await this.generateSecretsConfig(context);

        // 3. Update wrangler.jsonc with secrets bindings
        const wranglerConfig = await this.updateWranglerConfig(context);

        // 4. Save files
        await agent.fileManager.saveGeneratedFiles([
            { filePath: 'src/lib/api.ts', fileContents: rewrittenApiClient },
            { filePath: '.dev.vars.example', fileContents: secretsConfig },
            { filePath: 'wrangler.jsonc', fileContents: wranglerConfig },
        ], 'Eject from Agency mode to standalone deployment');

        return {
            success: true,
            files: ['src/lib/api.ts', '.dev.vars.example', 'wrangler.jsonc'],
        };
    }

    private async generateDirectApiClient(context: EjectionContext): Promise<string> {
        // LLM generates direct Plaid/Stripe SDK calls
        // instead of tunneling through Agency proxy
        return `
// src/lib/api.ts
// Standalone mode - direct API calls

import Plaid from 'plaid';

const plaidClient = new Plaid.PlaidApi({
    basePath: Plaid.PlaidEnvironments.sandbox,
    baseOptions: {
        headers: {
            'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
            'PLAID-SECRET': process.env.PLAID_SECRET,
        },
    },
});

export const plaid = {
    getTransactions: async (accessToken: string, startDate: string, endDate: string) => {
        const response = await plaidClient.transactionsGet({
            access_token: accessToken,
            start_date: startDate,
            end_date: endDate,
        });
        return response.data.transactions;
    },
};
`;
    }
}
```

**Effort:** 3-4 days

---

## 3. Technical Risks and Blockers

### 3.1 CRITICAL: Cross-Origin Requests from Sandbox

**Risk:** The sandbox runs on a different subdomain (e.g., `session-xyz.build.cloudflare.dev`). Requests to the main domain (`build.cloudflare.dev`) may be blocked by CORS.

**Mitigation:**
- Already handled in `worker/index.ts:setOriginControl()` which dynamically sets `Access-Control-Allow-Origin`
- Add sandbox subdomains to `isOriginAllowed()` function

```typescript
// worker/config/security.ts
export function isOriginAllowed(env: Env, origin: string): boolean {
    const previewDomain = getPreviewDomain(env);
    // Allow any subdomain of the preview domain (sandbox sessions)
    if (origin.endsWith(`.${previewDomain}`)) {
        return true;
    }
    // ... existing checks
}
```

### 3.2 HIGH: Secret Access Timing

**Risk:** The `UserSecretsStore` requires vault unlock. If the user's vault is locked when the proxy request arrives, the request fails.

**Mitigation Options:**
1. **Session Tokens:** Cache decrypted secrets in Agent DO memory during active session
2. **Vault Keepalive:** Frontend sends periodic unlock refreshes
3. **Graceful Degradation:** Return mock data if vault is locked

**Recommended:** Option 1 - Cache secrets in memory with 15-minute TTL.

### 3.3 MEDIUM: OAuth Token Refresh

**Risk:** Plaid/Stripe tokens may expire. Generated apps need refresh logic.

**Mitigation:**
- Proxy handler checks token validity before forwarding
- If expired, return `{ error: 'token_expired', action: 'reconnect' }`
- Frontend shows "Reconnect Service" card

### 3.4 MEDIUM: Sandbox Environment Variable Injection

**Risk:** Environment variables are only injected at sandbox creation time. If the user connects a service AFTER the sandbox is running, the token won't be available.

**Mitigation:**
- Don't inject token into sandbox env vars
- Always tunnel through proxy (token stored in Agent DO, not sandbox)
- Proxy validates session token, not the actual API token

### 3.5 LOW: Rate Limiting

**Risk:** External APIs (Plaid, Stripe) have rate limits. Multiple users hitting the same credentials could exhaust limits.

**Mitigation:**
- Per-user credentials (not shared platform credentials)
- Caching layer in proxy handler
- Rate limit proxy requests per agent session

---

## 4. Implementation Roadmap

### Week 1: Tunnel Test (Proof of Concept)

| Day | Task | Output |
|-----|------|--------|
| 1-2 | Add `/api/proxy/hello` route to main worker | Route returns `{ message: "Hello from Agent" }` |
| 2-3 | Add `handleProxyRequest()` to `CodeGeneratorAgent` | Agent can handle proxied requests |
| 3-4 | Implement preview token generation/validation | Secure token system working |
| 4-5 | Inject env vars into sandbox creation | Sandbox has `VITE_AGENT_URL` and `VITE_PREVIEW_SESSION_TOKEN` |
| 5 | Create test template with fetch call | End-to-end tunnel working |

**Success Criteria:** A generated preview app can fetch JSON from the Agent DO.

### Week 2: Configuration State Machine

| Day | Task | Output |
|-----|------|--------|
| 1 | Add `PHASE_CONFIGURING` state | State machine compiles |
| 1-2 | Add `configuration_card` WebSocket message type | Types defined |
| 2-3 | Implement `executeConfigurationPhase()` | Agent can pause for config |
| 3-4 | Build Configuration Card UI component | Frontend shows config card |
| 4-5 | Wire up service connection flow | User can connect OAuth service |

**Success Criteria:** Generation pauses to show "Connect Plaid" card; user connects; generation resumes.

### Week 3: Agency Template + Plaid Integration

| Day | Task | Output |
|-----|------|--------|
| 1-2 | Create `agency-fintech-preview` template | Template exists with locked API client |
| 2-3 | Add Plaid OAuth provider | `/oauth/plaid/callback` works |
| 3-4 | Implement Plaid proxy handler | Agent can call Plaid API |
| 4-5 | Generate Plaid dashboard as test | Real transactions appear in preview |

**Success Criteria:** User says "Build me a spend dashboard", connects Plaid Sandbox, sees real (sandbox) transaction data.

### Week 4: Ejection + Polish

| Day | Task | Output |
|-----|------|--------|
| 1-2 | Implement `EjectionRefactorOperation` | Agent can rewrite API client |
| 2-3 | Test full ejection flow | Ejected app deploys standalone |
| 3-4 | Error handling and edge cases | Graceful failures |
| 4-5 | Documentation and cleanup | Ready for internal testing |

**Success Criteria:** User can "eject" to a standalone Cloudflare Worker with direct Plaid integration.

---

## 5. Open Questions for Product Decision

1. **Sandbox vs Production Credentials**
   - Should users ONLY connect sandbox credentials initially?
   - Production mode = explicit opt-in with warnings?

2. **Service Selection UI**
   - Should the Configuration Card be in the chat, or a modal?
   - Multiple services at once, or one-by-one?

3. **Fallback Behavior**
   - If user clicks "Skip - Use Mock Data", do we generate mock data?
   - Or do we generate real API calls that fail gracefully?

4. **Ejection Trigger**
   - Explicit "Eject" button?
   - Automatic on "Deploy to Cloudflare"?
   - Offer both?

5. **Pricing/Metering**
   - Does Agency mode count against generation limits?
   - Do proxy API calls count separately?

---

## 6. Conclusion

The "Agency" architecture is **technically feasible** and aligns well with the existing codebase. The main implementation effort centers on:

1. **Proxy Tunnel** (Week 1) - New route + handler + token system
2. **Configuration State** (Week 2) - State machine + UI
3. **Template + Integration** (Week 3) - Locked API client + OAuth
4. **Ejection** (Week 4) - Refactor operation

**Total Estimated Effort:** 4 weeks for a production-ready v1 with Plaid Sandbox support.

**Recommended First Step:** The "Tunnel Test" (Day 1-5 of Week 1) to validate the core assumption before committing to the full implementation.
