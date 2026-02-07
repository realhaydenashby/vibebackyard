/**
 * Plaid Proxy Routes
 *
 * These routes provide a tunnel between generated preview apps and Plaid API.
 * The preview app calls these endpoints, and the Agent DO handles the actual
 * Plaid API calls using credentials stored in the platform environment.
 *
 * Flow:
 * 1. Preview App calls /api/proxy/plaid/* with X-Preview-Token header
 * 2. We validate the token and extract the agentId
 * 3. We forward the request to the Agent DO
 * 4. Agent DO calls Plaid API and stores/retrieves access tokens
 */

import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { getAgentStub } from '../../agents';
import { createLogger } from '../../logger';
import { getPreviewDomain } from '../../utils/urls';

const logger = createLogger('PlaidProxy');

// Plaid API base URLs
const PLAID_SANDBOX_URL = 'https://sandbox.plaid.com';
const PLAID_DEVELOPMENT_URL = 'https://development.plaid.com';
const PLAID_PRODUCTION_URL = 'https://production.plaid.com';

interface PlaidLinkTokenResponse {
    link_token: string;
    expiration: string;
    request_id: string;
}

interface PlaidExchangeResponse {
    access_token: string;
    item_id: string;
    request_id: string;
}

interface PlaidTransactionsSyncResponse {
    added: PlaidTransaction[];
    modified: PlaidTransaction[];
    removed: { transaction_id: string }[];
    next_cursor: string;
    has_more: boolean;
    request_id: string;
}

interface PlaidTransaction {
    transaction_id: string;
    account_id: string;
    amount: number;
    date: string;
    name: string;
    merchant_name?: string;
    category?: string[];
    pending: boolean;
}

interface PlaidAccountsResponse {
    accounts: PlaidAccount[];
    item: { item_id: string };
    request_id: string;
}

interface PlaidAccount {
    account_id: string;
    balances: {
        available: number | null;
        current: number | null;
        limit: number | null;
        iso_currency_code: string | null;
    };
    mask: string | null;
    name: string;
    official_name: string | null;
    type: string;
    subtype: string | null;
}

/**
 * Get Plaid API base URL based on environment
 */
function getPlaidBaseUrl(env: Env): string {
    const plaidEnv = env.PLAID_ENV || 'sandbox';
    switch (plaidEnv) {
        case 'production':
            return PLAID_PRODUCTION_URL;
        case 'development':
            return PLAID_DEVELOPMENT_URL;
        default:
            return PLAID_SANDBOX_URL;
    }
}

/**
 * Validate preview token and extract agentId
 * For now, we use a simple format: agentId.signature
 * In production, this should use JWT with proper signing
 */
async function validatePreviewToken(env: Env, token: string): Promise<string | null> {
    if (!token) return null;

    try {
        // Simple format for MVP: base64(agentId).timestamp.signature
        // The signature is HMAC-SHA256(agentId + timestamp, JWT_SECRET)
        const parts = token.split('.');
        if (parts.length !== 3) {
            logger.warn('Invalid token format');
            return null;
        }

        const [encodedAgentId, timestamp, signature] = parts;
        const agentId = atob(encodedAgentId);

        // Validate timestamp (token valid for 24 hours)
        const tokenTime = parseInt(timestamp, 10);
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        if (isNaN(tokenTime) || now - tokenTime > maxAge) {
            logger.warn('Token expired', { tokenTime, now });
            return null;
        }

        // Validate signature
        const secret = env.JWT_SECRET;
        if (!secret) {
            logger.error('JWT_SECRET not configured');
            return null;
        }

        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign', 'verify']
        );

        const data = encoder.encode(`${agentId}.${timestamp}`);
        const expectedSignature = await crypto.subtle.sign('HMAC', key, data);
        const expectedSignatureBase64 = btoa(String.fromCharCode(...new Uint8Array(expectedSignature)));

        if (signature !== expectedSignatureBase64) {
            logger.warn('Invalid token signature');
            return null;
        }

        return agentId;
    } catch (error) {
        logger.error('Token validation error', error);
        return null;
    }
}

/**
 * Generate a preview token for an agent
 */
export async function generatePreviewToken(env: Env, agentId: string): Promise<string> {
    const timestamp = Date.now().toString();
    const encodedAgentId = btoa(agentId);

    const secret = env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET not configured');
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const data = encoder.encode(`${agentId}.${timestamp}`);
    const signature = await crypto.subtle.sign('HMAC', key, data);
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

    return `${encodedAgentId}.${timestamp}.${signatureBase64}`;
}

/**
 * Make a request to Plaid API
 */
async function plaidRequest<T>(
    env: Env,
    endpoint: string,
    body: Record<string, unknown>
): Promise<T> {
    const baseUrl = getPlaidBaseUrl(env);
    const clientId = env.PLAID_CLIENT_ID;
    const secret = env.PLAID_SECRET;

    if (!clientId || !secret) {
        throw new Error('Plaid credentials not configured');
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: clientId,
            secret: secret,
            ...body,
        }),
    });

    if (!response.ok) {
        const error = await response.json() as { error_message?: string; error_code?: string };
        logger.error('Plaid API error', {
            endpoint,
            status: response.status,
            error
        });
        throw new Error(error.error_message || `Plaid API error: ${response.status}`);
    }

    return response.json() as Promise<T>;
}

/**
 * Setup Plaid proxy routes
 */
export function setupPlaidProxyRoutes(app: Hono<AppEnv>): void {
    // CORS middleware for proxy routes - allow sandbox subdomains
    app.use('/api/proxy/plaid/*', async (c, next) => {
        const origin = c.req.header('Origin');
        const previewDomain = getPreviewDomain(c.env);

        // Allow requests from sandbox subdomains
        if (origin && previewDomain && origin.endsWith(`.${previewDomain}`)) {
            c.header('Access-Control-Allow-Origin', origin);
            c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            c.header('Access-Control-Allow-Headers', 'Content-Type, X-Preview-Token');
            c.header('Access-Control-Max-Age', '86400');
        }

        // Handle preflight
        if (c.req.method === 'OPTIONS') {
            return c.body(null, 204);
        }

        await next();
    });

    /**
     * POST /api/proxy/plaid/link-token
     * Create a Plaid Link token for initializing Plaid Link
     */
    app.post('/api/proxy/plaid/link-token', async (c) => {
        const previewToken = c.req.header('X-Preview-Token');

        if (!previewToken) {
            return c.json({ error: 'Missing preview token' }, 401);
        }

        const agentId = await validatePreviewToken(c.env, previewToken);
        if (!agentId) {
            return c.json({ error: 'Invalid preview token' }, 403);
        }

        logger.info('Creating Plaid link token', { agentId });

        try {
            // Create link token with Plaid
            const response = await plaidRequest<PlaidLinkTokenResponse>(
                c.env,
                '/link/token/create',
                {
                    user: {
                        client_user_id: agentId,
                    },
                    client_name: 'VibeSDK Preview',
                    products: ['transactions'],
                    country_codes: ['US'],
                    language: 'en',
                }
            );

            return c.json({
                success: true,
                link_token: response.link_token,
                expiration: response.expiration,
            });
        } catch (error) {
            logger.error('Failed to create link token', error);
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create link token',
            }, 500);
        }
    });

    /**
     * POST /api/proxy/plaid/exchange-token
     * Exchange public_token for access_token and store in Agent DO
     */
    app.post('/api/proxy/plaid/exchange-token', async (c) => {
        const previewToken = c.req.header('X-Preview-Token');

        if (!previewToken) {
            return c.json({ error: 'Missing preview token' }, 401);
        }

        const agentId = await validatePreviewToken(c.env, previewToken);
        if (!agentId) {
            return c.json({ error: 'Invalid preview token' }, 403);
        }

        let body: { public_token?: string };
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: 'Invalid JSON body' }, 400);
        }

        if (!body.public_token) {
            return c.json({ error: 'Missing public_token' }, 400);
        }

        logger.info('Exchanging Plaid public token', { agentId });

        try {
            // Exchange public token for access token
            const response = await plaidRequest<PlaidExchangeResponse>(
                c.env,
                '/item/public_token/exchange',
                {
                    public_token: body.public_token,
                }
            );

            // Store access token in Agent DO
            const agentStub = await getAgentStub(c.env, agentId);
            await agentStub.storePlaidAccessToken(response.access_token, response.item_id);

            logger.info('Plaid access token stored', { agentId, itemId: response.item_id });

            return c.json({
                success: true,
                item_id: response.item_id,
            });
        } catch (error) {
            logger.error('Failed to exchange token', error);
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to exchange token',
            }, 500);
        }
    });

    /**
     * GET /api/proxy/plaid/transactions
     * Fetch transactions using stored access token
     */
    app.get('/api/proxy/plaid/transactions', async (c) => {
        const previewToken = c.req.header('X-Preview-Token');

        if (!previewToken) {
            return c.json({ error: 'Missing preview token' }, 401);
        }

        const agentId = await validatePreviewToken(c.env, previewToken);
        if (!agentId) {
            return c.json({ error: 'Invalid preview token' }, 403);
        }

        logger.info('Fetching Plaid transactions', { agentId });

        try {
            // Get access token from Agent DO
            const agentStub = await getAgentStub(c.env, agentId);
            const accessToken = await agentStub.getPlaidAccessToken();

            if (!accessToken) {
                return c.json({
                    success: false,
                    error: 'No Plaid account connected',
                    needsConnection: true,
                }, 400);
            }

            // Fetch transactions using sync endpoint
            const response = await plaidRequest<PlaidTransactionsSyncResponse>(
                c.env,
                '/transactions/sync',
                {
                    access_token: accessToken,
                }
            );

            return c.json({
                success: true,
                transactions: response.added,
                has_more: response.has_more,
            });
        } catch (error) {
            logger.error('Failed to fetch transactions', error);
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch transactions',
            }, 500);
        }
    });

    /**
     * GET /api/proxy/plaid/accounts
     * Fetch accounts using stored access token
     */
    app.get('/api/proxy/plaid/accounts', async (c) => {
        const previewToken = c.req.header('X-Preview-Token');

        if (!previewToken) {
            return c.json({ error: 'Missing preview token' }, 401);
        }

        const agentId = await validatePreviewToken(c.env, previewToken);
        if (!agentId) {
            return c.json({ error: 'Invalid preview token' }, 403);
        }

        logger.info('Fetching Plaid accounts', { agentId });

        try {
            // Get access token from Agent DO
            const agentStub = await getAgentStub(c.env, agentId);
            const accessToken = await agentStub.getPlaidAccessToken();

            if (!accessToken) {
                return c.json({
                    success: false,
                    error: 'No Plaid account connected',
                    needsConnection: true,
                }, 400);
            }

            // Fetch accounts
            const response = await plaidRequest<PlaidAccountsResponse>(
                c.env,
                '/accounts/get',
                {
                    access_token: accessToken,
                }
            );

            return c.json({
                success: true,
                accounts: response.accounts,
            });
        } catch (error) {
            logger.error('Failed to fetch accounts', error);
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch accounts',
            }, 500);
        }
    });

    /**
     * GET /api/proxy/plaid/status
     * Check if Plaid is connected for this agent
     */
    app.get('/api/proxy/plaid/status', async (c) => {
        const previewToken = c.req.header('X-Preview-Token');

        if (!previewToken) {
            return c.json({ error: 'Missing preview token' }, 401);
        }

        const agentId = await validatePreviewToken(c.env, previewToken);
        if (!agentId) {
            return c.json({ error: 'Invalid preview token' }, 403);
        }

        try {
            const agentStub = await getAgentStub(c.env, agentId);
            const accessToken = await agentStub.getPlaidAccessToken();

            return c.json({
                success: true,
                connected: !!accessToken,
            });
        } catch (error) {
            logger.error('Failed to check Plaid status', error);
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to check status',
            }, 500);
        }
    });
}
