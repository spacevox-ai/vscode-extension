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
import { getAuthUrl, isSecureMode, getAccountUrl } from '../config/EnvironmentConfig';
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
     * Mark authentication state (called by extension when VS Code auth succeeds)
     */
    async setAuthenticated(value: boolean): Promise<void> {
        await this.context.globalState.update('workstudio.isAuthenticated', value);
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
            const accountUrl = getAccountUrl();

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
                const accountUrl = getAccountUrl();
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
            const accountUrl = getAccountUrl();
            const fullUrl = `${accountUrl}/by-tenant/${tenantId}`;

            console.log(`[work.studio] Fetching environments from: ${fullUrl}`);
            
            const response = await fetch(fullUrl, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'X-SELECTED-TENANT': tenantId
                }
            });

            console.log(`[work.studio] Account fetch response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.log(`[work.studio] Account fetch error body: ${errorText.substring(0, 200)}`);
                return;
            }

            const account = await response.json();
            console.log(`[work.studio] Account response keys: ${Object.keys(account).join(', ')}`);
            console.log(`[work.studio] Account response (first 800 chars): ${JSON.stringify(account).substring(0, 800)}`);
            
            // Get the environments from the account (could be envList or environments)
            const envList = account.envList || account.environments || [];
            console.log(`[work.studio] envList from account: ${JSON.stringify(envList)}`);
            console.log(`[work.studio] Environment count: ${envList.length}`);
            
            if (envList.length === 0) {
                console.log(`[work.studio] WARNING: No environments found in account response!`);
                return;
            }
            
            // Normalize and store all environments
            const environments: WorkspaceEnvironment[] = envList.map((env: any) => ({
                id: env.id || env.envId,
                name: env.envName || env.name || 'Unnamed Environment',
                type: this.inferEnvironmentType(env.envName || env.name || ''),
            }));

            // Store the full environment list
            await this.context.secrets.store(ENVIRONMENTS_KEY, JSON.stringify(environments));
            console.log(`[work.studio] Stored ${environments.length} environments`);

            // If multiple environments, prompt user to select
            if (environments.length > 1) {
                await this.promptEnvironmentSelection(environments);
            } else {
                // Single environment - auto-select
                const defaultEnv = environments[0];
                await this.context.secrets.store(ENV_ID_KEY, defaultEnv.id);
                console.log(`[work.studio] Auto-selected single environment: ${defaultEnv.name} (${defaultEnv.id})`);
                
                // Verify it was stored
                const storedEnvId = await this.context.secrets.get(ENV_ID_KEY);
                console.log(`[work.studio] Verification - stored envId: ${storedEnvId}`);
            }
        } catch (error) {
            console.log(`[work.studio] Failed to fetch environments: ${error}`);
            Logger.warn('Failed to fetch default environment', error);
        }
    }
    
    /**
     * Prompt user to select an environment when multiple are available.
     */
    private async promptEnvironmentSelection(environments: WorkspaceEnvironment[]): Promise<void> {
        const items = environments.map(env => ({
            label: env.name,
            description: env.id,
            detail: `Type: ${env.type}`,
            env
        }));
        
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an environment to work with',
            title: 'Select Environment'
        });
        
        if (selected) {
            await this.context.secrets.store(ENV_ID_KEY, selected.env.id);
            console.log(`[work.studio] User selected environment: ${selected.env.name} (${selected.env.id})`);
        } else {
            // No selection - use first environment as default
            const defaultEnv = environments[0];
            await this.context.secrets.store(ENV_ID_KEY, defaultEnv.id);
            console.log(`[work.studio] No selection, defaulting to first environment: ${defaultEnv.name} (${defaultEnv.id})`);
        }
        
        // Verify it was stored
        const storedEnvId = await this.context.secrets.get(ENV_ID_KEY);
        console.log(`[work.studio] Verification - stored envId after selection: ${storedEnvId}`);
    }

    /**
     * Public method to allow user to switch environments.
     * Call this from a command handler to let users change their active environment.
     */
    public async selectEnvironment(): Promise<void> {
        const environments = await this.getEnvironments();
        if (!environments || environments.length === 0) {
            vscode.window.showWarningMessage('No environments available. Please sign in first.');
            return;
        }
        
        const currentEnvId = await this.getEnvId();
        
        const items = environments.map(env => ({
            label: env.name,
            description: env.id === currentEnvId ? '(current)' : env.id,
            detail: `Type: ${env.type}`,
            env
        }));
        
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an environment',
            title: 'Switch Environment'
        });
        
        if (selected && selected.env.id !== currentEnvId) {
            await this.context.secrets.store(ENV_ID_KEY, selected.env.id);
            vscode.window.showInformationMessage(`Switched to environment: ${selected.env.name}. Please refresh the chat panel.`);
            console.log(`[work.studio] Switched environment to: ${selected.env.name} (${selected.env.id})`);
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
                try {
                    const parsedUrl = url.parse(req.url || '', true);
                    Logger.info(`Callback received: ${parsedUrl.pathname}`);
                    
                    if (parsedUrl.pathname === '/callback') {
                        const code = parsedUrl.query.code as string;
                        const error = parsedUrl.query.error as string;

                        Logger.info(`Callback params - code: ${code ? 'present' : 'missing'}, error: ${error || 'none'}`);

                        // Get branding for styled pages (with fallback)
                        let brandName = 'work.studio';
                        let primaryColor = '#6366f1';
                        try {
                            const branding = BrandingService.getInstance();
                            brandName = branding.name || brandName;
                            primaryColor = branding.theme?.accentColor || primaryColor;
                        } catch (e) {
                            Logger.warn('Failed to get branding, using defaults');
                        }

                        if (error) {
                            res.writeHead(400, { 'Content-Type': 'text/html' });
                            res.end(this.getAuthResultHtml(false, error, brandName, primaryColor));
                            this.httpServer?.close();
                            resolve(null);
                        } else if (code) {
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end(this.getAuthResultHtml(true, undefined, brandName, primaryColor));
                            this.httpServer?.close();
                            resolve(code);
                        } else {
                            res.writeHead(400, { 'Content-Type': 'text/html' });
                            res.end(this.getAuthResultHtml(false, 'Missing authorization code', brandName, primaryColor));
                            this.httpServer?.close();
                            resolve(null);
                        }
                    } else {
                        res.writeHead(404);
                        res.end();
                    }
                } catch (err) {
                    Logger.error('Error in callback handler', err);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal server error');
                    this.httpServer?.close();
                    resolve(null);
                }
            });

            this.httpServer.on('error', (err) => {
                Logger.error('Callback server error', err);
                resolve(null);
            });

            this.httpServer.listen(OAUTH_REDIRECT_PORT, '127.0.0.1', () => {
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

    /**
     * Generate branded HTML for auth callback page
     */
    private getAuthResultHtml(success: boolean, error?: string, brandName = 'work.studio', primaryColor = '#6366f1'): string {
        const icon = success 
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="${primaryColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
        
        const title = success ? 'Authentication Successful!' : 'Authentication Failed';
        const message = success 
            ? 'You can close this window and return to VS Code.'
            : `Error: ${error || 'Unknown error'}`;
        const messageColor = success ? '#10b981' : '#ef4444';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - ${brandName}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #f1f5f9;
        }
        .container {
            text-align: center;
            padding: 3rem;
            background: rgba(30, 41, 59, 0.8);
            border-radius: 1rem;
            border: 1px solid rgba(148, 163, 184, 0.1);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            max-width: 400px;
            animation: fadeIn 0.5s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .icon {
            margin-bottom: 1.5rem;
            animation: ${success ? 'bounce' : 'shake'} 0.5s ease-out;
        }
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
        }
        .brand {
            font-size: 1.25rem;
            font-weight: 600;
            color: ${primaryColor};
            margin-bottom: 1rem;
            letter-spacing: -0.025em;
        }
        h1 {
            font-size: 1.75rem;
            font-weight: 700;
            margin-bottom: 0.75rem;
            color: ${messageColor};
        }
        p {
            color: #94a3b8;
            line-height: 1.6;
            margin-bottom: 1.5rem;
        }
        .hint {
            font-size: 0.875rem;
            color: #64748b;
            padding-top: 1rem;
            border-top: 1px solid rgba(148, 163, 184, 0.1);
        }
        .close-btn {
            background: ${primaryColor};
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .close-btn:hover {
            filter: brightness(1.1);
            transform: translateY(-1px);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="brand">${brandName}</div>
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <button class="close-btn" onclick="window.close()">Close Window</button>
        <p class="hint">This window will close automatically...</p>
    </div>
    <script>
        // Auto-close after 3 seconds on success
        ${success ? 'setTimeout(() => window.close(), 3000);' : ''}
    </script>
</body>
</html>`;
    }
}
