/**
 * File System Tools
 * 
 * Tools for reading, writing, and searching files.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import { ToolRequest, ToolResult, ToolParameterSchema } from '../types';

// ============================================================================
// Read File Tool
// ============================================================================

export class ReadFileTool extends BaseTool {
    constructor() {
        super({
            name: 'read_file',
            description: 'Read the contents of a file. Returns the file content with line numbers. Use this to examine code, configuration, or any text file.',
            category: 'filesystem',
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            path: {
                type: 'string',
                description: 'The path to the file (relative to workspace or absolute)',
                required: true,
            },
            startLine: {
                type: 'number',
                description: 'Starting line number (1-indexed). Omit to read from beginning.',
                required: false,
            },
            endLine: {
                type: 'number',
                description: 'Ending line number (1-indexed, inclusive). Omit to read to end.',
                required: false,
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const filePath = request.arguments.path as string;
        const startLine = request.arguments.startLine as number | undefined;
        const endLine = request.arguments.endLine as number | undefined;

        try {
            // Resolve path
            const resolvedPath = this.resolvePath(filePath, request.context.cwd);
            
            // Check if within workspace
            if (!this.isWithinWorkspace(resolvedPath, request.context.workspaceFolders)) {
                return this.createResult(false, 'File is outside workspace', startTime);
            }

            // Check if blocked
            if (this.isBlocked(resolvedPath, request.context.config.blockedPatterns)) {
                return this.createResult(false, 'File path is blocked by configuration', startTime);
            }

            // Read file
            const uri = vscode.Uri.file(resolvedPath);
            const content = await vscode.workspace.fs.readFile(uri);
            const text = new TextDecoder().decode(content);

            // Check file size
            if (content.byteLength > request.context.config.maxFileSize) {
                return this.createResult(
                    false,
                    `File too large (${content.byteLength} bytes). Max: ${request.context.config.maxFileSize} bytes`,
                    startTime
                );
            }

            // Handle line range
            const lines = text.split('\n');
            const start = Math.max(1, startLine ?? 1);
            const end = Math.min(lines.length, endLine ?? lines.length);
            
            const selectedLines = lines.slice(start - 1, end);
            const numberedContent = selectedLines
                .map((line, i) => `${start + i}: ${line}`)
                .join('\n');

            const header = `File: ${filePath} (lines ${start}-${end} of ${lines.length})`;
            const language = this.detectLanguage(filePath);
            
            return this.createResult(
                true,
                `${header}\n\`\`\`${language}\n${numberedContent}\n\`\`\``,
                startTime,
                { lines: selectedLines, totalLines: lines.length }
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to read file: ${message}`, startTime);
        }
    }

    private resolvePath(filePath: string, cwd: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.join(cwd, filePath);
    }
}

// ============================================================================
// Write File Tool
// ============================================================================

export class WriteFileTool extends BaseTool {
    constructor() {
        super({
            name: 'write_file',
            description: 'Write content to a file. Creates the file if it does not exist, or overwrites if it does.',
            category: 'filesystem',
            requiresConfirmation: true,
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            path: {
                type: 'string',
                description: 'The path to the file (relative to workspace or absolute)',
                required: true,
            },
            content: {
                type: 'string',
                description: 'The content to write to the file',
                required: true,
            },
            createDirectories: {
                type: 'boolean',
                description: 'Create parent directories if they do not exist',
                required: false,
                default: true,
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const filePath = request.arguments.path as string;
        const content = request.arguments.content as string;
        const createDirs = (request.arguments.createDirectories as boolean) ?? true;

        try {
            // Resolve path
            const resolvedPath = path.isAbsolute(filePath) 
                ? filePath 
                : path.join(request.context.cwd, filePath);
            
            // Check if within workspace
            if (!this.isWithinWorkspace(resolvedPath, request.context.workspaceFolders)) {
                return this.createResult(false, 'Cannot write outside workspace', startTime);
            }

            // Check if blocked
            if (this.isBlocked(resolvedPath, request.context.config.blockedPatterns)) {
                return this.createResult(false, 'File path is blocked', startTime);
            }

            // Create directories if needed
            if (createDirs) {
                const dir = path.dirname(resolvedPath);
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
            }

            // Write file
            const uri = vscode.Uri.file(resolvedPath);
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(content));

            return this.createResult(
                true,
                `Successfully wrote ${content.length} characters to ${filePath}`,
                startTime,
                { path: resolvedPath, bytesWritten: content.length }
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to write file: ${message}`, startTime);
        }
    }
}

// ============================================================================
// Search Files Tool
// ============================================================================

export class SearchFilesTool extends BaseTool {
    constructor() {
        super({
            name: 'search_files',
            description: 'Search for files in the workspace using glob patterns or text content. Returns matching file paths.',
            category: 'filesystem',
            executionHint: 'medium',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            pattern: {
                type: 'string',
                description: 'Glob pattern (e.g., "**/*.ts") or text to search for in file contents',
                required: true,
            },
            type: {
                type: 'string',
                description: 'Search type: "glob" for filename patterns, "content" for searching within files',
                required: false,
                enum: ['glob', 'content'],
                default: 'glob',
            },
            maxResults: {
                type: 'number',
                description: 'Maximum number of results to return',
                required: false,
                default: 50,
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const pattern = request.arguments.pattern as string;
        const searchType = (request.arguments.type as string) ?? 'glob';
        const maxResults = (request.arguments.maxResults as number) ?? 50;

        try {
            if (searchType === 'glob') {
                return await this.searchByGlob(pattern, maxResults, startTime);
            } else {
                return await this.searchByContent(pattern, maxResults, startTime);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Search failed: ${message}`, startTime);
        }
    }

    private async searchByGlob(pattern: string, maxResults: number, startTime: number): Promise<ToolResult> {
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', maxResults);
        
        if (files.length === 0) {
            return this.createResult(true, 'No files found matching pattern', startTime, { files: [] });
        }

        const paths = files.map(f => vscode.workspace.asRelativePath(f));
        const content = `Found ${paths.length} files:\n${paths.map(p => `- ${p}`).join('\n')}`;
        
        return this.createResult(true, content, startTime, { files: paths });
    }

    private async searchByContent(query: string, maxResults: number, startTime: number): Promise<ToolResult> {
        // Use VS Code's text search API
        const results: Array<{ file: string; line: number; text: string }> = [];
        
        const textSearchOptions: vscode.TextSearchOptions = {
            maxResults,
        };

        await vscode.workspace.findTextInFiles(
            { pattern: query },
            textSearchOptions,
            (result) => {
                if ('text' in result) {
                    results.push({
                        file: vscode.workspace.asRelativePath(result.uri),
                        line: result.ranges[0].start.line + 1,
                        text: result.text.trim().substring(0, 100),
                    });
                }
            }
        );

        if (results.length === 0) {
            return this.createResult(true, 'No matches found', startTime, { matches: [] });
        }

        const content = `Found ${results.length} matches:\n${
            results.map(r => `- ${r.file}:${r.line}: ${r.text}`).join('\n')
        }`;
        
        return this.createResult(true, content, startTime, { matches: results });
    }
}

// ============================================================================
// List Directory Tool
// ============================================================================

export class ListDirectoryTool extends BaseTool {
    constructor() {
        super({
            name: 'list_directory',
            description: 'List the contents of a directory. Shows files and subdirectories.',
            category: 'filesystem',
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            path: {
                type: 'string',
                description: 'The directory path (relative to workspace or absolute). Omit for workspace root.',
                required: false,
                default: '.',
            },
            recursive: {
                type: 'boolean',
                description: 'Include subdirectories recursively (up to 2 levels)',
                required: false,
                default: false,
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const dirPath = (request.arguments.path as string) ?? '.';
        const recursive = (request.arguments.recursive as boolean) ?? false;

        try {
            const resolvedPath = path.isAbsolute(dirPath)
                ? dirPath
                : path.join(request.context.cwd, dirPath);

            const uri = vscode.Uri.file(resolvedPath);
            const entries = await vscode.workspace.fs.readDirectory(uri);

            const items = entries.map(([name, type]) => {
                const isDir = type === vscode.FileType.Directory;
                return {
                    name: isDir ? `${name}/` : name,
                    type: isDir ? 'directory' : 'file',
                };
            });

            // Sort: directories first, then files
            items.sort((a, b) => {
                if (a.type !== b.type) {
                    return a.type === 'directory' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });

            const content = `Contents of ${dirPath}:\n${items.map(i => `- ${i.name}`).join('\n')}`;
            
            return this.createResult(true, content, startTime, { items });

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to list directory: ${message}`, startTime);
        }
    }
}
