/**
 * Base Tool Abstract Class
 * 
 * Provides common functionality for all tools.
 * Uses Template Method pattern for consistent execution flow.
 */

import * as vscode from 'vscode';
import { 
    ITool, 
    ToolDefinition, 
    ToolRequest, 
    ToolResult, 
    ValidationResult,
    ToolCategory,
    ToolParameterSchema 
} from './types';
import { Logger } from '../utils/Logger';

/**
 * Abstract base class for all tools
 */
export abstract class BaseTool implements ITool {
    protected readonly name: string;
    protected readonly description: string;
    protected readonly category: ToolCategory;
    protected readonly requiresConfirmation: boolean;
    protected readonly executionHint: 'fast' | 'medium' | 'slow';

    constructor(config: {
        name: string;
        description: string;
        category: ToolCategory;
        requiresConfirmation?: boolean;
        executionHint?: 'fast' | 'medium' | 'slow';
    }) {
        this.name = config.name;
        this.description = config.description;
        this.category = config.category;
        this.requiresConfirmation = config.requiresConfirmation ?? false;
        this.executionHint = config.executionHint ?? 'fast';
    }

    /**
     * Get tool definition - override getParameters() in subclasses
     */
    getDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: this.description,
            parameters: this.getParameters(),
            category: this.category,
            requiresConfirmation: this.requiresConfirmation,
            executionHint: this.executionHint,
        };
    }

    /**
     * Get parameter schema - must be implemented by subclasses
     */
    protected abstract getParameters(): Record<string, ToolParameterSchema>;

    /**
     * Validate arguments - can be overridden for custom validation
     */
    validateArguments(args: Record<string, unknown>): ValidationResult {
        const errors: string[] = [];
        const params = this.getParameters();

        // Check required parameters
        for (const [name, schema] of Object.entries(params)) {
            if (schema.required && (args[name] === undefined || args[name] === null)) {
                errors.push(`Missing required parameter: ${name}`);
                continue;
            }

            // Type validation
            if (args[name] !== undefined) {
                const typeError = this.validateType(name, args[name], schema);
                if (typeError) {
                    errors.push(typeError);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
        };
    }

    /**
     * Validate parameter type
     */
    private validateType(name: string, value: unknown, schema: ToolParameterSchema): string | null {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        
        if (schema.type === 'array' && !Array.isArray(value)) {
            return `Parameter '${name}' must be an array`;
        }
        
        if (schema.type !== 'array' && actualType !== schema.type) {
            return `Parameter '${name}' must be of type ${schema.type}, got ${actualType}`;
        }

        // Enum validation
        if (schema.enum && !schema.enum.includes(value as string)) {
            return `Parameter '${name}' must be one of: ${schema.enum.join(', ')}`;
        }

        return null;
    }

    /**
     * Execute the tool - Template Method pattern
     */
    async execute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        
        try {
            // Pre-execution hook
            await this.beforeExecute(request);

            // Check cancellation
            if (request.context.cancellationToken.isCancellationRequested) {
                return this.createResult(false, 'Execution cancelled', startTime);
            }

            // Validate arguments
            const validation = this.validateArguments(request.arguments);
            if (!validation.valid) {
                return this.createResult(
                    false, 
                    `Invalid arguments: ${validation.errors?.join(', ')}`,
                    startTime
                );
            }

            // Execute the actual tool logic
            const result = await this.doExecute(request);

            // Post-execution hook
            await this.afterExecute(request, result);

            return {
                ...result,
                durationMs: Date.now() - startTime,
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            Logger.error(`Tool ${this.name} execution failed`, error);
            
            return this.createResult(false, `Error: ${message}`, startTime);
        }
    }

    /**
     * Actual tool execution - must be implemented by subclasses
     */
    protected abstract doExecute(request: ToolRequest): Promise<ToolResult>;

    /**
     * Hook called before execution - can be overridden
     */
    protected async beforeExecute(request: ToolRequest): Promise<void> {
        Logger.debug(`Executing tool: ${this.name}`, { 
            toolCallId: request.toolCallId,
            args: request.arguments 
        });
    }

    /**
     * Hook called after execution - can be overridden
     */
    protected async afterExecute(request: ToolRequest, result: ToolResult): Promise<void> {
        Logger.debug(`Tool ${this.name} completed`, { 
            success: result.success,
            durationMs: result.durationMs 
        });
    }

    /**
     * Helper to create a result object
     */
    protected createResult(
        success: boolean, 
        content: string, 
        startTime: number,
        data?: unknown
    ): ToolResult {
        return {
            success,
            content,
            data,
            durationMs: Date.now() - startTime,
            error: success ? undefined : content,
        };
    }

    /**
     * Helper to format file content for AI
     */
    protected formatFileContent(path: string, content: string, language?: string): string {
        const lang = language || this.detectLanguage(path);
        return `\`\`\`${lang}\n${content}\n\`\`\``;
    }

    /**
     * Detect language from file extension
     */
    protected detectLanguage(filePath: string): string {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        const languageMap: Record<string, string> = {
            'ts': 'typescript',
            'tsx': 'typescriptreact',
            'js': 'javascript',
            'jsx': 'javascriptreact',
            'py': 'python',
            'java': 'java',
            'cs': 'csharp',
            'go': 'go',
            'rs': 'rust',
            'rb': 'ruby',
            'php': 'php',
            'swift': 'swift',
            'kt': 'kotlin',
            'scala': 'scala',
            'c': 'c',
            'cpp': 'cpp',
            'h': 'c',
            'hpp': 'cpp',
            'json': 'json',
            'yaml': 'yaml',
            'yml': 'yaml',
            'xml': 'xml',
            'html': 'html',
            'css': 'css',
            'scss': 'scss',
            'less': 'less',
            'md': 'markdown',
            'sql': 'sql',
            'sh': 'bash',
            'ps1': 'powershell',
            'bat': 'batch',
            'dockerfile': 'dockerfile',
        };
        return languageMap[ext] || ext;
    }

    /**
     * Check if a path is within workspace
     */
    protected isWithinWorkspace(filePath: string, workspaceFolders: readonly vscode.WorkspaceFolder[]): boolean {
        const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
        return workspaceFolders.some(folder => {
            const normalizedFolder = folder.uri.fsPath.replace(/\\/g, '/').toLowerCase();
            return normalizedPath.startsWith(normalizedFolder);
        });
    }

    /**
     * Check if path matches blocked patterns
     */
    protected isBlocked(filePath: string, blockedPatterns: string[]): boolean {
        const path = filePath.replace(/\\/g, '/');
        return blockedPatterns.some(pattern => {
            // Simple glob matching
            const regex = new RegExp(
                '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
                'i'
            );
            return regex.test(path);
        });
    }
}
