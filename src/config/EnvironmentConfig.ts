/**
 * Environment Configuration
 * 
 * Maps environment presets to server URLs.
 * Users can either:
 * 1. Set `workstudio.environment` to use a preset (local, staging, production)
 * 2. Override individual URLs with `workstudio.serverUrl` and `workstudio.authUrl`
 */

import * as vscode from 'vscode';

export interface EnvironmentConfig {
    serverUrl: string;
    authUrl: string;
    agentId: string;  // Which agent to use for chat/completion
    secure: boolean;  // Whether to use TLS verification
}

// VS Code agent ID - this is the master agent that delegates to specialized agents
// It's the same across all environments since it's a system agent
const VSCODE_AGENT_ID = '019d5a01-1001-7001-8001-000000000050';

// Environment presets
const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
    local: {
        serverUrl: 'ws://localhost:8102/ws/mcp',
        authUrl: 'https://auth.spacevox.local',
        agentId: VSCODE_AGENT_ID,
        secure: false,  // Allow self-signed certs
    },
    staging: {
        serverUrl: 'wss://api.stage.work.studio/ws/mcp',
        authUrl: 'https://auth.stage.work.studio',
        agentId: VSCODE_AGENT_ID,
        secure: true,
    },
    production: {
        serverUrl: 'wss://api.work.studio/ws/mcp',
        authUrl: 'https://auth.work.studio',
        agentId: VSCODE_AGENT_ID,
        secure: true,
    },
};

/**
 * Get the effective environment configuration.
 * Priority: explicit URL settings > environment preset
 */
export function getEnvironmentConfig(): EnvironmentConfig {
    const config = vscode.workspace.getConfiguration('workstudio');
    
    // Get environment preset (default to 'local')
    const envName = config.get<string>('environment', 'local');
    const preset = ENVIRONMENTS[envName] || ENVIRONMENTS.local;
    
    // Allow overrides (if set, use them; otherwise use preset)
    const serverUrl = config.get<string>('serverUrl');
    const authUrl = config.get<string>('authUrl');
    const agentId = config.get<string>('agentId');
    
    return {
        serverUrl: serverUrl && serverUrl.trim() !== '' ? serverUrl : preset.serverUrl,
        authUrl: authUrl && authUrl.trim() !== '' ? authUrl : preset.authUrl,
        agentId: agentId && agentId.trim() !== '' ? agentId : preset.agentId,
        secure: preset.secure,
    };
}

/**
 * Get the server URL for MCP WebSocket connection
 */
export function getServerUrl(): string {
    return getEnvironmentConfig().serverUrl;
}

/**
 * Get the auth URL for OAuth2/Keycloak
 */
export function getAuthUrl(): string {
    return getEnvironmentConfig().authUrl;
}

/**
 * Get the agent ID to use for chat and completion
 */
export function getAgentId(): string {
    return getEnvironmentConfig().agentId;
}

/**
 * Check if we should allow insecure connections (self-signed certs)
 */
export function isSecureMode(): boolean {
    return getEnvironmentConfig().secure;
}

/**
 * Get the AI runtime HTTP endpoint for chat API calls.
 * Derives from serverUrl or uses explicit override.
 */
export function getAiEndpoint(): string {
    const config = vscode.workspace.getConfiguration('workStudio');
    const explicit = config.get<string>('aiEndpoint');
    
    // If explicit endpoint set, use it
    if (explicit && explicit.trim() !== '') {
        return explicit;
    }
    
    // Derive from environment
    const envName = vscode.workspace.getConfiguration('workstudio').get<string>('environment', 'local');
    
    switch (envName) {
        case 'production':
            return 'https://api.work.studio/api/v1/workflow/ai-runtime/mcp';
        case 'staging':
            return 'https://api.stage.work.studio/api/v1/workflow/ai-runtime/mcp';
        case 'local':
        default:
            return 'http://localhost:8102/api/v1/workflow/ai-runtime/mcp';
    }
}

/**
 * Get environment name for logging/display
 */
export function getEnvironmentName(): string {
    const config = vscode.workspace.getConfiguration('workstudio');
    return config.get<string>('environment', 'local');
}

/**
 * Get the Gateway URL for session handoff.
 * In production, we create AI sessions via portal which returns a session token.
 * Portal handles auth and routes to gateway internally.
 */
export function getGatewayUrl(): string {
    const config = vscode.workspace.getConfiguration('workStudio');
    const explicit = config.get<string>('gatewayUrl');
    
    // If explicit gateway URL set, use it
    if (explicit && explicit.trim() !== '') {
        return explicit;
    }
    
    // Derive from environment - use portal route (same as designer)
    const envName = vscode.workspace.getConfiguration('workstudio').get<string>('environment', 'local');
    
    switch (envName) {
        case 'production':
            return 'https://api.work.studio/api/v1/workflow/portal';
        case 'staging':
            return 'https://api.stage.work.studio/api/v1/workflow/portal';
        case 'local':
        default:
            // For local, use portal endpoint 
            return 'http://localhost:8088/api/v1/workflow/portal';
    }
}

/**
 * Check if we're in a non-local environment (requires session handoff)
 */
export function requiresSessionHandoff(): boolean {
    const envName = vscode.workspace.getConfiguration('workstudio').get<string>('environment', 'local');
    return envName === 'production' || envName === 'staging';
}

/**
 * Get the Account service URL for user/tenant resolution.
 */
export function getAccountUrl(): string {
    const config = vscode.workspace.getConfiguration('workStudio');
    const explicit = config.get<string>('accountServiceUrl');
    
    // If explicit URL set, use it
    if (explicit && explicit.trim() !== '') {
        return explicit;
    }
    
    // Derive from environment
    const envName = vscode.workspace.getConfiguration('workstudio').get<string>('environment', 'local');
    
    switch (envName) {
        case 'production':
            return 'https://api.work.studio/api/v1/workflow/account';
        case 'staging':
            return 'https://api.stage.work.studio/api/v1/workflow/account';
        case 'local':
        default:
            return 'http://localhost:8081/api/v1/workflow/account';
    }
}

/**
 * Log current configuration (useful for debugging)
 */
export function logConfiguration(): void {
    const env = getEnvironmentConfig();
    const envName = getEnvironmentName();
    console.log(`[work.studio] Environment: ${envName}`);
    console.log(`[work.studio] Server URL: ${env.serverUrl}`);
    console.log(`[work.studio] Auth URL: ${env.authUrl}`);
    console.log(`[work.studio] Secure mode: ${env.secure}`);
}
