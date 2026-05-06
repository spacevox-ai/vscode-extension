/**
 * Authentication Service
 * 
 * Handles OAuth2 authentication flow with work.studio auth server (Keycloak).
 * Uses VS Code's built-in authentication provider pattern.
 */

import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { Logger } from '../utils/Logger';
import { getAuthUrl, isSecureMode } from '../config/EnvironmentConfig';
import { BrandingService } from '../config/BrandingService';

// Secret storage keys
const TOKEN_KEY = 'workstudio.accessToken';
const REFRESH_TOKEN_KEY = 'workstudio.refreshToken';
const TOKEN_EXPIRY_KEY = 'workstudio.tokenExpiry';
const TENANT_ID_KEY = 'workstudio.tenantId';
const ENV_ID_KEY = 'workstudio.envId';
const USER_ID_KEY = 'workstudio.userId';
const ENVIRONMENTS_KEY = 'workstudio.environments';

// Environment type
export interface WorkspaceEnvironment {
    id: string;
    name: string;
    type: 'development' | 'staging' | 'production';
}

// OAuth2 configuration
const OAUTH_CLIENT_ID = 'vscode-extension';
const OAUTH_REDIRECT_PORT = 8765;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}/callback`;
const OAUTH_SCOPE = 'openid profile email organization';

// Account service URL
const ACCOUNT_API_URL = 'http://localhost:8081/api/v1/workflow/account';

/**
 * Get HTTPS agent configured for the current environment.
 * In local/development mode, allows self-signed certificates.
 */
function getHttpsAgent(): https.Agent {
    const secure = isSecureMode();
    return new https.Agent({
        rejectUnauthorized: secure  // Allow self-signed in local mode
    });
}

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
}

interface ResolvedIdentity {
    userId: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    status: string;
    firstLogin: string;
    tenantId: string | null;
    hasTenant: boolean;
    externalUserId: string;
    identityProvider: string;
    defaultEnvId?: string;
}

export class AuthService {
    private context: vscode.ExtensionContext;
    private httpServer: http.Server | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Start the OAuth2 login flow
     */
    async login(): Promise<string | null> {
        Logger.info('AuthService.login() called');
        // Get auth URL from environment config
        const authUrl = getAuthUrl();
        const realm = 'integration_platform';
        
        Logger.info(`Starting OAuth2 login with auth server: ${authUrl}`);

        try {
            // Generate PKCE challenge
            const { codeVerifier, codeChallenge } = await this.generatePKCE();

            // Build authorization URL
            const authorizationUrl = this.buildAuthorizationUrl(authUrl, realm, codeChallenge);

            // Start local callback server
            const authCode = await this.waitForAuthCallback(codeVerifier);

            if (!authCode) {
                throw new Error('Authorization cancelled or failed');
            }

            // Exchange code for tokens
            const tokens = await this.exchangeCodeForTokens(authUrl, realm, authCode, codeVerifier);
            console.log('[work.studio] Tokens received from Keycloak');

            // Store tokens
            await this.storeTokens(tokens);
            console.log('[work.studio] Tokens stored, now resolving platform identity...');

            // Resolve platform identity to get tenantId
            await this.resolvePlatformIdentity(tokens.access_token);
            console.log('[work.studio] Platform identity resolution complete');

            return tokens.access_token;

        } catch (error) {
            console.log(`[work.studio] Authentication FAILED: ${error}`);
            Logger.error('Authentication failed', error);
            throw error;
        }
    }

    /**
     * Logout and clear stored credentials
     */
    async logout(): Promise<void> {
        await this.context.secrets.delete(TOKEN_KEY);
        await this.context.secrets.delete(REFRESH_TOKEN_KEY);
        await this.context.secrets.delete(TOKEN_EXPIRY_KEY);
        await this.context.secrets.delete(TENANT_ID_KEY);
        await this.context.secrets.delete(ENV_ID_KEY);
        await this.context.secrets.delete(USER_ID_KEY);
        await this.context.secrets.delete(ENVIRONMENTS_KEY);
        this.context.globalState.update('workstudio.isAuthenticated', false);
        Logger.info('Logged out');
    }

    /**
     * Get stored access token (refreshing if needed)
     */
    async getStoredToken(): Promise<string | null> {
        const token = await this.context.secrets.get(TOKEN_KEY);
        if (!token) {
            return null;
        }

        // Check expiry
        const expiryStr = await this.context.secrets.get(TOKEN_EXPIRY_KEY);
        if (expiryStr) {
            const expiry = parseInt(expiryStr, 10);
            const now = Date.now();
            
            // If token expires in less than 5 minutes, try to refresh
            if (expiry - now < 5 * 60 * 1000) {
                Logger.info('Token expiring soon, attempting refresh');
                try {
                    const newToken = await this.refreshAccessToken();
                    if (newToken) {
                        return newToken;
                    }
                } catch (error) {
                    Logger.warn('Token refresh failed', error);
                }
            }
        }

        return token;
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated(): boolean {
        // This is a synchronous check, won't verify token validity
        return this.context.globalState.get<boolean>('workstudio.isAuthenticated', false);
    }

    /**
     * Check if a token is valid (not expired)
     */
    isTokenValid(token: string): boolean {
        try {
            // Decode JWT payload (without verification)
            const parts = token.split('.');
            if (parts.length !== 3) {
                return false;
            }

            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            const exp = payload.exp;
            
            if (!exp) {
                return false;
            }

            // Check if expired (with 5 minute buffer)
            const now = Math.floor(Date.now() / 1000);
            return exp > now + 300;

        } catch {
            return false;
        }
    }

    /**
     * Get stored tenant ID
     */
    async getTenantId(): Promise<string | null> {
        return await this.context.secrets.get(TENANT_ID_KEY) || null;
    }

    /**
     * Get stored environment ID
     */
    async getEnvId(): Promise<string | null> {
        return await this.context.secrets.get(ENV_ID_KEY) || null;
    }

    /**
     * Set the current environment ID (for switching environments)
     */
    async setEnvId(envId: string): Promise<void> {
        await this.context.secrets.store(ENV_ID_KEY, envId);
        Logger.info(`Switched to environment: ${envId}`);
    }

    /**
     * Get all environments for the current tenant
     */
    async getEnvironments(): Promise<WorkspaceEnvironment[]> {
        const envJson = await this.context.secrets.get(ENVIRONMENTS_KEY);
        if (!envJson) return [];
        try {
            return JSON.parse(envJson) as WorkspaceEnvironment[];
        } catch {
            return [];
        }
    }

    /**
     * Get current environment with full details
     */
    async getCurrentEnvironment(): Promise<WorkspaceEnvironment | null> {
        const envId = await this.getEnvId();
        if (!envId) return null;
        
        const environments = await this.getEnvironments();
        return environments.find(e => e.id === envId) || null;
    }

    /**
     * Resolve platform identity from access token (public method for auto-connect).
     * Calls the account service to get tenant/environment info.
     */
    async resolvePlatformIdentityPublic(accessToken: string): Promise<void> {
        return this.resolvePlatformIdentity(accessToken);
    }

    /**
     * Resolve platform identity from access token.
     * Calls the account service to get tenant/environment info.
     */
    private async resolvePlatformIdentity(accessToken: string): Promise<void> {
        try {
            // Decode JWT to get user info
            const parts = accessToken.split('.');
            if (parts.length !== 3) {
                throw new Error('Invalid token format');
            }

            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            
            // Get tenant ID directly from JWT organization claim
            const tenantId = payload.organization?.[0] || null;
            console.log(`[work.studio] Tenant ID from JWT organization: ${tenantId}`);
            
            if (tenantId) {
                await this.context.secrets.store(TENANT_ID_KEY, tenantId);
                console.log(`[work.studio] Stored tenantId: ${tenantId}`);
            } else {
                console.log(`[work.studio] WARNING: No organization claim in JWT, tenant ID will be null`);
            }
            
            // Call account service to get/create platform user
            const config = vscode.workspace.getConfiguration('workStudio');
            const accountUrl = config.get<string>('accountServiceUrl', ACCOUNT_API_URL);

            const requestBody = {
                identityProvider: 'keycloak',
                externalUserId: payload.sub,
                email: payload.email,
                displayName: payload.name || payload.preferred_username,
                avatarUrl: null,
                externalOrgId: tenantId
            };

            const response = await fetch(`${accountUrl}/users/resolve`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            
            console.log(`[work.studio] Resolve response: ${response.status}`);

            if (response.ok) {
                const resolved: ResolvedIdentity = await response.json();
                console.log(`[work.studio] Platform userId: ${resolved.userId}`);
                
                if (resolved.userId) {
                    await this.context.secrets.store(USER_ID_KEY, resolved.userId);
                }
            }

            // Fetch environments for this tenant
            if (tenantId) {
                await this.fetchDefaultEnvironment(accessToken, tenantId);
                
                // Fetch tenant-specific branding (if configured)
                const config = vscode.workspace.getConfiguration('workStudio');
                const accountUrl = config.get<string>('accountServiceUrl', ACCOUNT_API_URL);
                await BrandingService.getInstance().fetchTenantBranding(tenantId, accessToken, accountUrl);
            }

            this.context.globalState.update('workstudio.isAuthenticated', true);

        } catch (error) {
            console.log(`[work.studio] Resolve ERROR: ${error}`);
            Logger.error('Failed to resolve platform identity', error);
            // Don't fail login, just log the error
        }
    }

    /**
     * Fetch environments for a tenant and store them.
     */
    private async fetchDefaultEnvironment(accessToken: string, tenantId: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('workStudio');
            const accountUrl = config.get<string>('accountServiceUrl', ACCOUNT_API_URL);

            console.log(`[work.studio] Fetching environments for tenant: ${tenantId}`);
            
            const response = await fetch(`${accountUrl}/by-tenant/${tenantId}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'X-SELECTED-TENANT': tenantId
                }
            });

            console.log(`[work.studio] Account fetch response: ${response.status}`);

            if (!response.ok) {
                console.log(`[work.studio] Failed to fetch account, status: ${response.status}`);
                return;
            }

            const account = await response.json();
            console.log(`[work.studio] Account data keys: ${Object.keys(account).join(', ')}`);
            
            // Get the environments from the account (could be envList or environments)
            const envList = account.envList || account.environments || [];
            console.log(`[work.studio] Environment count: ${envList.length}`);
            
            // Normalize and store all environments
            const environments: WorkspaceEnvironment[] = envList.map((env: any) => ({
                id: env.id || env.envId,
                name: env.envName || env.name || 'Unnamed Environment',
                type: this.inferEnvironmentType(env.envName || env.name || ''),
            }));

            // Store the full environment list
            await this.context.secrets.store(ENVIRONMENTS_KEY, JSON.stringify(environments));
            console.log(`[work.studio] Stored ${environments.length} environments`);

            // Set default environment if we don't have one yet
            const currentEnvId = await this.getEnvId();
            if (!currentEnvId && environments.length > 0) {
                const defaultEnv = environments[0];
                await this.context.secrets.store(ENV_ID_KEY, defaultEnv.id);
                console.log(`[work.studio] Set default environment: ${defaultEnv.name} (${defaultEnv.id})`);
            }
        } catch (error) {
            console.log(`[work.studio] Failed to fetch environments: ${error}`);
            Logger.warn('Failed to fetch default environment', error);
        }
    }

    /**
     * Infer environment type from name
     */
    private inferEnvironmentType(name: string): 'development' | 'staging' | 'production' {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('prod') || lowerName.includes('live')) {
            return 'production';
        }
        if (lowerName.includes('stag') || lowerName.includes('uat') || lowerName.includes('test')) {
            return 'staging';
        }
        return 'development';
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private async generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
        const crypto = await import('crypto');
        
        // Generate random code verifier (43-128 chars, using base64url alphabet)
        // RFC 7636: code_verifier = high-entropy cryptographic random STRING
        // using unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
        const codeVerifier = crypto.randomBytes(32)
            .toString('base64url');  // base64url is already URL-safe (no +, /, =)

        // Generate code challenge: BASE64URL(SHA256(code_verifier))
        const codeChallenge = crypto.createHash('sha256')
            .update(codeVerifier, 'ascii')  // Important: hash the ASCII string, not binary
            .digest('base64url');  // base64url encoding (no padding)

        Logger.debug(`PKCE generated - verifier length: ${codeVerifier.length}, challenge: ${codeChallenge.substring(0, 10)}...`);

        return { codeVerifier, codeChallenge };
    }

    private buildAuthorizationUrl(authUrl: string, realm: string, codeChallenge: string): string {
        const params = new URLSearchParams({
            client_id: OAUTH_CLIENT_ID,
            redirect_uri: OAUTH_REDIRECT_URI,
            response_type: 'code',
            scope: OAUTH_SCOPE,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            state: this.generateState()
        });

        const authorizationUrl = `${authUrl}/realms/${realm}/protocol/openid-connect/auth?${params.toString()}`;

        // Open in browser
        vscode.env.openExternal(vscode.Uri.parse(authorizationUrl));

        return authorizationUrl;
    }

    private generateState(): string {
        const crypto = require('crypto');
        return crypto.randomBytes(16).toString('hex');
    }

    private async waitForAuthCallback(codeVerifier: string): Promise<string | null> {
        return new Promise((resolve) => {
            this.httpServer = http.createServer((req, res) => {
                const parsedUrl = url.parse(req.url || '', true);
                
                if (parsedUrl.pathname === '/callback') {
                    const code = parsedUrl.query.code as string;
                    const error = parsedUrl.query.error as string;

                    if (error) {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end(`<html><body><h1>Authentication Failed</h1><p>${error}</p><script>window.close();</script></body></html>`);
                        this.httpServer?.close();
                        resolve(null);
                    } else if (code) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end('<html><body><h1>Authentication Successful!</h1><p>You can close this window.</p><script>window.close();</script></body></html>');
                        this.httpServer?.close();
                        resolve(code);
                    } else {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end('<html><body><h1>Missing authorization code</h1><script>window.close();</script></body></html>');
                        this.httpServer?.close();
                        resolve(null);
                    }
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });

            this.httpServer.listen(OAUTH_REDIRECT_PORT, () => {
                Logger.info(`OAuth callback server listening on port ${OAUTH_REDIRECT_PORT}`);
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                if (this.httpServer) {
                    this.httpServer.close();
                    resolve(null);
                }
            }, 5 * 60 * 1000);
        });
    }

    private async exchangeCodeForTokens(
        authUrl: string, 
        realm: string, 
        code: string, 
        codeVerifier: string
    ): Promise<TokenResponse> {
        const tokenUrl = `${authUrl}/realms/${realm}/protocol/openid-connect/token`;

        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: OAUTH_CLIENT_ID,
            code,
            redirect_uri: OAUTH_REDIRECT_URI,
            code_verifier: codeVerifier
        });

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Token exchange failed: ${error}`);
        }

        return await response.json() as TokenResponse;
    }

    private async refreshAccessToken(): Promise<string | null> {
        const refreshToken = await this.context.secrets.get(REFRESH_TOKEN_KEY);
        if (!refreshToken) {
            return null;
        }

        // Get auth URL from environment config
        const authUrl = getAuthUrl();
        const realm = 'integration_platform';
        const tokenUrl = `${authUrl}/realms/${realm}/protocol/openid-connect/token`;

        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: OAUTH_CLIENT_ID,
            refresh_token: refreshToken
        });

        try {
            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params.toString()
            });

            if (!response.ok) {
                throw new Error('Token refresh failed');
            }

            const tokens = await response.json() as TokenResponse;
            await this.storeTokens(tokens);
            return tokens.access_token;

        } catch (error) {
            Logger.error('Token refresh failed', error);
            return null;
        }
    }

    private async storeTokens(tokens: TokenResponse): Promise<void> {
        await this.context.secrets.store(TOKEN_KEY, tokens.access_token);
        
        if (tokens.refresh_token) {
            await this.context.secrets.store(REFRESH_TOKEN_KEY, tokens.refresh_token);
        }

        // Store expiry time
        const expiryTime = Date.now() + (tokens.expires_in * 1000);
        await this.context.secrets.store(TOKEN_EXPIRY_KEY, expiryTime.toString());

        // Update authentication state
        await this.context.globalState.update('workstudio.isAuthenticated', true);
    }
}
