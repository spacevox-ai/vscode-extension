/**
 * Tool Registry
 * 
 * Central registry for all tools. Implements Registry pattern.
 * Handles tool registration, discovery, and execution.
 */

import * as vscode from 'vscode';
import { 
    ITool, 
    ToolDefinition, 
    ToolRequest, 
    ToolResult, 
    ToolContext,
    ToolConfig,
    ToolExecutionOptions,
    ToolCategory
} from './types';
import { Logger } from '../utils/Logger';

/**
 * Tool Registry - singleton that manages all tools
 */
export class ToolRegistry {
    private static instance: ToolRegistry | null = null;
    
    private tools = new Map<string, ITool>();
    private executionHistory: Array<{
        toolCallId: string;
        toolName: string;
        timestamp: number;
        duration: number;
        success: boolean;
    }> = [];

    // Event emitters
    private _onToolRegistered = new vscode.EventEmitter<ToolDefinition>();
    private _onToolUnregistered = new vscode.EventEmitter<string>();
    private _onToolExecutionStart = new vscode.EventEmitter<{ toolCallId: string; toolName: string }>();
    private _onToolExecutionComplete = new vscode.EventEmitter<{ toolCallId: string; result: ToolResult }>();

    public readonly onToolRegistered = this._onToolRegistered.event;
    public readonly onToolUnregistered = this._onToolUnregistered.event;
    public readonly onToolExecutionStart = this._onToolExecutionStart.event;
    public readonly onToolExecutionComplete = this._onToolExecutionComplete.event;

    private constructor() {
        Logger.info('ToolRegistry initialized');
    }

    /**
     * Get singleton instance
     */
    static getInstance(): ToolRegistry {
        if (!ToolRegistry.instance) {
            ToolRegistry.instance = new ToolRegistry();
        }
        return ToolRegistry.instance;
    }

    /**
     * Register a tool
     */
    register(tool: ITool): void {
        const definition = tool.getDefinition();
        
        if (this.tools.has(definition.name)) {
            Logger.warn(`Tool ${definition.name} already registered, replacing`);
        }

        this.tools.set(definition.name, tool);
        this._onToolRegistered.fire(definition);
        
        Logger.info(`Tool registered: ${definition.name} (${definition.category})`);
    }

    /**
     * Register multiple tools
     */
    registerAll(tools: ITool[]): void {
        for (const tool of tools) {
            this.register(tool);
        }
    }

    /**
     * Unregister a tool
     */
    unregister(name: string): boolean {
        const tool = this.tools.get(name);
        if (tool) {
            tool.dispose?.();
            this.tools.delete(name);
            this._onToolUnregistered.fire(name);
            Logger.info(`Tool unregistered: ${name}`);
            return true;
        }
        return false;
    }

    /**
     * Get a tool by name
     */
    get(name: string): ITool | undefined {
        return this.tools.get(name);
    }

    /**
     * Check if a tool exists
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Get all tool definitions
     */
    getAllDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map(t => t.getDefinition());
    }

    /**
     * Get all registered tools
     */
    getAllTools(): ITool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tool definitions by category
     */
    getByCategory(category: ToolCategory): ToolDefinition[] {
        return this.getAllDefinitions().filter(d => d.category === category);
    }

    /**
     * Get tool definitions formatted for AI (OpenAI/Anthropic format)
     */
    getToolsForAI(): Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: {
                type: 'object';
                properties: Record<string, unknown>;
                required: string[];
            };
        };
    }> {
        return this.getAllDefinitions().map(def => ({
            type: 'function' as const,
            function: {
                name: def.name,
                description: def.description,
                parameters: {
                    type: 'object' as const,
                    properties: Object.fromEntries(
                        Object.entries(def.parameters).map(([key, schema]) => [
                            key,
                            {
                                type: schema.type,
                                description: schema.description,
                                ...(schema.enum && { enum: schema.enum }),
                                ...(schema.default !== undefined && { default: schema.default }),
                            }
                        ])
                    ),
                    required: Object.entries(def.parameters)
                        .filter(([_, schema]) => schema.required)
                        .map(([key]) => key),
                },
            },
        }));
    }

    /**
     * Execute a tool
     */
    async execute(
        toolName: string,
        toolCallId: string,
        args: Record<string, unknown>,
        context: ToolContext,
        options: ToolExecutionOptions = {}
    ): Promise<ToolResult> {
        const tool = this.tools.get(toolName);
        
        if (!tool) {
            return {
                success: false,
                content: `Tool not found: ${toolName}`,
                error: `Tool not found: ${toolName}`,
                durationMs: 0,
            };
        }

        const definition = tool.getDefinition();

        // Check confirmation requirement
        if (definition.requiresConfirmation && !options.skipConfirmation) {
            const confirmed = await this.requestConfirmation(toolName, args);
            if (!confirmed) {
                return {
                    success: false,
                    content: 'Tool execution cancelled by user',
                    error: 'User cancelled',
                    durationMs: 0,
                };
            }
        }

        // Fire start event
        this._onToolExecutionStart.fire({ toolCallId, toolName });

        const request: ToolRequest = {
            toolName,
            toolCallId,
            arguments: args,
            context,
        };

        // Execute with timeout
        const timeout = options.timeout ?? this.getDefaultTimeout(definition);
        
        try {
            const result = await this.executeWithTimeout(tool, request, timeout);
            
            // Record history
            this.executionHistory.push({
                toolCallId,
                toolName,
                timestamp: Date.now(),
                duration: result.durationMs,
                success: result.success,
            });

            // Fire complete event
            this._onToolExecutionComplete.fire({ toolCallId, result });

            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const result: ToolResult = {
                success: false,
                content: `Tool execution failed: ${errorMessage}`,
                error: errorMessage,
                durationMs: 0,
            };

            this._onToolExecutionComplete.fire({ toolCallId, result });
            return result;
        }
    }

    /**
     * Execute with timeout
     */
    private async executeWithTimeout(
        tool: ITool,
        request: ToolRequest,
        timeout: number
    ): Promise<ToolResult> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Tool execution timed out after ${timeout}ms`));
            }, timeout);

            tool.execute(request)
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    /**
     * Request user confirmation for dangerous operations
     */
    private async requestConfirmation(
        toolName: string,
        args: Record<string, unknown>
    ): Promise<boolean> {
        const argsPreview = JSON.stringify(args, null, 2).substring(0, 500);
        
        const result = await vscode.window.showWarningMessage(
            `Allow work.studio to execute '${toolName}'?`,
            {
                modal: true,
                detail: `Arguments:\n${argsPreview}`,
            },
            'Allow',
            'Deny'
        );

        return result === 'Allow';
    }

    /**
     * Get default timeout based on tool type
     */
    private getDefaultTimeout(definition: ToolDefinition): number {
        switch (definition.executionHint) {
            case 'fast': return 10000;    // 10 seconds
            case 'medium': return 30000;  // 30 seconds
            case 'slow': return 120000;   // 2 minutes
            default: return 30000;
        }
    }

    /**
     * Create a tool context from current VS Code state
     */
    static createContext(
        sessionId: string,
        cancellationToken: vscode.CancellationToken,
        outputChannel: vscode.OutputChannel,
        config?: Partial<ToolConfig>
    ): ToolContext {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const activeEditor = vscode.window.activeTextEditor;
        
        // Determine CWD
        let cwd = workspaceFolders[0]?.uri.fsPath || process.cwd();
        if (activeEditor) {
            const docFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
            if (docFolder) {
                cwd = docFolder.uri.fsPath;
            }
        }

        const defaultConfig: ToolConfig = {
            autoApprove: false,
            maxFileSize: 1024 * 1024,  // 1MB
            terminalTimeout: 60000,     // 60 seconds
            allowedPatterns: ['**/*'],
            blockedPatterns: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
        };

        return {
            workspaceFolders,
            activeEditor,
            cwd,
            cancellationToken,
            outputChannel,
            sessionId,
            config: { ...defaultConfig, ...config },
        };
    }

    /**
     * Get execution history
     */
    getHistory(limit = 100): typeof this.executionHistory {
        return this.executionHistory.slice(-limit);
    }

    /**
     * Clear execution history
     */
    clearHistory(): void {
        this.executionHistory = [];
    }

    /**
     * Get tool count
     */
    get count(): number {
        return this.tools.size;
    }

    /**
     * Dispose all tools and clean up
     */
    dispose(): void {
        for (const tool of this.tools.values()) {
            tool.dispose?.();
        }
        this.tools.clear();
        this._onToolRegistered.dispose();
        this._onToolUnregistered.dispose();
        this._onToolExecutionStart.dispose();
        this._onToolExecutionComplete.dispose();
        ToolRegistry.instance = null;
    }
}
