/**
 * work.studio AI VS Code Extension
 * 
 * Provides AI-powered code completion, chat, and governance through the
 * work.studio MCP (Model Context Protocol) server.
 * 
 * Features:
 * - Custom Chat UI with sidebar (work.studio branding)
 * - Tool system for file/terminal/editor operations
 * - Streaming AI responses with tool execution
 * - GitHub Copilot chat participant integration
 */

import * as vscode from 'vscode';
import { McpClient } from './mcp/McpClient';
import { AuthService } from './auth/AuthService';
import { WorkStudioAuthProvider, AUTH_PROVIDER_ID } from './auth/WorkStudioAuthProvider';
import { WorkstudioCompletionProvider } from './completion/CompletionProvider';
import { WorkstudioChatParticipant } from './chat/ChatParticipant';
import { StatusBarManager } from './ui/StatusBar';
import { Logger } from './utils/Logger';
import { getServerUrl, getEnvironmentName, getAiEndpoint, logConfiguration } from './config/EnvironmentConfig';
import { ToolRegistry, registerAllTools } from './tools';
import { ChatPanel, ChatSidebarProvider, StatusPanelProvider } from './webview';
import { BrandingService, getBranding } from './config/BrandingService';

let mcpClient: McpClient | undefined;
let authService: AuthService | undefined;
let completionProvider: WorkstudioCompletionProvider | undefined;
let chatParticipant: WorkstudioChatParticipant | undefined;
let statusBar: StatusBarManager | undefined;
let toolRegistry: ToolRegistry | undefined;
let chatSidebarProvider: ChatSidebarProvider | undefined;
let extensionUri: vscode.Uri | undefined;

export async function activate(context: vscode.ExtensionContext) {
    Logger.info('work.studio AI extension activating...');

    // Store extension URI for later use
    extensionUri = context.extensionUri;

    // Initialize branding service first
    await BrandingService.getInstance().initialize(context);

    // Register VS Code Authentication Provider (native accounts integration)
    WorkStudioAuthProvider.register(context);

    // Initialize services
    authService = new AuthService(context);
    mcpClient = new McpClient();
    statusBar = new StatusBarManager();
    completionProvider = new WorkstudioCompletionProvider(mcpClient);
    chatParticipant = new WorkstudioChatParticipant(mcpClient);
    
    // Add status bar to subscriptions so it persists
    context.subscriptions.push(statusBar);

    // Initialize tool system
    toolRegistry = ToolRegistry.getInstance();
    registerAllTools(toolRegistry);
    Logger.info(`Registered ${toolRegistry.getAllTools().length} tools`);

    // Initialize custom chat sidebar (requires authService)
    chatSidebarProvider = new ChatSidebarProvider(context.extensionUri, toolRegistry, authService);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatSidebarProvider.viewType,
            chatSidebarProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Register chat participant
    chatParticipant.register(context);

    // Register commands
    Logger.info('Registering commands...');
    context.subscriptions.push(
        vscode.commands.registerCommand('workstudio.login', () => {
            Logger.info('workstudio.login command triggered');
            return handleLogin();
        }),
        vscode.commands.registerCommand('workstudio.logout', () => {
            Logger.info('workstudio.logout command triggered');
            return handleLogout();
        }),
        vscode.commands.registerCommand('workstudio.selectEnvironment', () => {
            Logger.info('workstudio.selectEnvironment command triggered');
            return authService.selectEnvironment();
        }),
        vscode.commands.registerCommand('workstudio.showStatus', () => showStatus()),
        vscode.commands.registerCommand('workstudio.toggleCompletion', () => toggleCompletion()),
        vscode.commands.registerCommand('workstudio.triggerCompletion', () => triggerCompletion()),
        vscode.commands.registerCommand('workstudio.openChat', () => openChat()),
        vscode.commands.registerCommand('workstudio.openChatPanel', () => openChatPanel(context))
    );
    Logger.info('Commands registered');

    // Register completion provider for all languages
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            completionProvider
        )
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('workstudio')) {
                handleConfigurationChange();
            }
        })
    );

    // Listen for authentication session changes (sign in/out from accounts menu)
    context.subscriptions.push(
        vscode.authentication.onDidChangeSessions(async e => {
            if (e.provider.id === AUTH_PROVIDER_ID) {
                Logger.info('work.studio authentication session changed');
                
                // Check if we have a session
                const session = await vscode.authentication.getSession(
                    AUTH_PROVIDER_ID,
                    ['openid', 'profile', 'email'],
                    { createIfNone: false, silent: true }
                );
                
                if (session) {
                    Logger.info('Session found, connecting...');
                    await connectToServer(session.accessToken);
                } else {
                    Logger.info('Session removed, updating status');
                    mcpClient?.disconnect();
                    chatSidebarProvider?.clearSession();
                    updateStatusBar();
                }
            }
        })
    );

    // Try to auto-connect if we have stored credentials
    await tryAutoConnect();

    // Update status bar
    updateStatusBar();

    Logger.info('work.studio AI extension activated');
}

export function deactivate() {
    Logger.info('work.studio AI extension deactivating...');
    
    mcpClient?.disconnect();
    chatParticipant?.dispose();
    statusBar?.dispose();
    chatSidebarProvider?.dispose();
    ChatPanel.currentPanel?.dispose();

    Logger.info('work.studio AI extension deactivated');
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleLogin(): Promise<void> {
    Logger.info('handleLogin called');
    
    try {
        statusBar?.setStatus('connecting');
        Logger.info('Starting login flow via VS Code authentication...');
        
        // Use VS Code's native authentication - this integrates with accounts menu
        const session = await vscode.authentication.getSession(
            AUTH_PROVIDER_ID,
            ['openid', 'profile', 'email'],
            { createIfNone: true }
        );
        
        Logger.info(`Login completed, session: ${session ? 'yes' : 'no'}`);
        
        if (session) {
            await connectToServer(session.accessToken);
            vscode.window.showInformationMessage('work.studio: Signed in successfully');
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        Logger.error('Login failed', error);
        vscode.window.showErrorMessage(`work.studio: Sign in failed - ${message}`);
        statusBar?.setStatus('error');
    }
}

async function handleLogout(): Promise<void> {
    try {
        mcpClient?.disconnect();
        
        // Clear VS Code authentication session
        // Note: VS Code doesn't have a direct "logout" API, but the auth provider handles it
        await authService?.logout();
        
        chatSidebarProvider?.clearSession();  // Clear cached AI session
        updateStatusBar();
        vscode.window.showInformationMessage('work.studio: Signed out');
    } catch (error) {
        Logger.error('Logout failed', error);
    }
}

function showStatus(): void {
    if (!extensionUri) {
        vscode.window.showErrorMessage('Extension not fully initialized');
        return;
    }
    
    const authenticated = authService?.isAuthenticated() ?? false;
    const config = vscode.workspace.getConfiguration('workstudio');
    const completionEnabled = config.get<boolean>('completion.enabled', true);

    StatusPanelProvider.show(extensionUri, authenticated, completionEnabled);
}

function toggleCompletion(): void {
    const config = vscode.workspace.getConfiguration('workstudio');
    const currentValue = config.get<boolean>('completion.enabled', true);
    config.update('completion.enabled', !currentValue, vscode.ConfigurationTarget.Global);
    
    vscode.window.showInformationMessage(
        `work.studio: Code completion ${!currentValue ? 'enabled' : 'disabled'}`
    );
}

async function triggerCompletion(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    // Trigger inline completion
    await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
}

async function openChat(): Promise<void> {
    // Open the custom work.studio sidebar chat view
    await vscode.commands.executeCommand('workStudio.chatView.focus');
}

function openChatPanel(context: vscode.ExtensionContext): void {
    if (!toolRegistry) {
        vscode.window.showErrorMessage('work.studio: Tool system not initialized');
        return;
    }
    
    ChatPanel.createOrShow(context.extensionUri, toolRegistry);
}

// ============================================================================
// Connection Management
// ============================================================================

async function tryAutoConnect(): Promise<void> {
    if (!authService || !mcpClient) {
        return;
    }

    try {
        // First, try VS Code's native authentication (silent check)
        // This integrates with VS Code's accounts system
        let session = await vscode.authentication.getSession(
            AUTH_PROVIDER_ID,
            ['openid', 'profile', 'email'],
            { createIfNone: false, silent: true }
        );
        
        if (session) {
            Logger.info('Found existing VS Code session, connecting...');
            await connectToServer(session.accessToken);
            return;
        }
        
        // Fallback: Check legacy token storage
        const token = await authService.getStoredToken();
        if (token && authService.isTokenValid(token)) {
            Logger.info('Found valid stored token, auto-connecting...');
            
            // Check if we have tenant info, if not resolve it
            const tenantId = await authService.getTenantId();
            if (!tenantId) {
                Logger.info('No tenant ID stored, resolving platform identity...');
                await authService.resolvePlatformIdentityPublic(token);
            }
            
            await connectToServer(token);
        } else {
            // No valid token - update status bar to show sign-in prompt
            Logger.info('No valid token found, prompting for sign in...');
            statusBar?.setStatus('inactive');
            
            // Show sign-in prompt after a short delay to not interrupt startup
            setTimeout(async () => {
                const action = await vscode.window.showInformationMessage(
                    'work.studio: Sign in to enable AI features',
                    'Sign In',
                    'Later'
                );
                
                if (action === 'Sign In') {
                    // Use VS Code's native auth flow
                    await vscode.authentication.getSession(
                        AUTH_PROVIDER_ID,
                        ['openid', 'profile', 'email'],
                        { createIfNone: true }
                    );
                }
            }, 2000);
        }
    } catch (error) {
        Logger.warn('Auto-connect failed, user will need to sign in manually', error);
    }
}

async function connectToServer(token: string): Promise<void> {
    // Get server URL from environment config
    const serverUrl = getServerUrl();
    const envName = getEnvironmentName();
    
    // Log configuration for debugging
    logConfiguration();

    // Get tenant/env from AuthService for RLS context
    const tenantId = await authService?.getTenantId();
    const envId = await authService?.getEnvId();
    Logger.info(`Using tenant: ${tenantId}, env: ${envId}`);

    statusBar?.setStatus('connecting', `Connecting to ${envName}...`);
    Logger.info(`Connecting to ${envName}: ${serverUrl}`);

    try {
        // WebSocket MCP client disabled - using HTTP/SSE only for sidebar chat
        // await mcpClient.connect(serverUrl, token, tenantId || undefined, envId || undefined);
        // await mcpClient.initialize();
        
        // Convert WebSocket URL to HTTP URL for SSE sidebar chat
        const httpUrl = serverUrl
            .replace('ws://', 'http://')
            .replace('wss://', 'https://')
            .replace('/ws/mcp', '');
        
        // SSE client for native chat participant (if used)
        chatParticipant?.initializeSseClient(httpUrl, token);
        Logger.info(`HTTP/SSE endpoint ready: ${httpUrl}`);
        
        statusBar?.setStatus('connected', `Connected (${envName})`);
        Logger.info(`Connected to work.studio (${envName}) - HTTP/SSE mode`);
    } catch (error) {
        statusBar?.setStatus('error', 'Connection failed');
        throw error;
    }
}

function handleConfigurationChange(): void {
    Logger.info('Configuration changed');
    
    // In HTTP/SSE mode, no persistent connection to manage
    // Just update the status bar
    updateStatusBar();
}

function updateStatusBar(): void {
    Logger.info('updateStatusBar called');
    if (!statusBar) {
        Logger.warn('updateStatusBar: statusBar is undefined!');
        return;
    }

    // In HTTP/SSE mode, "connected" means authenticated
    const isAuth = authService?.isAuthenticated() ?? false;
    Logger.info(`updateStatusBar: isAuthenticated=${isAuth}`);
    
    if (isAuth) {
        const envName = getEnvironmentName();
        statusBar.setStatus('connected', `work.studio: Ready (${envName})`);
    } else {
        statusBar.setStatus('inactive', 'work.studio: Not signed in');
    }
}
