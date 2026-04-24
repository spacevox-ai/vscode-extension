/**
 * work.studio AI VS Code Extension
 * 
 * Provides AI-powered code completion, chat, and governance through the
 * work.studio MCP (Model Context Protocol) server.
 */

import * as vscode from 'vscode';
import { McpClient } from './mcp/McpClient';
import { AuthService } from './auth/AuthService';
import { WorkstudioCompletionProvider } from './completion/CompletionProvider';
import { WorkstudioChatParticipant } from './chat/ChatParticipant';
import { StatusBarManager } from './ui/StatusBar';
import { Logger } from './utils/Logger';
import { getServerUrl, getEnvironmentName, logConfiguration } from './config/EnvironmentConfig';

let mcpClient: McpClient | undefined;
let authService: AuthService | undefined;
let completionProvider: WorkstudioCompletionProvider | undefined;
let chatParticipant: WorkstudioChatParticipant | undefined;
let statusBar: StatusBarManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
    Logger.info('work.studio AI extension activating...');

    // Initialize services
    authService = new AuthService(context);
    mcpClient = new McpClient();
    statusBar = new StatusBarManager();
    completionProvider = new WorkstudioCompletionProvider(mcpClient);
    chatParticipant = new WorkstudioChatParticipant(mcpClient);

    // Register chat participant
    chatParticipant.register(context);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('workstudio.login', () => handleLogin()),
        vscode.commands.registerCommand('workstudio.logout', () => handleLogout()),
        vscode.commands.registerCommand('workstudio.showStatus', () => showStatus()),
        vscode.commands.registerCommand('workstudio.toggleCompletion', () => toggleCompletion()),
        vscode.commands.registerCommand('workstudio.triggerCompletion', () => triggerCompletion()),
        vscode.commands.registerCommand('workstudio.openChat', () => openChat())
    );

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

    Logger.info('work.studio AI extension deactivated');
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleLogin(): Promise<void> {
    if (!authService) {
        vscode.window.showErrorMessage('work.studio: Auth service not initialized');
        return;
    }

    try {
        statusBar?.setStatus('connecting', 'Signing in...');
        
        const token = await authService.login();
        
        if (token) {
            await connectToServer(token);
            vscode.window.showInformationMessage('work.studio: Signed in successfully');
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        Logger.error('Login failed', error);
        vscode.window.showErrorMessage(`work.studio: Sign in failed - ${message}`);
        statusBar?.setStatus('error', 'Sign in failed');
    }
}

async function handleLogout(): Promise<void> {
    try {
        mcpClient?.disconnect();
        await authService?.logout();
        updateStatusBar();
        vscode.window.showInformationMessage('work.studio: Signed out');
    } catch (error) {
        Logger.error('Logout failed', error);
    }
}

function showStatus(): void {
    const connected = mcpClient?.isConnected() ?? false;
    const authenticated = authService?.isAuthenticated() ?? false;
    const config = vscode.workspace.getConfiguration('workstudio');
    const completionEnabled = config.get<boolean>('completion.enabled', true);

    const statusItems = [
        `Connection: ${connected ? '✅ Connected' : '❌ Disconnected'}`,
        `Authentication: ${authenticated ? '✅ Signed in' : '❌ Not signed in'}`,
        `Code Completion: ${completionEnabled ? '✅ Enabled' : '⏸️ Disabled'}`,
        `Server: ${config.get<string>('serverUrl', 'Not configured')}`
    ];

    vscode.window.showInformationMessage(
        'work.studio Status',
        { modal: true, detail: statusItems.join('\n') }
    );
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
    // Open the chat panel and focus on @workstudio
    await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
    // Pre-fill with @workstudio mention
    await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: '@workstudio '
    });
}

// ============================================================================
// Connection Management
// ============================================================================

async function tryAutoConnect(): Promise<void> {
    if (!authService || !mcpClient) {
        return;
    }

    try {
        const token = await authService.getStoredToken();
        if (token && authService.isTokenValid(token)) {
            Logger.info('Found valid stored token, auto-connecting...');
            await connectToServer(token);
        }
    } catch (error) {
        Logger.warn('Auto-connect failed, user will need to sign in manually', error);
    }
}

async function connectToServer(token: string): Promise<void> {
    if (!mcpClient) {
        throw new Error('MCP client not initialized');
    }

    // Get server URL from environment config
    const serverUrl = getServerUrl();
    const envName = getEnvironmentName();
    
    // Log configuration for debugging
    logConfiguration();

    statusBar?.setStatus('connecting', `Connecting to ${envName}...`);
    Logger.info(`Connecting to ${envName}: ${serverUrl}`);

    try {
        await mcpClient.connect(serverUrl, token);
        await mcpClient.initialize();
        
        statusBar?.setStatus('connected', `Connected (${envName})`);
        Logger.info(`Connected to work.studio MCP server (${envName})`);
    } catch (error) {
        statusBar?.setStatus('error', 'Connection failed');
        throw error;
    }
}

function handleConfigurationChange(): void {
    Logger.info('Configuration changed, reconnecting...');
    
    // If connected, reconnect with new configuration
    if (mcpClient?.isConnected()) {
        const token = authService?.getStoredToken();
        if (token) {
            mcpClient.disconnect();
            connectToServer(token as unknown as string).catch(err => {
                Logger.error('Reconnect failed', err);
            });
        }
    }
}

function updateStatusBar(): void {
    if (!statusBar) {
        return;
    }

    if (mcpClient?.isConnected()) {
        statusBar.setStatus('connected', 'work.studio: Connected');
    } else if (authService?.isAuthenticated()) {
        statusBar.setStatus('disconnected', 'work.studio: Disconnected');
    } else {
        statusBar.setStatus('inactive', 'work.studio: Not signed in');
    }
}
