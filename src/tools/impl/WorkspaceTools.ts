/**
 * Workspace Tools
 * 
 * Tools for workspace-level operations.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { BaseTool } from '../BaseTool';
import { ToolRequest, ToolResult, ToolParameterSchema } from '../types';

// ============================================================================
// Get Workspace Info Tool
// ============================================================================

export class GetWorkspaceInfoTool extends BaseTool {
    constructor() {
        super({
            name: 'get_workspace_info',
            description: 'Get information about the current workspace, including folder structure, git status, and open files.',
            category: 'workspace',
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {};
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            const openEditors = vscode.window.visibleTextEditors.map(e => 
                vscode.workspace.asRelativePath(e.document.uri)
            );
            const activeFile = vscode.window.activeTextEditor
                ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri)
                : null;

            // Get workspace name
            const workspaceName = vscode.workspace.name || 'Untitled Workspace';

            // Get git info if available
            let gitInfo: { branch?: string; hasChanges?: boolean } = {};
            try {
                const gitExtension = vscode.extensions.getExtension('vscode.git');
                if (gitExtension?.isActive) {
                    const api = gitExtension.exports.getAPI(1);
                    const repo = api.repositories[0];
                    if (repo) {
                        gitInfo.branch = repo.state.HEAD?.name;
                        gitInfo.hasChanges = repo.state.workingTreeChanges.length > 0 
                            || repo.state.indexChanges.length > 0;
                    }
                }
            } catch {
                // Git extension not available
            }

            const info = {
                name: workspaceName,
                folders: workspaceFolders.map(f => ({
                    name: f.name,
                    path: f.uri.fsPath,
                })),
                activeFile,
                openFiles: openEditors,
                git: gitInfo,
            };

            const content = `Workspace: ${workspaceName}
Folders: ${workspaceFolders.map(f => f.name).join(', ')}
Active file: ${activeFile || 'None'}
Open files: ${openEditors.length} file(s)
${gitInfo.branch ? `Git branch: ${gitInfo.branch}${gitInfo.hasChanges ? ' (has changes)' : ''}` : ''}`;

            return this.createResult(true, content, startTime, info);

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to get workspace info: ${message}`, startTime);
        }
    }
}

// ============================================================================
// Find Symbol Tool
// ============================================================================

export class FindSymbolTool extends BaseTool {
    constructor() {
        super({
            name: 'find_symbol',
            description: 'Find symbols (functions, classes, variables) by name in the workspace.',
            category: 'workspace',
            executionHint: 'medium',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            query: {
                type: 'string',
                description: 'Symbol name or partial name to search for',
                required: true,
            },
            maxResults: {
                type: 'number',
                description: 'Maximum number of results',
                required: false,
                default: 20,
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const query = request.arguments.query as string;
        const maxResults = (request.arguments.maxResults as number) ?? 20;

        try {
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                query
            );

            if (!symbols || symbols.length === 0) {
                return this.createResult(true, 'No symbols found', startTime, { symbols: [] });
            }

            const results = symbols.slice(0, maxResults).map(s => ({
                name: s.name,
                kind: vscode.SymbolKind[s.kind],
                file: vscode.workspace.asRelativePath(s.location.uri),
                line: s.location.range.start.line + 1,
                container: s.containerName,
            }));

            const content = `Found ${results.length} symbol(s):\n${
                results.map(s => `- ${s.name} (${s.kind}) in ${s.file}:${s.line}`).join('\n')
            }`;

            return this.createResult(true, content, startTime, { symbols: results });

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to find symbols: ${message}`, startTime);
        }
    }
}

// ============================================================================
// Get Git Status Tool
// ============================================================================

export class GetGitStatusTool extends BaseTool {
    constructor() {
        super({
            name: 'get_git_status',
            description: 'Get the current git status, including modified, staged, and untracked files.',
            category: 'workspace',
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {};
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();

        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            
            if (!gitExtension) {
                return this.createResult(false, 'Git extension not available', startTime);
            }

            if (!gitExtension.isActive) {
                await gitExtension.activate();
            }

            const api = gitExtension.exports.getAPI(1);
            const repo = api.repositories[0];

            if (!repo) {
                return this.createResult(false, 'No git repository found', startTime);
            }

            const state = repo.state;
            
            const status = {
                branch: state.HEAD?.name || 'unknown',
                ahead: state.HEAD?.ahead || 0,
                behind: state.HEAD?.behind || 0,
                staged: state.indexChanges.map((c: any) => ({
                    file: path.basename(c.uri.fsPath),
                    status: this.gitStatusToString(c.status),
                })),
                modified: state.workingTreeChanges.map((c: any) => ({
                    file: path.basename(c.uri.fsPath),
                    status: this.gitStatusToString(c.status),
                })),
                untracked: state.untrackedChanges?.map((c: any) => 
                    path.basename(c.uri.fsPath)
                ) || [],
            };

            const parts = [`Branch: ${status.branch}`];
            
            if (status.ahead > 0 || status.behind > 0) {
                parts.push(`Ahead: ${status.ahead}, Behind: ${status.behind}`);
            }
            
            if (status.staged.length > 0) {
                parts.push(`Staged (${status.staged.length}): ${status.staged.map((s: any) => s.file).join(', ')}`);
            }
            
            if (status.modified.length > 0) {
                parts.push(`Modified (${status.modified.length}): ${status.modified.map((s: any) => s.file).join(', ')}`);
            }
            
            if (status.untracked.length > 0) {
                parts.push(`Untracked (${status.untracked.length}): ${status.untracked.join(', ')}`);
            }

            return this.createResult(true, parts.join('\n'), startTime, status);

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to get git status: ${message}`, startTime);
        }
    }

    private gitStatusToString(status: number): string {
        // VS Code git status codes
        const statuses: Record<number, string> = {
            0: 'modified',
            1: 'added',
            2: 'deleted',
            3: 'renamed',
            4: 'copied',
            5: 'unmerged',
            6: 'ignored',
            7: 'untracked',
        };
        return statuses[status] || 'unknown';
    }
}

// ============================================================================
// Run VS Code Command Tool
// ============================================================================

export class RunCommandTool extends BaseTool {
    // Safe commands that can be run without confirmation
    private static SAFE_COMMANDS = new Set([
        'editor.action.formatDocument',
        'editor.action.organizeImports',
        'workbench.action.files.save',
        'workbench.action.files.saveAll',
        'workbench.action.closeActiveEditor',
        'workbench.action.quickOpen',
        'workbench.action.showCommands',
    ]);

    constructor() {
        super({
            name: 'run_vscode_command',
            description: `Run a VS Code command. Examples: 
                - editor.action.formatDocument (format current file)
                - editor.action.organizeImports (organize imports)
                - workbench.action.files.saveAll (save all files)`,
            category: 'workspace',
            requiresConfirmation: true,
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            command: {
                type: 'string',
                description: 'The VS Code command ID to execute',
                required: true,
            },
            args: {
                type: 'object',
                description: 'Arguments to pass to the command (optional)',
                required: false,
            },
        };
    }

    override async shouldRequireConfirmation(request: ToolRequest): Promise<boolean> {
        const command = request.arguments.command as string;
        return !RunCommandTool.SAFE_COMMANDS.has(command);
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const command = request.arguments.command as string;
        const args = request.arguments.args;

        try {
            const result = await vscode.commands.executeCommand(command, args);
            
            return this.createResult(
                true,
                `Successfully executed command: ${command}`,
                startTime,
                { command, result }
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to execute command: ${message}`, startTime);
        }
    }
}
