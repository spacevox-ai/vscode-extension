/**
 * work.studio Chat Participant
 * 
 * Implements VS Code's Chat API to provide an AI chat experience
 * similar to GitHub Copilot Chat. Users can invoke with @workstudio
 * in the VS Code chat panel.
 */

import * as vscode from 'vscode';
import { McpClient } from '../mcp/McpClient';
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
    private commandHandlers: Map<string, CommandHandler>;

    constructor(mcpClient: McpClient) {
        this.mcpClient = mcpClient;
        this.commandHandlers = new Map();
        this.registerCommandHandlers();
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
            'icon.png'
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
     * Handle general chat (no slash command)
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

        // Show progress
        stream.progress('Thinking...');

        // Call MCP chat tool
        const response = await this.mcpClient.chat({
            message: request.prompt,
            context: editorContext,
            history: history,
            references: this.extractReferences(request)
        });

        if (token.isCancellationRequested) {
            return;
        }

        // Stream the response
        if (response.error) {
            stream.markdown(`❌ **Error:** ${response.error}\n`);
        } else {
            stream.markdown(response.content || 'No response received.');
        }

        // Add follow-up suggestions
        this.addFollowUpSuggestions(stream, request.prompt);
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

        stream.progress('Analyzing code...');

        const message = selection 
            ? `Explain this code in detail:\n\n\`\`\`\n${selection.code}\n\`\`\`\n\nLanguage: ${selection.language}\nFile: ${selection.fileName}`
            : `Explain: ${prompt}`;

        const response = await this.mcpClient.chat({
            message,
            context: this.getEditorContext()
        });

        if (!token.isCancellationRequested) {
            stream.markdown(response.content || 'Unable to explain.');
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

        stream.progress('Analyzing for issues...');

        const message = `Fix ${issue} in this code:\n\n\`\`\`${selection.language}\n${selection.code}\n\`\`\`\n\nProvide the corrected code with explanations.`;

        const response = await this.mcpClient.chat({
            message,
            context: this.getEditorContext()
        });

        if (!token.isCancellationRequested) {
            stream.markdown(response.content || 'Unable to analyze.');
            
            // Offer to apply the fix
            if (response.content?.includes('```')) {
                stream.button({
                    command: 'workstudio.applyFix',
                    title: 'Apply Fix',
                    arguments: [response.content]
                });
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

        stream.progress('Generating tests...');

        const message = `Generate unit tests for this code using ${framework}:\n\n\`\`\`${selection.language}\n${selection.code}\n\`\`\`\n\nInclude edge cases and meaningful assertions.`;

        const response = await this.mcpClient.chat({
            message,
            context: this.getEditorContext()
        });

        if (!token.isCancellationRequested) {
            stream.markdown(response.content || 'Unable to generate tests.');
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

        stream.progress('Generating documentation...');

        const message = `Generate ${style} documentation for this code:\n\n\`\`\`${selection.language}\n${selection.code}\n\`\`\`\n\nInclude parameter descriptions, return values, and examples.`;

        const response = await this.mcpClient.chat({
            message,
            context: this.getEditorContext()
        });

        if (!token.isCancellationRequested) {
            stream.markdown(response.content || 'Unable to generate documentation.');
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

        stream.progress('Analyzing for refactoring opportunities...');

        const message = `Refactor this code to ${goal}:\n\n\`\`\`${selection.language}\n${selection.code}\n\`\`\`\n\nExplain each change and why it improves the code.`;

        const response = await this.mcpClient.chat({
            message,
            context: this.getEditorContext()
        });

        if (!token.isCancellationRequested) {
            stream.markdown(response.content || 'Unable to suggest refactoring.');
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
