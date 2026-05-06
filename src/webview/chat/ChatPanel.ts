/**
 * Chat Panel
 * 
 * VS Code Webview Panel for the work.studio chat interface.
 * Manages the webview lifecycle and communication between
 * the extension host and the React UI.
 */

import * as vscode from 'vscode';
import { Logger } from '../../utils/Logger';
import { ToolRegistry } from '../../tools';
import { ChatMessage, ToolResult, ToolContext } from '../../tools/types';
import { getAiEndpoint } from '../../config/EnvironmentConfig';

interface WebviewMessage {
    type: string;
    payload?: any;
    requestId?: string;
}

export class ChatPanel {
    public static currentPanel: ChatPanel | undefined;
    private static readonly viewType = 'workStudioChat';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private messages: ChatMessage[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly toolRegistry: ToolRegistry
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Set initial HTML content
        this.updateWebview();

        // Listen for panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => this.handleMessage(message),
            null,
            this.disposables
        );

        // Update webview when it becomes visible
        this.panel.onDidChangeViewState(
            e => {
                if (this.panel.visible) {
                    this.updateWebview();
                }
            },
            null,
            this.disposables
        );
    }

    /**
     * Create or show the chat panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        toolRegistry: ToolRegistry
    ): ChatPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.panel.reveal(column);
            return ChatPanel.currentPanel;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            ChatPanel.viewType,
            'work.studio Chat',
            column || vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'dist'),
                    vscode.Uri.joinPath(extensionUri, 'webview-ui', 'build'),
                ],
            }
        );

        // Set panel icon
        panel.iconPath = {
            light: vscode.Uri.joinPath(extensionUri, 'media', 'icon-light.svg'),
            dark: vscode.Uri.joinPath(extensionUri, 'media', 'icon-dark.svg'),
        };

        ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, toolRegistry);
        return ChatPanel.currentPanel;
    }

    /**
     * Handle messages from the webview
     */
    private async handleMessage(message: WebviewMessage): Promise<void> {
        Logger.debug(`ChatPanel received message: ${message.type}`);

        switch (message.type) {
            case 'ready':
                // Webview is ready, send initial state
                this.sendToWebview('init', {
                    messages: this.messages,
                    tools: this.toolRegistry.getToolsForAI('openai'),
                });
                break;

            case 'sendMessage':
                await this.handleUserMessage(message.payload);
                break;

            case 'executeTool':
                await this.handleToolExecution(message.payload, message.requestId);
                break;

            case 'cancelRequest':
                // Handle request cancellation
                break;

            case 'clearHistory':
                this.messages = [];
                this.sendToWebview('historyCleared', {});
                break;

            default:
                Logger.warn(`Unknown message type: ${message.type}`);
        }
    }

    /**
     * Handle user message and stream response
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

        // Create assistant message placeholder
        const assistantMessage: ChatMessage = {
            id: this.generateId(),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
        };

        this.messages.push(assistantMessage);
        this.sendToWebview('messageAdded', assistantMessage);

        try {
            // Stream response from AI
            await this.streamAIResponse(payload.content, assistantMessage.id);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.sendToWebview('streamError', { 
                messageId: assistantMessage.id, 
                error: errorMsg 
            });
        }
    }

    /**
     * Stream AI response
     */
    private async streamAIResponse(userInput: string, messageId: string): Promise<void> {
        // Get AI endpoint from configuration
        const config = vscode.workspace.getConfiguration('workStudio');
        const endpoint = getAiEndpoint();
        const apiKey = config.get<string>('apiKey', '');

        // Prepare messages for API
        const apiMessages = this.messages
            .filter(m => m.role !== 'system' || m.content)
            .map(m => ({
                role: m.role,
                content: m.content,
            }));

        // Get tools in OpenAI format
        const tools = this.toolRegistry.getToolsForAI('openai');

        try {
            const response = await fetch(`${endpoint}/chat/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': apiKey ? `Bearer ${apiKey}` : '',
                    'Accept': 'text/event-stream',
                },
                body: JSON.stringify({
                    messages: apiMessages,
                    tools,
                    stream: true,
                }),
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status} ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error('No response body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            let currentEventName = '';

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    Logger.info('Stream complete');
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                // Process SSE events
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    // Handle event name line
                    if (line.startsWith('event: ')) {
                        currentEventName = line.slice(7).trim();
                        continue;
                    }
                    
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        
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
                        } catch (parseError) {
                            Logger.warn(`Failed to parse SSE event: ${data}`);
                        }
                        
                        // Reset event name after processing
                        currentEventName = '';
                    }
                }
            }

            // Update message with final content
            const message = this.messages.find(m => m.id === messageId);
            if (message) {
                message.content = fullContent;
            }
            
            // Send final complete
            this.sendToWebview('streamComplete', { messageId });

        } catch (error) {
            throw error;
        }
    }

    /**
     * Handle individual stream events from ai-runtime SSE
     */
    private async handleStreamEvent(event: any, messageId: string, eventName?: string): Promise<string | null> {
        const type = eventName || event.type;
        
        switch (type) {
            case 'token':
            case 'content':
                const content = event.content || '';
                if (content) {
                    this.sendToWebview('streamContent', { messageId, content });
                }
                return content;

            case 'thinking':
                const thinking = event.content || event.thinking || '';
                if (thinking) {
                    this.sendToWebview('streamThinking', { messageId, thinking });
                }
                return null;

            case 'tool_start':
            case 'tool_call_start':
                this.sendToWebview('toolCallStart', {
                    messageId,
                    toolCall: {
                        id: event.toolCallId,
                        name: event.toolName,
                    },
                });
                return null;

            case 'tool_complete':
            case 'tool_call_complete':
                this.sendToWebview('toolCallComplete', {
                    messageId,
                    toolCallId: event.toolCallId,
                    result: event.result,
                });
                return null;

            case 'error':
                this.sendToWebview('streamError', {
                    messageId,
                    error: event.message || event.error,
                });
                return null;

            default:
                Logger.info(`Unknown event type: ${type}`);
                return null;
        }
    }

    /**
     * Execute a tool call from the AI
     */
    private async executeToolCall(toolCall: { 
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
     * Handle tool execution request from webview
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
     * Create tool execution context
     */
    private createToolContext(): ToolContext {
        const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || [];
        
        return {
            cwd: workspaceFolders[0] || process.cwd(),
            workspaceFolders,
            config: {
                maxFileSize: 1024 * 1024,  // 1MB
                timeout: 60000,
                blockedPatterns: ['**/node_modules/**', '**/.git/**'],
                requireConfirmation: true,
            },
        };
    }

    /**
     * Send message to webview
     */
    private sendToWebview(type: string, payload: any): void {
        this.panel.webview.postMessage({ type, payload });
    }

    /**
     * Generate unique ID
     */
    private generateId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Update webview content
     */
    private updateWebview(): void {
        this.panel.webview.html = this.getHtmlContent();
    }

    /**
     * Get HTML content for webview
     */
    private getHtmlContent(): string {
        const webview = this.panel.webview;
        
        // Get URIs for resources
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'build', 'assets', 'index.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'build', 'assets', 'index.css')
        );

        // Use a nonce for script security
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
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        font-family: var(--vscode-font-family);
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
     * Generate nonce for CSP
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        ChatPanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
