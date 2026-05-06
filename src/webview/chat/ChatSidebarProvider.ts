/**
 * Chat Sidebar Provider
 * 
 * Provides the chat interface as a sidebar view that persists
 * across editor sessions. Registered as a WebviewViewProvider.
 */

import * as vscode from 'vscode';
import { Logger } from '../../utils/Logger';
import { ToolRegistry } from '../../tools';
import { ChatMessage, ToolResult, ToolContext } from '../../tools/types';
import { AuthService } from '../../auth/AuthService';
import { getBranding } from '../../config/BrandingService';

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
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'media'),
                vscode.Uri.joinPath(this.extensionUri, 'dist'),
                vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'build'),
            ],
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

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

            default:
                Logger.warn(`Unknown message type: ${message.type}`);
        }
    }

    /**
     * Handle user message submission
     */
    private async handleUserMessage(payload: { content: string }): Promise<void> {
        const userMessage: ChatMessage = {
            id: this.generateId(),
            role: 'user',
            content: payload.content,
            timestamp: Date.now(),
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
            await this.streamAIResponse(payload.content, assistantMessage.id);
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
     * Stream AI response with tool execution
     */
    private async streamAIResponse(userInput: string, messageId: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('workStudio');
        const endpoint = config.get<string>('aiEndpoint', 'http://localhost:8102/api/v1/workflow/ai-runtime/mcp');
        const agentId = config.get<string>('agentId', '00000000-0000-0000-0000-000000000001');

        // Get JWT token from auth service
        const token = await this.authService.getStoredToken();
        if (!token) {
            throw new Error('Not authenticated. Please sign in first using the "work.studio: Sign In" command.');
        }

        // Get tenant/env from resolved identity (or fallback to config)
        const tenantId = await this.authService.getTenantId() 
            || config.get<string>('tenantId', '00000000-0000-0000-0000-000000000001');
        const envId = await this.authService.getEnvId() 
            || config.get<string>('envId', '00000000-0000-0000-0000-000000000001');

        Logger.info(`Streaming to: ${endpoint}/chat/stream with agentId: ${agentId}, tenant: ${tenantId}, env: ${envId}`);

        // Build conversation history as context string
        const history = this.messages
            .filter(m => m.content && m.id !== messageId)
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');

        // Build workspace context
        const workspaceContext = await this.buildWorkspaceContext();

        try {
            const response = await fetch(`${endpoint}/chat/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'text/event-stream',
                    'X-SELECTED-TENANT': tenantId,
                    'X-SELECTED-ENV': envId,
                },
                body: JSON.stringify({
                    message: userInput,
                    agentId: agentId,
                    context: workspaceContext,
                    history: history || undefined,
                }),
            });

            Logger.info(`Response status: ${response.status}`);

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'No body');
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
            parts.push(`Active file: ${doc.fileName}`);
            parts.push(`Language: ${doc.languageId}`);
            
            // Include selection or surrounding context
            const selection = editor.selection;
            if (!selection.isEmpty) {
                const selectedText = doc.getText(selection);
                parts.push(`Selected code:\n\`\`\`${doc.languageId}\n${selectedText}\n\`\`\``);
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

        return /* html */ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" 
                    content="default-src 'none'; 
                        style-src ${webview.cspSource} 'unsafe-inline'; 
                        script-src 'nonce-${nonce}';
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
                </style>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
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
