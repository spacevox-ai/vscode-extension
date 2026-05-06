/**
 * Terminal Tool
 * 
 * Execute commands in VS Code's integrated terminal.
 * Supports PowerShell, bash, cmd, etc.
 */

import * as vscode from 'vscode';
import { BaseTool } from '../BaseTool';
import { ToolRequest, ToolResult, ToolParameterSchema } from '../types';
import { Logger } from '../../utils/Logger';

export class TerminalTool extends BaseTool {
    private terminals = new Map<string, vscode.Terminal>();
    private outputBuffers = new Map<string, string>();

    constructor() {
        super({
            name: 'execute_command',
            description: `Execute a shell command in the terminal. 
                Use this for running build commands, tests, git operations, package management, etc.
                The command runs in the workspace directory by default.
                Returns the command output (stdout/stderr combined).`,
            category: 'terminal',
            requiresConfirmation: true,
            executionHint: 'medium',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            command: {
                type: 'string',
                description: 'The command to execute (e.g., "npm install", "git status", "python script.py")',
                required: true,
            },
            cwd: {
                type: 'string',
                description: 'Working directory for the command. Defaults to workspace root.',
                required: false,
            },
            timeout: {
                type: 'number',
                description: 'Timeout in milliseconds. Default is 60000 (60 seconds).',
                required: false,
                default: 60000,
            },
            background: {
                type: 'boolean',
                description: 'Run in background without waiting for completion. Useful for long-running servers.',
                required: false,
                default: false,
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const command = request.arguments.command as string;
        const cwdArg = request.arguments.cwd as string | undefined;
        const timeout = (request.arguments.timeout as number) ?? 60000;
        const background = (request.arguments.background as boolean) ?? false;

        // Determine working directory
        const cwd = cwdArg 
            ? (require('path').isAbsolute(cwdArg) ? cwdArg : require('path').join(request.context.cwd, cwdArg))
            : request.context.cwd;

        try {
            if (background) {
                return await this.executeBackground(command, cwd, startTime);
            } else {
                return await this.executeWithOutput(command, cwd, timeout, startTime, request);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Command execution failed: ${message}`, startTime);
        }
    }

    /**
     * Execute command in background (don't wait for completion)
     */
    private async executeBackground(command: string, cwd: string, startTime: number): Promise<ToolResult> {
        const terminal = vscode.window.createTerminal({
            name: `work.studio: ${command.substring(0, 20)}...`,
            cwd,
        });

        terminal.show(false);  // Show but don't focus
        terminal.sendText(command);

        return this.createResult(
            true,
            `Command started in background terminal: ${command}`,
            startTime,
            { terminalId: terminal.name, background: true }
        );
    }

    /**
     * Execute command and capture output
     */
    private async executeWithOutput(
        command: string,
        cwd: string,
        timeout: number,
        startTime: number,
        request: ToolRequest
    ): Promise<ToolResult> {
        // Use Node.js child_process for output capture
        const { exec } = require('child_process');
        
        return new Promise((resolve) => {
            const process = exec(command, {
                cwd,
                timeout,
                maxBuffer: 1024 * 1024,  // 1MB buffer
                shell: this.getDefaultShell(),
            });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            process.stdout?.on('data', (data: string) => {
                stdout += data;
                // Log progress for long-running commands
                if (request.context.progress) {
                    const lines = stdout.split('\n');
                    const lastLine = lines[lines.length - 1] || lines[lines.length - 2];
                    request.context.progress.report({ message: lastLine?.substring(0, 50) });
                }
            });

            process.stderr?.on('data', (data: string) => {
                stderr += data;
            });

            const timeoutId = setTimeout(() => {
                timedOut = true;
                process.kill();
            }, timeout);

            process.on('close', (code: number | null) => {
                clearTimeout(timeoutId);

                if (timedOut) {
                    resolve(this.createResult(
                        false,
                        `Command timed out after ${timeout}ms.\nPartial output:\n${this.formatOutput(stdout, stderr)}`,
                        startTime
                    ));
                    return;
                }

                const success = code === 0;
                const output = this.formatOutput(stdout, stderr);
                
                resolve(this.createResult(
                    success,
                    success 
                        ? `Command completed successfully (exit code: ${code}):\n${output}`
                        : `Command failed (exit code: ${code}):\n${output}`,
                    startTime,
                    { exitCode: code, stdout, stderr }
                ));
            });

            process.on('error', (error: Error) => {
                clearTimeout(timeoutId);
                resolve(this.createResult(false, `Failed to execute command: ${error.message}`, startTime));
            });
        });
    }

    /**
     * Format output for display
     */
    private formatOutput(stdout: string, stderr: string): string {
        const parts: string[] = [];
        
        if (stdout.trim()) {
            parts.push(`stdout:\n\`\`\`\n${this.truncate(stdout, 5000)}\n\`\`\``);
        }
        
        if (stderr.trim()) {
            parts.push(`stderr:\n\`\`\`\n${this.truncate(stderr, 2000)}\n\`\`\``);
        }
        
        return parts.length > 0 ? parts.join('\n\n') : '(no output)';
    }

    /**
     * Truncate long output
     */
    private truncate(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + `\n... (truncated, ${text.length - maxLength} more characters)`;
    }

    /**
     * Get the default shell for the platform
     */
    private getDefaultShell(): string {
        if (process.platform === 'win32') {
            return 'powershell.exe';
        }
        return process.env.SHELL || '/bin/bash';
    }

    dispose(): void {
        for (const terminal of this.terminals.values()) {
            terminal.dispose();
        }
        this.terminals.clear();
        this.outputBuffers.clear();
    }
}

// ============================================================================
// Get Terminal Output Tool (for background processes)
// ============================================================================

export class GetTerminalOutputTool extends BaseTool {
    constructor() {
        super({
            name: 'get_terminal_output',
            description: 'Get the recent output from a terminal. Use this to check the status of background commands.',
            category: 'terminal',
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            terminalName: {
                type: 'string',
                description: 'Name of the terminal to get output from. Use "active" for the currently active terminal.',
                required: false,
                default: 'active',
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const terminalName = (request.arguments.terminalName as string) ?? 'active';

        try {
            let terminal: vscode.Terminal | undefined;

            if (terminalName === 'active') {
                terminal = vscode.window.activeTerminal;
            } else {
                terminal = vscode.window.terminals.find(t => t.name === terminalName);
            }

            if (!terminal) {
                return this.createResult(
                    false,
                    `Terminal not found: ${terminalName}. Available terminals: ${vscode.window.terminals.map(t => t.name).join(', ')}`,
                    startTime
                );
            }

            // Note: VS Code doesn't provide direct API to read terminal output
            // This is a limitation - we can only suggest the user check the terminal
            return this.createResult(
                true,
                `Terminal "${terminal.name}" is available. Note: Direct terminal output reading is not supported by VS Code API. Please check the terminal panel for output.`,
                startTime,
                { terminalName: terminal.name }
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to get terminal: ${message}`, startTime);
        }
    }
}
