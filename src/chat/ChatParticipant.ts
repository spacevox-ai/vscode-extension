/**
 * work.studio Chat Participant
 * 
 * Implements VS Code's Chat API to provide an AI chat experience
 * similar to GitHub Copilot Chat. Users can invoke with @workstudio
 * in the VS Code chat panel.
 * 
 * Uses SSE streaming for real-time response rendering.
 */

import * as vscode from 'vscode';
import { McpClient } from '../mcp/McpClient';
import { McpSseClient, SseEvent, initializeSseClient } from '../mcp/SseClient';
import { Logger } from '../utils/Logger';

// Chat participant ID (must match package.json)
const PARTICIPANT_ID = 'workstudio.chat';

// Command handlers for slash commands
type CommandHandler = (
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) => Promise<void>;

export class WorkstudioChatParticipant {
    private participant: vscode.ChatParticipant | undefined;
    private mcpClient: McpClient;
    private sseClient: McpSseClient | null = null;
    private commandHandlers: Map<string, CommandHandler>;

    constructor(mcpClient: McpClient) {
        this.mcpClient = mcpClient;
        this.commandHandlers = new Map();
        this.registerCommandHandlers();
    }

    /**
     * Initialize SSE client with credentials
     */
    initializeSseClient(serverUrl: string, token: string, tenantId?: string, envId?: string): void {
        this.sseClient = initializeSseClient(serverUrl, token, tenantId, envId);
        Logger.info('SSE client initialized for streaming chat');
    }

    /**
     * Check if streaming is available
     */
    isStreamingAvailable(): boolean {
        return this.sseClient !== null;
    }

    /**
     * Register the chat participant with VS Code
     */
    register(context: vscode.ExtensionContext): void {
        // Create chat participant
        this.participant = vscode.chat.createChatParticipant(
            PARTICIPANT_ID,
            this.handleChatRequest.bind(this)
        );

        // Set participant properties
        this.participant.iconPath = vscode.Uri.joinPath(
            context.extensionUri, 
            'images', 
            'icon.svg'
        );

        // Register for cleanup
        context.subscriptions.push(this.participant);

        Logger.info('work.studio chat participant registered');
    }

    /**
     * Register command handlers for slash commands
     */
    private registerCommandHandlers(): void {
        this.commandHandlers.set('explain', this.handleExplain.bind(this));
        this.commandHandlers.set('fix', this.handleFix.bind(this));
        this.commandHandlers.set('test', this.handleTest.bind(this));
        this.commandHandlers.set('docs', this.handleDocs.bind(this));
        this.commandHandlers.set('refactor', this.handleRefactor.bind(this));
    }

    /**
     * Main chat request handler
     */
    private async handleChatRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        Logger.info(`Chat request: ${request.prompt.substring(0, 50)}...`);

        // Check if connected
        if (!this.mcpClient.isConnected()) {
            stream.markdown('⚠️ **Not connected to work.studio**\n\n');
            stream.markdown('Please sign in first using the command: `work.studio: Sign In`\n\n');
            stream.button({
                command: 'workstudio.login',
                title: 'Sign In to work.studio'
            });
            return { metadata: { command: 'login-required' } };
        }

        try {
            // Handle slash commands
            if (request.command) {
                const handler = this.commandHandlers.get(request.command);
                if (handler) {
                    await handler(request, context, stream, token);
                    return { metadata: { command: request.command } };
                }
            }

            // Default: general chat
            await this.handleGeneralChat(request, context, stream, token);
            return { metadata: { command: 'chat' } };

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            Logger.error('Chat request failed', error);
            
            stream.markdown(`\n\n❌ **Error:** ${message}\n`);
            return { 
                metadata: { command: 'error' },
                errorDetails: { message }
            };
        }
    }

    /**
     * Handle general chat (no slash command) - with SSE streaming
     */
    private async handleGeneralChat(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Get context from active editor
        const editorContext = this.getEditorContext();
        
        // Build conversation history
        const history = this.buildHistoryContext(context);

        // Use SSE streaming if available, otherwise fall back to synchronous
        if (this.sseClient) {
            await this.handleStreamingChat(request.prompt, editorContext, history, stream, token);
        } else {
            await this.handleSyncChat(request.prompt, editorContext, history, stream, token);
        }

        // Add follow-up suggestions
        this.addFollowUpSuggestions(stream, request.prompt);
    }

    /**
     * Handle chat with SSE streaming for real-time response
     */
    private async handleStreamingChat(
        message: string,
        context: string,
        history: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        let thinkingContent = '';
        let hasShownThinking = false;
        let hasShownDivider = false;

        try {
            await this.sseClient!.chatStream(
                { message, context, history },
                (event: SseEvent) => {
                    if (token.isCancellationRequested) {
                        return;
                    }

                    switch (event.type) {
                        case 'thinking':
                            // Accumulate thinking content
                            if (event.data.content) {
                                if (!hasShownThinking) {
                                    stream.markdown('\n💭 **Thinking:**\n\n> ');
                                    hasShownThinking = true;
                                }
                                // Stream thinking content progressively
                                const lines = event.data.content.split('\n');
                                stream.markdown(lines.join('\n> '));
                                thinkingContent += event.data.content;
                            }
                            break;

                        case 'token':
                            // Close thinking section and add divider if needed
                            if (hasShownThinking && !hasShownDivider) {
                                stream.markdown('\n\n---\n\n');
                                hasShownDivider = true;
                            }
                            // Stream response token
                            if (event.data.content) {
                                stream.markdown(event.data.content);
                            }
                            break;

                        case 'tool_start':
                            if (event.data.toolName) {
                                stream.markdown(`\n\n🔧 *Using tool: ${event.data.toolName}...*\n`);
                            }
                            break;

                        case 'tool_result':
                            if (event.data.result) {
                                stream.markdown(`\n*Tool result received*\n\n`);
                            }
                            break;

                        case 'done':
                            // Stream completed
                            Logger.debug('SSE stream completed', { 
                                hasThinking: !!thinkingContent,
                                usage: event.data.usage 
                            });
                            break;

                        case 'error':
                            const errorMsg = event.data.message || event.data.error || 'Unknown error';
                            stream.markdown(`\n\n❌ **Error:** ${errorMsg}\n`);
                            break;
                    }
                }
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            Logger.error('SSE streaming failed', error);
            stream.markdown(`\n\n❌ **Streaming error:** ${errorMessage}\n`);
        }
    }

    /**
     * Handle chat synchronously (fallback when SSE not available)
     */
    private async handleSyncChat(
        message: string,
        context: string,
        history: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Show progress
        stream.progress('Thinking...');

        // Call MCP chat tool
        const response = await this.mcpClient.chat({
            message,
            context,
            history,
            references: []
        });

        if (token.isCancellationRequested) {
            return;
        }

        // Stream the response
        if (response.error) {
            stream.markdown(`❌ **Error:** ${response.error}\n`);
        } else {
            Logger.info('Chat response received', { 
                hasThinking: !!response.thinking, 
                thinkingLength: response.thinking?.length 
            });
            
            // Display thinking content if present (as blockquote)
            if (response.thinking) {
                stream.markdown('\n💭 **Thinking:**\n\n');
                stream.markdown('> ' + response.thinking.split('\n').join('\n> '));
                stream.markdown('\n\n---\n\n');
            }
            
            // Display main response
            stream.markdown(response.content || 'No response received.');
        }
    }

    /**
     * Handle /explain command
     */
    private async handleExplain(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const selection = this.getSelectedCode();
        const prompt = request.prompt || 'the selected code';

        const message = selection 
            ? `Explain this code in detail:\n\n\`\`\`\n${selection.code}\n\`\`\`\n\nLanguage: ${selection.language}\nFile: ${selection.fileName}`
            : `Explain: ${prompt}`;

        // Use streaming or fallback
        if (this.sseClient) {
            await this.handleStreamingChat(message, this.getEditorContext(), '', stream, token);
        } else {
            stream.progress('Analyzing code...');
            const response = await this.mcpClient.chat({
                message,
                context: this.getEditorContext()
            });
            if (!token.isCancellationRequested) {
                if (response.thinking) {
                    stream.markdown('\n💭 **Thinking:**\n\n');
                    stream.markdown('> ' + response.thinking.split('\n').join('\n> '));
                    stream.markdown('\n\n---\n\n');
                }
                stream.markdown(response.content || 'Unable to explain.');
            }
        }
    }

    /**
     * Handle /fix command
     */
    private async handleFix(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const selection = this.getSelectedCode();
        const issue = request.prompt || 'any bugs or issues';

        if (!selection) {
            stream.markdown('⚠️ Please select some code first, then ask me to fix it.');
            return;
        }

        const message = `Fix ${issue} in this code:\n\n\`\`\`${selection.language}\n${selection.code}\n\`\`\`\n\nProvide the corrected code with explanations.`;

        // Use streaming or fallback
        if (this.sseClient) {
            await this.handleStreamingChat(message, this.getEditorContext(), '', stream, token);
        } else {
            stream.progress('Analyzing for issues...');
            const response = await this.mcpClient.chat({
                message,
                context: this.getEditorContext()
            });
            if (!token.isCancellationRequested) {
                if (response.thinking) {
                    stream.markdown('\n💭 **Thinking:**\n\n');
                    stream.markdown('> ' + response.thinking.split('\n').join('\n> '));
                    stream.markdown('\n\n---\n\n');
                }
                stream.markdown(response.content || 'Unable to analyze.');
            }
        }
    }

    /**
     * Handle /test command
     */
    private async handleTest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const selection = this.getSelectedCode();
        const framework = request.prompt || 'appropriate testing framework';

        if (!selection) {
            stream.markdown('⚠️ Please select some code first, then ask me to generate tests.');
            return;
        }

        const message = `Generate unit tests for this code using ${framework}:\n\n\`\`\`${selection.language}\n${selection.code}\n\`\`\`\n\nInclude edge cases and meaningful assertions.`;

        // Use streaming or fallback
        if (this.sseClient) {
            await this.handleStreamingChat(message, this.getEditorContext(), '', stream, token);
        } else {
            stream.progress('Generating tests...');
            const response = await this.mcpClient.chat({
                message,
                context: this.getEditorContext()
            });
            if (!token.isCancellationRequested) {
                if (response.thinking) {
                    stream.markdown('\n💭 **Thinking:**\n\n');
                    stream.markdown('> ' + response.thinking.split('\n').join('\n> '));
                    stream.markdown('\n\n---\n\n');
                }
                stream.markdown(response.content || 'Unable to generate tests.');
            }
        }
    }

    /**
     * Handle /docs command
     */
    private async handleDocs(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const selection = this.getSelectedCode();
        const style = request.prompt || 'JSDoc/TSDoc style';

        if (!selection) {
            stream.markdown('⚠️ Please select some code first, then ask me to document it.');
            return;
        }

        const message = `Generate ${style} documentation for this code:\n\n\`\`\`${selection.language}\n${selection.code}\n\`\`\`\n\nInclude parameter descriptions, return values, and examples.`;

        // Use streaming or fallback
        if (this.sseClient) {
            await this.handleStreamingChat(message, this.getEditorContext(), '', stream, token);
        } else {
            stream.progress('Generating documentation...');
            const response = await this.mcpClient.chat({
                message,
                context: this.getEditorContext()
            });
            if (!token.isCancellationRequested) {
                if (response.thinking) {
                    stream.markdown('\n💭 **Thinking:**\n\n');
                    stream.markdown('> ' + response.thinking.split('\n').join('\n> '));
                    stream.markdown('\n\n---\n\n');
                }
                stream.markdown(response.content || 'Unable to generate documentation.');
            }
        }
    }

    /**
     * Handle /refactor command
     */
    private async handleRefactor(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const selection = this.getSelectedCode();
        const goal = request.prompt || 'improve readability and maintainability';

        if (!selection) {
            stream.markdown('⚠️ Please select some code first, then ask me to refactor it.');
            return;
        }

        const message = `Refactor this code to ${goal}:\n\n\`\`\`${selection.language}\n${selection.code}\n\`\`\`\n\nExplain each change and why it improves the code.`;

        // Use streaming or fallback
        if (this.sseClient) {
            await this.handleStreamingChat(message, this.getEditorContext(), '', stream, token);
        } else {
            stream.progress('Analyzing for refactoring opportunities...');
            const response = await this.mcpClient.chat({
                message,
                context: this.getEditorContext()
            });
            if (!token.isCancellationRequested) {
                if (response.thinking) {
                    stream.markdown('\n💭 **Thinking:**\n\n');
                    stream.markdown('> ' + response.thinking.split('\n').join('\n> '));
                    stream.markdown('\n\n---\n\n');
                }
                stream.markdown(response.content || 'Unable to suggest refactoring.');
            }
        }
    }

    /**
     * Get context from the active editor
     */
    private getEditorContext(): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return '';
        }

        const document = editor.document;
        const selection = editor.selection;

        // Get selected text or surrounding context
        let contextCode: string;
        if (!selection.isEmpty) {
            contextCode = document.getText(selection);
        } else {
            // Get lines around cursor (±20 lines)
            const cursorLine = selection.active.line;
            const startLine = Math.max(0, cursorLine - 20);
            const endLine = Math.min(document.lineCount - 1, cursorLine + 20);
            const range = new vscode.Range(startLine, 0, endLine, Number.MAX_VALUE);
            contextCode = document.getText(range);
        }

        return `File: ${document.fileName}\nLanguage: ${document.languageId}\n\n${contextCode}`;
    }

    /**
     * Get selected code from active editor
     */
    private getSelectedCode(): { code: string; language: string; fileName: string } | null {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            return null;
        }

        return {
            code: editor.document.getText(editor.selection),
            language: editor.document.languageId,
            fileName: editor.document.fileName.split(/[/\\]/).pop() || 'unknown'
        };
    }

    /**
     * Build history context from previous messages
     */
    private buildHistoryContext(context: vscode.ChatContext): string {
        if (context.history.length === 0) {
            return '';
        }

        const historyItems: string[] = [];
        
        for (const turn of context.history.slice(-5)) { // Last 5 turns
            if (turn instanceof vscode.ChatRequestTurn) {
                historyItems.push(`User: ${turn.prompt}`);
            } else if (turn instanceof vscode.ChatResponseTurn) {
                // Extract text from response
                let responseText = '';
                for (const part of turn.response) {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        responseText += part.value.value;
                    }
                }
                if (responseText) {
                    historyItems.push(`Assistant: ${responseText.substring(0, 500)}...`);
                }
            }
        }

        return historyItems.join('\n\n');
    }

    /**
     * Extract references from request (files, selections, etc.)
     */
    private extractReferences(request: vscode.ChatRequest): string[] {
        const refs: string[] = [];

        for (const ref of request.references) {
            if (ref.id === 'vscode.file') {
                refs.push(`File: ${ref.value}`);
            } else if (ref.id === 'vscode.selection') {
                refs.push(`Selection: ${ref.value}`);
            }
        }

        return refs;
    }

    /**
     * Add follow-up suggestions based on the conversation
     */
    private addFollowUpSuggestions(
        stream: vscode.ChatResponseStream, 
        prompt: string
    ): void {
        // Add contextual follow-up suggestions
        const lowerPrompt = prompt.toLowerCase();

        if (lowerPrompt.includes('error') || lowerPrompt.includes('bug')) {
            stream.button({
                command: 'workstudio.chat',
                title: 'Show me how to fix it',
                arguments: ['/fix']
            });
        }

        if (lowerPrompt.includes('function') || lowerPrompt.includes('class')) {
            stream.button({
                command: 'workstudio.chat',
                title: 'Generate tests',
                arguments: ['/test']
            });
        }
    }

    /**
     * Dispose the chat participant
     */
    dispose(): void {
        this.participant?.dispose();
    }
}
