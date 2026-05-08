/**
 * work.studio Authentication Provider
 * 
 * Implements VS Code's AuthenticationProvider interface for native
 * integration with VS Code's accounts system.
 * 
 * This makes work.studio appear in:
 * - Accounts menu (bottom left)
 * - "Manage Extension Account Preferences"
 * - "Sign in with work.studio" prompts
 */

import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import { Logger } from '../utils/Logger';
import { getAuthUrl, isSecureMode, getAccountUrl } from '../config/EnvironmentConfig';
import { BrandingService } from '../config/BrandingService';

// Auth provider ID - must match package.json
export const AUTH_PROVIDER_ID = 'workstudio';
export const AUTH_PROVIDER_LABEL = 'work.studio';

// Secret storage keys
const TOKEN_KEY = 'workstudio.accessToken';
const REFRESH_TOKEN_KEY = 'workstudio.refreshToken';
const TOKEN_EXPIRY_KEY = 'workstudio.tokenExpiry';
const TENANT_ID_KEY = 'workstudio.tenantId';
const ENV_ID_KEY = 'workstudio.envId';
const USER_ID_KEY = 'workstudio.userId';
const USER_EMAIL_KEY = 'workstudio.userEmail';
const ENVIRONMENTS_KEY = 'workstudio.environments';

// OAuth2 configuration
const OAUTH_CLIENT_ID = 'vscode-extension';
const OAUTH_REDIRECT_PORT = 8765;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}/callback`;
const OAUTH_SCOPE = 'openid profile email organization';

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
}

interface UserInfo {
    sub: string;
    email?: string;
    name?: string;
    preferred_username?: string;
}

/**
 * work.studio Authentication Provider
 */
export class WorkStudioAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
    private static instance: WorkStudioAuthProvider;
    private context: vscode.ExtensionContext;
    private httpServer: http.Server | null = null;
    private sessions: vscode.AuthenticationSession[] = [];
    private disposables: vscode.Disposable[] = [];
    
    private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    readonly onDidChangeSessions = this._onDidChangeSessions.event;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context?: vscode.ExtensionContext): WorkStudioAuthProvider {
        if (!WorkStudioAuthProvider.instance) {
            if (!context) {
                throw new Error('WorkStudioAuthProvider must be initialized with context first');
            }
            WorkStudioAuthProvider.instance = new WorkStudioAuthProvider(context);
        }
        return WorkStudioAuthProvider.instance;
    }

    /**
     * Register the authentication provider with VS Code
     */
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = WorkStudioAuthProvider.getInstance(context);
        
        const disposable = vscode.authentication.registerAuthenticationProvider(
            AUTH_PROVIDER_ID,
            AUTH_PROVIDER_LABEL,
            provider,
            { supportsMultipleAccounts: false }
        );
        
        context.subscriptions.push(disposable);
        Logger.info('work.studio authentication provider registered');
        
        return disposable;
    }

    /**
     * Get existing sessions
     */
    async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
        Logger.info('getSessions called');
        
        // Try to restore session from stored tokens
        const accessToken = await this.context.secrets.get(TOKEN_KEY);
        const userId = await this.context.secrets.get(USER_ID_KEY);
        
        Logger.info(`getSessions: accessToken=${!!accessToken}, userId=${!!userId}`);
        
        if (accessToken && userId) {
            // Check if token is still valid
            const expiryStr = await this.context.secrets.get(TOKEN_EXPIRY_KEY);
            const expiry = expiryStr ? parseInt(expiryStr, 10) : 0;
            
            Logger.info(`getSessions: expiry=${expiry}, now=${Date.now()}, valid=${Date.now() < expiry}`);
            
            if (Date.now() < expiry) {
                // Return session with cached email label
                const storedEmail = await this.context.secrets.get(USER_EMAIL_KEY);
                const session: vscode.AuthenticationSession = {
                    id: userId,
                    accessToken,
                    account: {
                        id: userId,
                        label: storedEmail || 'work.studio User'
                    },
                    scopes: scopes ? [...scopes] : ['openid', 'profile', 'email']
                };
                
                Logger.info('getSessions: returning valid session');
                this.sessions = [session];
                return this.sessions;
            } else {
                Logger.info('getSessions: token expired, returning empty');
                // Don't try to refresh here - let the caller handle it
            }
        }
        
        Logger.info('getSessions: returning empty sessions');
        this.sessions = [];
        return [];
    }

    /**
     * Create a new session (login)
     */
    async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
        Logger.info('createSession called - starting login flow');
        
        const authUrl = getAuthUrl();
        const realm = 'integration_platform';
        
        try {
            // Generate PKCE challenge
            const { codeVerifier, codeChallenge } = await this.generatePKCE();
            
            // Build authorization URL
            const authorizationUrl = this.buildAuthorizationUrl(authUrl, realm, codeChallenge);
            
            // Open browser for auth
            await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl));
            
            // Wait for callback
            const authCode = await this.waitForAuthCallback();
            
            if (!authCode) {
                throw new Error('Authorization cancelled or failed');
            }
            
            // Exchange code for tokens
            const tokens = await this.exchangeCodeForTokens(authUrl, realm, authCode, codeVerifier);
            
            // Store tokens
            await this.storeTokens(tokens);
            
            // Resolve identity
            await this.resolvePlatformIdentity(tokens.access_token);
            
            // Get user info
            const userId = await this.context.secrets.get(USER_ID_KEY) || 'unknown';
            const email = await this.getUserEmail(tokens.access_token);
            
            // Store email for getSessions() to use later
            if (email) {
                await this.context.secrets.store(USER_EMAIL_KEY, email);
            }
            
            // Create session
            const session: vscode.AuthenticationSession = {
                id: userId,
                accessToken: tokens.access_token,
                account: {
                    id: userId,
                    label: email || 'work.studio User'
                },
                scopes: [...scopes]
            };
            
            this.sessions = [session];
            
            // Fire change event
            this._onDidChangeSessions.fire({
                added: [session],
                removed: [],
                changed: []
            });
            
            // Note: Don't show notification here - extension.ts handles it
            Logger.info('Login successful');
            
            return session;
            
        } catch (error) {
            Logger.error('Login failed', error);
            throw error;
        }
    }

    /**
     * Remove a session (logout)
     */
    async removeSession(sessionId: string): Promise<void> {
        Logger.info('removeSession called - logging out');
        
        const session = this.sessions.find(s => s.id === sessionId);
        
        // Clear stored tokens
        await this.context.secrets.delete(TOKEN_KEY);
        await this.context.secrets.delete(REFRESH_TOKEN_KEY);
        await this.context.secrets.delete(TOKEN_EXPIRY_KEY);
        await this.context.secrets.delete(TENANT_ID_KEY);
        await this.context.secrets.delete(ENV_ID_KEY);
        await this.context.secrets.delete(USER_ID_KEY);
        await this.context.secrets.delete(USER_EMAIL_KEY);
        await this.context.secrets.delete(ENVIRONMENTS_KEY);
        
        this.sessions = [];
        
        if (session) {
            this._onDidChangeSessions.fire({
                added: [],
                removed: [session],
                changed: []
            });
        }
        
        // Note: Don't show notification here - extension.ts handles it
        Logger.info('Logout successful');
    }

    // ==================== Helper Methods ====================

    /**
     * Generate PKCE code verifier and challenge
     */
    private async generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        const hash = crypto.createHash('sha256').update(codeVerifier).digest();
        const codeChallenge = hash.toString('base64url');
        return { codeVerifier, codeChallenge };
    }

    /**
     * Build OAuth authorization URL
     */
    private buildAuthorizationUrl(authUrl: string, realm: string, codeChallenge: string): string {
        const params = new URLSearchParams({
            client_id: OAUTH_CLIENT_ID,
            redirect_uri: OAUTH_REDIRECT_URI,
            response_type: 'code',
            scope: OAUTH_SCOPE,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });

        return `${authUrl}/realms/${realm}/protocol/openid-connect/auth?${params.toString()}`;
    }

    /**
     * Wait for OAuth callback
     */
    private waitForAuthCallback(): Promise<string | null> {
        return new Promise((resolve) => {
            Logger.info(`OAuth callback server listening on port ${OAUTH_REDIRECT_PORT}`);
            
            this.httpServer = http.createServer((req, res) => {
                const parsedUrl = new URL(req.url || '', `http://localhost:${OAUTH_REDIRECT_PORT}`);
                
                if (parsedUrl.pathname === '/callback') {
                    const code = parsedUrl.searchParams.get('code');
                    const error = parsedUrl.searchParams.get('error');

                    // Send response HTML
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>work.studio - Authentication</title>
                            <style>
                                * { margin: 0; padding: 0; box-sizing: border-box; }
                                body { 
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                    display: flex; justify-content: center; align-items: center;
                                    min-height: 100vh; background: linear-gradient(135deg, #1e1e2e 0%, #0f0f1a 100%); color: #fff;
                                }
                                .container { text-align: center; padding: 60px 40px; }
                                .icon { font-size: 72px; margin-bottom: 24px; }
                                .icon-success { background: linear-gradient(135deg, #10b981, #059669); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                                .icon-error { color: #ef4444; }
                                h1 { font-size: 28px; margin-bottom: 12px; font-weight: 600; }
                                .success { color: #10b981; }
                                .error { color: #ef4444; }
                                p { color: #9ca3af; font-size: 16px; margin-top: 8px; }
                                .hint { margin-top: 32px; padding: 16px 24px; background: rgba(255,255,255,0.05); border-radius: 8px; display: inline-block; }
                                .hint p { color: #6b7280; font-size: 14px; margin: 0; }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                ${error 
                                    ? `<div class="icon icon-error">&#10006;</div><h1 class="error">Authentication Failed</h1><p>${error}</p>` 
                                    : `<div class="icon icon-success">&#10004;</div><h1 class="success">Signed in to work.studio</h1><p>Authentication successful</p><div class="hint"><p>You can close this window and return to VS Code</p></div>`
                                }
                            </div>
                            <script>setTimeout(() => window.close(), 2000);</script>
                        </body>
                        </html>
                    `);

                    // Close server and resolve
                    this.httpServer?.close();
                    this.httpServer = null;
                    resolve(error ? null : code);
                }
            });

            this.httpServer.listen(OAUTH_REDIRECT_PORT);

            // Timeout after 5 minutes
            setTimeout(() => {
                if (this.httpServer) {
                    this.httpServer.close();
                    this.httpServer = null;
                    resolve(null);
                }
            }, 300000);
        });
    }

    /**
     * Exchange authorization code for tokens
     */
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
            code_verifier: codeVerifier,
        });

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
        }

        return response.json();
    }

    /**
     * Store tokens securely
     */
    private async storeTokens(tokens: TokenResponse): Promise<void> {
        await this.context.secrets.store(TOKEN_KEY, tokens.access_token);
        
        if (tokens.refresh_token) {
            await this.context.secrets.store(REFRESH_TOKEN_KEY, tokens.refresh_token);
        }
        
        const expiry = Date.now() + (tokens.expires_in * 1000);
        await this.context.secrets.store(TOKEN_EXPIRY_KEY, expiry.toString());
    }

    /**
     * Try to refresh the access token
     */
    private async tryRefreshToken(): Promise<string | null> {
        const refreshToken = await this.context.secrets.get(REFRESH_TOKEN_KEY);
        if (!refreshToken) return null;

        const authUrl = getAuthUrl();
        const realm = 'integration_platform';
        const tokenUrl = `${authUrl}/realms/${realm}/protocol/openid-connect/token`;

        try {
            const params = new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: OAUTH_CLIENT_ID,
                refresh_token: refreshToken,
            });

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
            });

            if (response.ok) {
                const tokens: TokenResponse = await response.json();
                await this.storeTokens(tokens);
                return tokens.access_token;
            }
        } catch (error) {
            Logger.debug('Token refresh failed');
        }

        return null;
    }

    /**
     * Get user email from token
     */
    private async getUserEmail(accessToken: string): Promise<string | null> {
        try {
            const authUrl = getAuthUrl();
            const realm = 'integration_platform';
            const userInfoUrl = `${authUrl}/realms/${realm}/protocol/openid-connect/userinfo`;
            
            const response = await fetch(userInfoUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            
            if (response.ok) {
                const info: UserInfo = await response.json();
                return info.email || info.preferred_username || null;
            }
        } catch (error) {
            Logger.debug('Failed to get user email');
        }
        return null;
    }

    /**
     * Resolve platform identity after login
     */
    private async resolvePlatformIdentity(accessToken: string): Promise<void> {
        try {
            const accountUrl = getAccountUrl();
            const resolveUrl = `${accountUrl}/resolve`;

            const response = await fetch(resolveUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'login',
                    targetProduct: 'vscode-extension',
                    targetPlanType: 'PRO'
                })
            });

            if (response.ok) {
                const resolved = await response.json();
                
                if (resolved.userId) {
                    await this.context.secrets.store(USER_ID_KEY, resolved.userId);
                }
                if (resolved.tenantId) {
                    await this.context.secrets.store(TENANT_ID_KEY, resolved.tenantId);
                }
                if (resolved.defaultEnvId) {
                    await this.context.secrets.store(ENV_ID_KEY, resolved.defaultEnvId);
                }
                
                // Fetch tenant branding
                if (resolved.tenantId) {
                    await BrandingService.getInstance().fetchTenantBranding(
                        resolved.tenantId, 
                        accessToken, 
                        accountUrl
                    );
                }
            }
        } catch (error) {
            Logger.error('Failed to resolve platform identity', error);
        }
    }

    /**
     * Get stored access token
     */
    public async getAccessToken(): Promise<string | null> {
        return this.context.secrets.get(TOKEN_KEY);
    }

    /**
     * Check if authenticated
     */
    public async isAuthenticated(): Promise<boolean> {
        const sessions = await this.getSessions();
        return sessions.length > 0;
    }

    /**
     * Get current tenant ID
     */
    public async getTenantId(): Promise<string | null> {
        return this.context.secrets.get(TENANT_ID_KEY);
    }

    /**
     * Get current environment ID
     */
    public async getEnvId(): Promise<string | null> {
        return this.context.secrets.get(ENV_ID_KEY);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this._onDidChangeSessions.dispose();
        this.httpServer?.close();
        this.disposables.forEach(d => d.dispose());
    }
}

/**
 * Helper function to get a session, prompting login if needed
 */
export async function getWorkStudioSession(
    createIfNone: boolean = false
): Promise<vscode.AuthenticationSession | undefined> {
    return vscode.authentication.getSession(
        AUTH_PROVIDER_ID,
        ['openid', 'profile', 'email'],
        { createIfNone }
    );
}
