/**
 * work.studio Inline Completion Provider
 * 
 * Provides AI-powered code completions using the MCP protocol.
 */

import * as vscode from 'vscode';
import { McpClient } from '../mcp/McpClient';
import { Logger } from '../utils/Logger';

export class WorkstudioCompletionProvider implements vscode.InlineCompletionItemProvider {
    private mcpClient: McpClient;
    private debounceTimer: NodeJS.Timeout | null = null;
    private lastRequestId = 0;

    constructor(mcpClient: McpClient) {
        this.mcpClient = mcpClient;
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | null> {
        // Check if completion is enabled
        const config = vscode.workspace.getConfiguration('workstudio');
        if (!config.get<boolean>('completion.enabled', true)) {
            return null;
        }

        // Check if connected
        if (!this.mcpClient.isConnected()) {
            Logger.debug('Skipping completion - not connected');
            return null;
        }

        // Debounce requests
        const debounceMs = config.get<number>('completion.debounceMs', 300);
        
        return new Promise((resolve) => {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            this.debounceTimer = setTimeout(async () => {
                try {
                    const completions = await this.getCompletions(document, position, token);
                    resolve(completions);
                } catch (error) {
                    Logger.error('Completion error', error);
                    resolve(null);
                }
            }, debounceMs);

            // Handle cancellation
            token.onCancellationRequested(() => {
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                resolve(null);
            });
        });
    }

    private async getCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | null> {
        const requestId = ++this.lastRequestId;
        const config = vscode.workspace.getConfiguration('workstudio');

        // Get context around cursor
        const prefix = this.getPrefix(document, position);
        const suffix = this.getSuffix(document, position);
        const language = this.mapLanguageId(document.languageId);

        // Skip if insufficient context
        if (prefix.length < 3) {
            return null;
        }

        Logger.debug(`Requesting completion [${requestId}] for ${language}`);

        try {
            const completion = await this.mcpClient.completeCode({
                prefix,
                suffix,
                language,
                filePath: document.uri.fsPath,
                maxTokens: config.get<number>('completion.maxTokens', 256)
            });

            // Check if request was superseded
            if (requestId !== this.lastRequestId || token.isCancellationRequested) {
                return null;
            }

            if (!completion || completion.trim().length === 0) {
                return null;
            }

            Logger.debug(`Received completion [${requestId}]: ${completion.length} chars`);

            return [
                new vscode.InlineCompletionItem(
                    completion,
                    new vscode.Range(position, position)
                )
            ];

        } catch (error) {
            if (requestId === this.lastRequestId) {
                Logger.error('Completion request failed', error);
            }
            return null;
        }
    }

    /**
     * Get text before the cursor (prefix)
     */
    private getPrefix(document: vscode.TextDocument, position: vscode.Position): string {
        // Get text from document start or reasonable limit
        const maxLines = 50;
        const startLine = Math.max(0, position.line - maxLines);
        const startPosition = new vscode.Position(startLine, 0);
        const range = new vscode.Range(startPosition, position);
        
        return document.getText(range);
    }

    /**
     * Get text after the cursor (suffix)
     */
    private getSuffix(document: vscode.TextDocument, position: vscode.Position): string {
        // Get text from cursor to document end or reasonable limit
        const maxLines = 20;
        const endLine = Math.min(document.lineCount - 1, position.line + maxLines);
        const endPosition = new vscode.Position(endLine, document.lineAt(endLine).text.length);
        const range = new vscode.Range(position, endPosition);
        
        return document.getText(range);
    }

    /**
     * Map VS Code language ID to common language name
     */
    private mapLanguageId(languageId: string): string {
        const languageMap: Record<string, string> = {
            'typescript': 'typescript',
            'typescriptreact': 'typescript',
            'javascript': 'javascript',
            'javascriptreact': 'javascript',
            'python': 'python',
            'java': 'java',
            'csharp': 'csharp',
            'cpp': 'cpp',
            'c': 'c',
            'go': 'go',
            'rust': 'rust',
            'ruby': 'ruby',
            'php': 'php',
            'swift': 'swift',
            'kotlin': 'kotlin',
            'scala': 'scala',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'less': 'less',
            'json': 'json',
            'yaml': 'yaml',
            'xml': 'xml',
            'markdown': 'markdown',
            'sql': 'sql',
            'shellscript': 'bash',
            'powershell': 'powershell',
            'dockerfile': 'dockerfile'
        };

        return languageMap[languageId] || languageId;
    }
}
