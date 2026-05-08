/**
 * Chat Sidebar Provider
 * 
 * Provides the chat interface as a sidebar view that persists
 * across editor sessions. Registered as a WebviewViewProvider.
 * 
 * Uses the MCP (Model Context Protocol) endpoint for AI chat streaming.
 * This allows direct JWT authentication from IDE clients.
 */

import * as vscode from 'vscode';
import { Logger } from '../../utils/Logger';
import { ToolRegistry } from '../../tools';
import { ChatMessage, ChatAttachment, ToolResult, ToolContext } from '../../tools/types';
import { AuthService } from '../../auth/AuthService';
import { getBranding } from '../../config/BrandingService';
import { getAiEndpoint, getEnvironmentName } from '../../config/EnvironmentConfig';
import { getSseClient } from '../../mcp/SseClient';

interface WebviewMessage {
    type: string;
    payload?: any;
    requestId?: string;
}

export class ChatSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'workStudio.chatView';

    private view?: vscode.WebviewView;
    private messages: ChatMessage[] = [];
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly toolRegistry: ToolRegistry,
        private readonly authService: AuthService
    ) {}

    /**
     * Resolve the webview view
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        Logger.info('ChatSidebarProvider: resolveWebviewView called');
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'media'),
                vscode.Uri.joinPath(this.extensionUri, 'dist'),
                vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'build'),
            ],
        };
        
        Logger.info(`ChatSidebarProvider: extensionUri=${this.extensionUri.toString()}`);

        const html = this.getHtmlContent(webviewView.webview);
        Logger.info(`ChatSidebarProvider: HTML length=${html.length}`);
        webviewView.webview.html = html;

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables
        );

        // Handle visibility changes
        webviewView.onDidChangeVisibility(
            () => {
                if (webviewView.visible) {
                    this.sendToWebview('visibility', { visible: true });
                }
            },
            null,
            this.disposables
        );

        // Listen for branding config changes
        getBranding().onConfigChange(
            () => {
                this.sendToWebview('brandingUpdate', {
                    branding: getBranding().getWebviewConfig(),
                });
            },
            null,
            this.disposables
        );
    }

    /**
     * Handle messages from the webview
     */
    private async handleMessage(message: WebviewMessage): Promise<void> {
        Logger.debug(`ChatSidebar received message: ${message.type}`);

        switch (message.type) {
            case 'ready':
                this.sendToWebview('init', {
                    messages: this.messages,
                    tools: this.toolRegistry.getToolsForAI('openai'),
                    branding: getBranding().getWebviewConfig(),
                });
                // Send connection status after init
                await this.sendConnectionStatus();
                break;

            case 'selectEnvironment':
                // Handle environment switch request
                await this.handleEnvironmentSwitch(message.payload?.envId);
                break;

            case 'sendMessage':
                await this.handleUserMessage(message.payload);
                break;

            case 'executeTool':
                await this.handleToolExecution(message.payload, message.requestId);
                break;

            case 'cancelRequest':
                // Handle cancellation
                break;

            case 'clearHistory':
                this.messages = [];
                this.sendToWebview('historyCleared', {});
                break;

            case 'insertCode':
                await this.insertCodeToEditor(message.payload);
                break;

            case 'copyToClipboard':
                await vscode.env.clipboard.writeText(message.payload.text);
                vscode.window.showInformationMessage('Copied to clipboard');
                break;

            case 'signIn':
                // Trigger the login command
                await vscode.commands.executeCommand('workstudio.login');
                break;

            case 'fetchSessionHistory':
                await this.handleFetchSessionHistory(message.payload);
                break;

            case 'loadSession':
                await this.handleLoadSession(message.payload?.sessionId);
                break;

            default:
                Logger.warn(`Unknown message type: ${message.type}`);
        }
    }

    /**
     * Fetch user's session history from the API
     * 
     * Security note: The API uses JWT authentication to identify the user.
     * Users can only see their own sessions - no spoofing possible.
     */
    private async handleFetchSessionHistory(payload?: { agentId?: string; sessionContext?: string; limit?: number }): Promise<void> {
        try {
            const client = getSseClient(getAiEndpoint());
            // Pass sessionContext to filter by context type (e.g., 'CONVERSATION' for vscode sessions)
            const response = await client.getMySessions(
                payload?.agentId, 
                payload?.sessionContext,
                payload?.limit || 20
            );
            
            this.sendToWebview('sessionHistory', {
                sessions: response.sessions || [],
                count: response.count || 0,
                success: response.success,
                error: response.error,
            });
        } catch (error) {
            Logger.error('Failed to fetch session history', error);
            this.sendToWebview('sessionHistory', {
                sessions: [],
                count: 0,
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch session history',
            });
        }
    }

    /**
     * Load a previous session's conversation
     */
    private async handleLoadSession(sessionId?: string): Promise<void> {
        if (!sessionId) {
            Logger.warn('No sessionId provided for loadSession');
            return;
        }
        
        try {
            // TODO: Implement loading session history from API
            // For now, just clear current history and notify the webview
            Logger.info(`Loading session: ${sessionId}`);
            this.messages = [];
            this.sendToWebview('sessionLoaded', {
                sessionId,
                success: true,
                message: 'Session loaded. Continue your conversation.',
            });
        } catch (error) {
            Logger.error('Failed to load session', error);
            this.sendToWebview('sessionLoaded', {
                sessionId,
                success: false,
                error: error instanceof Error ? error.message : 'Failed to load session',
            });
        }
    }

    /**
     * Handle user message submission
     */
    private async handleUserMessage(payload: { content: string; attachments?: ChatAttachment[] }): Promise<void> {
        const userMessage: ChatMessage = {
            id: this.generateId(),
            role: 'user',
            content: payload.content,
            timestamp: Date.now(),
            attachments: payload.attachments,
        };

        this.messages.push(userMessage);
        this.sendToWebview('messageAdded', userMessage);

        // Create assistant placeholder
        const assistantMessage: ChatMessage = {
            id: this.generateId(),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        };

        this.messages.push(assistantMessage);
        this.sendToWebview('messageAdded', assistantMessage);

        try {
            await this.streamAIResponse(payload.content, assistantMessage.id, payload.attachments);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            Logger.error(`Stream error: ${errorMsg}`);
            this.sendToWebview('streamError', { 
                messageId: assistantMessage.id, 
                error: errorMsg 
            });
        }
    }

    /**
     * Refresh connection status in the webview
     * Called by extension.ts when authentication state changes
     */
    public async refreshConnectionStatus(): Promise<void> {
        Logger.info('refreshConnectionStatus called');
        await this.sendConnectionStatus();
    }

    /**
     * Clear any cached state (called on logout)
     */
    public clearSession(): void {
        Logger.info('clearSession called - clearing messages and resetting state');
        this.messages = [];
        this.sendToWebview('historyCleared', {});
    }

    /**
     * Stream AI response with tool execution
     */
    private async streamAIResponse(userInput: string, messageId: string, attachments?: ChatAttachment[]): Promise<void> {
        const config = vscode.workspace.getConfiguration('workStudio');
        const agentId = config.get<string>('agentId', '019d5a01-1001-7001-8001-000000000050');

        // Get JWT token from auth service
        const keycloakToken = await this.authService.getStoredToken();
        if (!keycloakToken) {
            throw new Error('Not authenticated. Please sign in first using the "work.studio: Sign In" command.');
        }

        // Get tenant/env from resolved identity
        const tenantId = await this.authService.getTenantId();
        const envId = await this.authService.getEnvId();
        
        console.log(`[work.studio] Chat context - tenantId: ${tenantId}, envId: ${envId}`);
        
        if (!tenantId) {
            throw new Error('No tenant ID found. Please sign out and sign in again.');
        }
        
        if (!envId) {
            // Try to get environments and prompt selection
            const environments = await this.authService.getEnvironments();
            console.log(`[work.studio] No envId stored, found ${environments?.length || 0} environments in storage`);
            
            if (environments && environments.length > 0) {
                throw new Error('No environment selected. Please run "work.studio: Select Environment" from the command palette.');
            } else {
                throw new Error('No environments available. Please sign out and sign in again.');
            }
        }

        // Use MCP endpoint directly with JWT - no session handoff needed
        // The MCP endpoint is designed for IDE clients and accepts JWT auth
        const chatUrl = `${getAiEndpoint()}/chat/stream`;

        Logger.info(`Streaming to: ${chatUrl} with agentId: ${agentId}, tenant: ${tenantId}, env: ${envId}, environment: ${getEnvironmentName()}, attachments: ${attachments?.length || 0}`);

        // Build conversation history as context string

        // Build conversation history as context string
        const history = this.messages
            .filter(m => m.content && m.id !== messageId)
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');

        // Build workspace context
        const workspaceContext = await this.buildWorkspaceContext();

        // Prepare inline attachments for the request
        const inlineAttachments = attachments?.map(a => ({
            type: a.type,
            name: a.name,
            data: a.data,  // base64 data URL
            size: a.size
        }));

        try {
            const response = await fetch(chatUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${keycloakToken}`,
                    'Accept': 'text/event-stream',
                    'X-SELECTED-TENANT': tenantId,
                    'X-SELECTED-ENV': envId,
                },
                body: JSON.stringify({
                    message: userInput,
                    agentId: agentId,
                    context: workspaceContext,
                    history: history || undefined,
                    attachments: inlineAttachments,
                }),
            });

            Logger.info(`Response status: ${response.status}`);

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'No body');
                
                // If auth failed, suggest re-login
                if (response.status === 401 || response.status === 403) {
                    Logger.warn('Authentication failed - may need to sign in again');
                }
                
                throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            if (!response.body) {
                throw new Error('No response body');
            }

            await this.processStream(response.body, messageId);

        } catch (error) {
            Logger.error(`Fetch error: ${error}`);
            throw error;
        }
    }

    /**
     * Build workspace context for the AI
     */
    private async buildWorkspaceContext(): Promise<string> {
        const parts: string[] = [];
        
        // Get workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            parts.push(`Workspace: ${workspaceFolders.map(f => f.name).join(', ')}`);
        }

        // Get active editor info
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const doc = editor.document;
            const relativePath = vscode.workspace.asRelativePath(doc.uri);
            parts.push(`Active file: ${relativePath}`);
            parts.push(`Language: ${doc.languageId}`);
            
            // Include selection or visible code
            const selection = editor.selection;
            if (!selection.isEmpty) {
                // User has selected code - include it
                const selectedText = doc.getText(selection);
                parts.push(`Selected code (lines ${selection.start.line + 1}-${selection.end.line + 1}):\n\`\`\`${doc.languageId}\n${selectedText}\n\`\`\``);
            } else {
                // No selection - include visible range of the file
                const visibleRanges = editor.visibleRanges;
                if (visibleRanges.length > 0) {
                    const visibleRange = visibleRanges[0];
                    const startLine = Math.max(0, visibleRange.start.line);
                    const endLine = Math.min(doc.lineCount - 1, visibleRange.end.line);
                    const visibleText = doc.getText(new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length));
                    
                    // Limit to reasonable size (max 100 lines or 5000 chars)
                    const lines = visibleText.split('\n');
                    const limitedText = lines.length > 100 ? lines.slice(0, 100).join('\n') + '\n... (truncated)' : visibleText;
                    const finalText = limitedText.length > 5000 ? limitedText.substring(0, 5000) + '\n... (truncated)' : limitedText;
                    
                    parts.push(`Visible code (lines ${startLine + 1}-${Math.min(startLine + 100, endLine + 1)}):\n\`\`\`${doc.languageId}\n${finalText}\n\`\`\``);
                }
            }
        }

        return parts.join('\n');
    }

    /**
     * Process SSE stream
     */
    private async processStream(body: ReadableStream<Uint8Array>, messageId: string): Promise<void> {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let currentEventName = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    // Handle event name line (event: xxx)
                    if (line.startsWith('event:')) {
                        currentEventName = line.slice(6).trim();
                        continue;
                    }
                    
                    if (!line.startsWith('data:')) continue;
                    
                    const data = line.slice(5).trim();
                    
                    if (data === '[DONE]') {
                        this.sendToWebview('streamComplete', { messageId });
                        continue;
                    }

                    try {
                        const event = JSON.parse(data);
                        const content = await this.handleStreamEvent(event, messageId, currentEventName);
                        if (content) {
                            fullContent += content;
                        }
                    } catch (e) {
                        // Silently ignore parse errors
                    }
                    
                    // Reset event name after processing data
                    currentEventName = '';
                }
            }

            // Update stored message
            const msg = this.messages.find(m => m.id === messageId);
            if (msg) msg.content = fullContent;

            // Send final complete if not already sent
            this.sendToWebview('streamComplete', { messageId });

        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Handle stream event from ai-runtime SSE
     * 
     * Server sends events like:
     * - event: token, data: {type: "token", content: "..."}
     * - event: thinking, data: {type: "thinking", content: "..."}
     * - event: tool_start, data: {type: "tool_call_start", toolCallId: "...", toolName: "..."}
     * - event: tool_complete, data: {type: "tool_call_complete", toolCallId: "...", result: "..."}
     * - event: error, data: {type: "error", code: "...", message: "..."}
     */
    private async handleStreamEvent(event: any, messageId: string, eventName?: string): Promise<string | null> {
        // Use event name from SSE or fall back to type field in data
        const type = eventName || event.type;
        
        switch (type) {
            case 'token':
            case 'content':
                // Content token - stream to UI
                const content = event.content || '';
                if (content) {
                    this.sendToWebview('streamContent', { messageId, content });
                }
                return content;

            case 'thinking':
                // Extended thinking from Claude
                const thinking = event.content || event.thinking || '';
                if (thinking) {
                    this.sendToWebview('streamThinking', { messageId, thinking });
                }
                return null;

            case 'tool_start':
            case 'tool_call_start':
                // Tool execution starting
                this.sendToWebview('toolCallStart', { 
                    messageId, 
                    toolCall: {
                        id: event.toolCallId,
                        name: event.toolName,
                        showProgress: event.showProgress,
                        timeoutSeconds: event.timeoutSeconds
                    }
                });
                return null;

            case 'tool_complete':
            case 'tool_call_complete':
                // Tool execution completed
                this.sendToWebview('toolCallComplete', {
                    messageId,
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    success: event.success,
                    result: event.result,
                });
                return null;

            case 'error':
                // Error event
                const errorMsg = event.message || event.error || 'Unknown error';
                this.sendToWebview('streamError', { messageId, error: errorMsg, code: event.code });
                return null;

            case 'metrics':
                // Metrics event - can be logged or displayed
                Logger.info(`Stream metrics: ${JSON.stringify(event)}`);
                return null;

            default:
                Logger.info(`Unknown event type: ${type}, data: ${JSON.stringify(event)}`);
                return null;
        }
    }

    /**
     * Execute tool from AI request
     */
    private async executeToolFromAI(toolCall: { 
        id: string; 
        name: string; 
        arguments: string | object 
    }): Promise<ToolResult> {
        const args = typeof toolCall.arguments === 'string'
            ? JSON.parse(toolCall.arguments)
            : toolCall.arguments;

        const context = this.createToolContext();
        return await this.toolRegistry.execute(toolCall.name, args, context);
    }

    /**
     * Handle direct tool execution from UI
     */
    private async handleToolExecution(
        payload: { tool: string; arguments: Record<string, any> },
        requestId?: string
    ): Promise<void> {
        const context = this.createToolContext();

        try {
            const result = await this.toolRegistry.execute(
                payload.tool,
                payload.arguments,
                context
            );
            this.sendToWebview('toolResult', { requestId, result });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.sendToWebview('toolError', { requestId, error: errorMsg });
        }
    }

    /**
     * Insert code into active editor
     */
    private async insertCodeToEditor(payload: { code: string; language?: string }): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        
        if (!editor) {
            vscode.window.showWarningMessage('No active editor to insert code into');
            return;
        }

        await editor.edit(editBuilder => {
            if (editor.selection.isEmpty) {
                editBuilder.insert(editor.selection.active, payload.code);
            } else {
                editBuilder.replace(editor.selection, payload.code);
            }
        });
    }

    /**
     * Build system prompt with context
     */
    private buildSystemPrompt(): string {
        const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.name) || [];
        const activeFile = vscode.window.activeTextEditor
            ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri)
            : null;

        return `You are work.studio AI, a helpful coding assistant integrated into VS Code.

WORKSPACE CONTEXT:
- Workspace folders: ${workspaceFolders.join(', ') || 'None'}
- Active file: ${activeFile || 'None'}

CAPABILITIES:
You have access to tools that allow you to:
- Read, write, and search files
- Execute terminal commands
- Navigate and edit code
- Get workspace and git information

GUIDELINES:
1. Use tools to gather context before making changes
2. Explain what you're doing before executing tools
3. When editing files, use precise text replacement
4. Be concise but thorough in explanations
5. Ask for clarification if the request is ambiguous`;
    }

    /**
     * Create tool execution context
     */
    private createToolContext(): ToolContext {
        const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
        
        return {
            cwd: workspaceFolders[0] || process.cwd(),
            workspaceFolders,
            config: {
                maxFileSize: 1024 * 1024,
                timeout: 60000,
                blockedPatterns: ['**/node_modules/**', '**/.git/**'],
                requireConfirmation: true,
            },
        };
    }

    /**
     * Send connection status to webview
     */
    private async sendConnectionStatus(): Promise<void> {
        try {
            const isAuthenticated = this.authService.isAuthenticated();
            const tenantId = await this.authService.getTenantId();
            
            // Get full environment list and current environment from AuthService
            const environments = await this.authService.getEnvironments();
            const currentEnv = await this.authService.getCurrentEnvironment();

            this.sendToWebview('connectionStatus', {
                isConnected: isAuthenticated && !!tenantId,
                currentEnv,
                environments,
            });
        } catch (error) {
            Logger.warn('Failed to send connection status', error);
            this.sendToWebview('connectionStatus', {
                isConnected: false,
                currentEnv: null,
                environments: [],
            });
        }
    }

    /**
     * Handle environment switch request from webview
     */
    private async handleEnvironmentSwitch(envId: string): Promise<void> {
        if (!envId) return;
        
        Logger.info(`Switching to environment: ${envId}`);
        
        // Store the new environment selection
        await this.authService.setEnvId(envId);
        
        // Clear chat history when switching environments (optional but recommended)
        // this.messages = [];
        // this.sendToWebview('historyCleared', {});
        
        // Send updated status to reflect the change
        await this.sendConnectionStatus();
        
        // Show notification
        const environments = await this.authService.getEnvironments();
        const newEnv = environments.find(e => e.id === envId);
        if (newEnv) {
            vscode.window.showInformationMessage(`Switched to environment: ${newEnv.name}`);
        }
    }

    /**
     * Send message to webview
     */
    private sendToWebview(type: string, payload: any): void {
        this.view?.webview.postMessage({ type, payload });
    }

    /**
     * Generate unique ID
     */
    private generateId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get HTML content
     */
    private getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'build', 'assets', 'index.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'build', 'assets', 'index.css')
        );

        const nonce = this.getNonce();
        
        Logger.info(`ChatSidebar: Loading webview with script: ${scriptUri.toString()}`);
        Logger.info(`ChatSidebar: Loading webview with style: ${styleUri.toString()}`);

        return /* html */ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" 
                    content="default-src 'none'; 
                        style-src ${webview.cspSource} 'unsafe-inline'; 
                        script-src 'nonce-${nonce}' 'unsafe-eval';
                        connect-src ${webview.cspSource} http://localhost:* https://*;
                        img-src ${webview.cspSource} data:;
                        font-src ${webview.cspSource};">
                <link rel="stylesheet" href="${styleUri}">
                <title>work.studio Chat</title>
                <style>
                    html, body, #root {
                        height: 100%;
                        margin: 0;
                        padding: 0;
                        overflow: hidden;
                    }
                    body {
                        background: var(--vscode-sideBar-background);
                        color: var(--vscode-sideBar-foreground);
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                    }
                    .loading-fallback {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100%;
                        color: var(--vscode-descriptionForeground);
                    }
                    .error-fallback {
                        padding: 16px;
                        color: var(--vscode-errorForeground);
                        background: var(--vscode-inputValidation-errorBackground);
                        margin: 8px;
                        border-radius: 4px;
                        font-size: 12px;
                        white-space: pre-wrap;
                    }
                </style>
            </head>
            <body>
                <div id="root"><div class="loading-fallback">Loading work.studio...</div></div>
                <script nonce="${nonce}">
                    // Acquire VS Code API BEFORE module loads
                    window.vscodeApi = acquireVsCodeApi();
                    
                    // Error boundary for debugging
                    window.onerror = function(msg, url, line, col, error) {
                        const root = document.getElementById('root');
                        if (root) {
                            root.innerHTML = '<div class="error-fallback">Error loading work.studio:\\n' + 
                                msg + '\\nLine: ' + line + ', Col: ' + col + '</div>';
                        }
                        console.error('work.studio error:', msg, url, line, col, error);
                        return false;
                    };
                </script>
                <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    /**
     * Generate nonce
     */
    private getNonce(): string {
        let text = '';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return text;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        while (this.disposables.length) {
            const d = this.disposables.pop();
            d?.dispose();
        }
    }
}
