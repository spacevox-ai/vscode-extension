/**
 * Editor Tools
 * 
 * Tools for manipulating text in VS Code editors.
 */

import * as vscode from 'vscode';
import { BaseTool } from '../BaseTool';
import { ToolRequest, ToolResult, ToolParameterSchema } from '../types';

// ============================================================================
// Replace Text Tool
// ============================================================================

export class ReplaceTextTool extends BaseTool {
    constructor() {
        super({
            name: 'replace_text',
            description: `Replace text in a file. Finds the exact occurrence of 'oldText' and replaces it with 'newText'. 
                Include enough context (3-5 lines before/after) to ensure unique matching.`,
            category: 'editor',
            requiresConfirmation: true,
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            path: {
                type: 'string',
                description: 'Path to the file to edit',
                required: true,
            },
            oldText: {
                type: 'string',
                description: 'The exact text to find and replace. Include surrounding context for uniqueness.',
                required: true,
            },
            newText: {
                type: 'string',
                description: 'The replacement text',
                required: true,
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const filePath = request.arguments.path as string;
        const oldText = request.arguments.oldText as string;
        const newText = request.arguments.newText as string;

        try {
            // Resolve path
            const resolvedPath = require('path').isAbsolute(filePath)
                ? filePath
                : require('path').join(request.context.cwd, filePath);

            // Read current content
            const uri = vscode.Uri.file(resolvedPath);
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();

            // Find the text
            const index = content.indexOf(oldText);
            if (index === -1) {
                return this.createResult(
                    false,
                    `Text not found in file. Make sure you're using the exact text including whitespace.`,
                    startTime
                );
            }

            // Check for multiple occurrences
            const secondIndex = content.indexOf(oldText, index + 1);
            if (secondIndex !== -1) {
                return this.createResult(
                    false,
                    `Multiple occurrences found. Please include more context to make the match unique.`,
                    startTime
                );
            }

            // Calculate position
            const startPos = document.positionAt(index);
            const endPos = document.positionAt(index + oldText.length);
            const range = new vscode.Range(startPos, endPos);

            // Apply edit
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, range, newText);
            const success = await vscode.workspace.applyEdit(edit);

            if (!success) {
                return this.createResult(false, 'Failed to apply edit', startTime);
            }

            // Save the document
            await document.save();

            return this.createResult(
                true,
                `Successfully replaced text at line ${startPos.line + 1}`,
                startTime,
                { 
                    line: startPos.line + 1,
                    column: startPos.character + 1,
                    charsReplaced: oldText.length,
                    charsInserted: newText.length,
                }
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to replace text: ${message}`, startTime);
        }
    }
}

// ============================================================================
// Insert Text Tool
// ============================================================================

export class InsertTextTool extends BaseTool {
    constructor() {
        super({
            name: 'insert_text',
            description: 'Insert text at a specific line in a file.',
            category: 'editor',
            requiresConfirmation: true,
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            path: {
                type: 'string',
                description: 'Path to the file',
                required: true,
            },
            line: {
                type: 'number',
                description: 'Line number to insert at (1-indexed). Text is inserted before this line.',
                required: true,
            },
            text: {
                type: 'string',
                description: 'The text to insert',
                required: true,
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const filePath = request.arguments.path as string;
        const lineNum = request.arguments.line as number;
        const text = request.arguments.text as string;

        try {
            const resolvedPath = require('path').isAbsolute(filePath)
                ? filePath
                : require('path').join(request.context.cwd, filePath);

            const uri = vscode.Uri.file(resolvedPath);
            const document = await vscode.workspace.openTextDocument(uri);

            // Validate line number
            if (lineNum < 1 || lineNum > document.lineCount + 1) {
                return this.createResult(
                    false,
                    `Invalid line number: ${lineNum}. File has ${document.lineCount} lines.`,
                    startTime
                );
            }

            // Calculate position (insert at beginning of line)
            const position = new vscode.Position(lineNum - 1, 0);

            // Apply edit
            const edit = new vscode.WorkspaceEdit();
            edit.insert(uri, position, text + '\n');
            const success = await vscode.workspace.applyEdit(edit);

            if (!success) {
                return this.createResult(false, 'Failed to apply edit', startTime);
            }

            await document.save();

            return this.createResult(
                true,
                `Successfully inserted text at line ${lineNum}`,
                startTime,
                { line: lineNum, charsInserted: text.length }
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to insert text: ${message}`, startTime);
        }
    }
}

// ============================================================================
// Get Selection Tool
// ============================================================================

export class GetSelectionTool extends BaseTool {
    constructor() {
        super({
            name: 'get_selection',
            description: 'Get the currently selected text in the active editor, along with file and position info.',
            category: 'editor',
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {};  // No parameters needed
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            return this.createResult(false, 'No active editor', startTime);
        }

        const selection = editor.selection;
        const document = editor.document;

        if (selection.isEmpty) {
            return this.createResult(
                true,
                'No text selected',
                startTime,
                {
                    file: vscode.workspace.asRelativePath(document.uri),
                    line: selection.active.line + 1,
                    column: selection.active.character + 1,
                    selected: false,
                }
            );
        }

        const selectedText = document.getText(selection);
        const language = document.languageId;

        return this.createResult(
            true,
            `Selected text from ${vscode.workspace.asRelativePath(document.uri)}:\n\`\`\`${language}\n${selectedText}\n\`\`\``,
            startTime,
            {
                file: vscode.workspace.asRelativePath(document.uri),
                language,
                startLine: selection.start.line + 1,
                endLine: selection.end.line + 1,
                text: selectedText,
                selected: true,
            }
        );
    }
}

// ============================================================================
// Go To Line Tool
// ============================================================================

export class GoToLineTool extends BaseTool {
    constructor() {
        super({
            name: 'go_to_line',
            description: 'Open a file and navigate to a specific line.',
            category: 'editor',
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            path: {
                type: 'string',
                description: 'Path to the file',
                required: true,
            },
            line: {
                type: 'number',
                description: 'Line number to navigate to (1-indexed)',
                required: true,
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const filePath = request.arguments.path as string;
        const lineNum = request.arguments.line as number;

        try {
            const resolvedPath = require('path').isAbsolute(filePath)
                ? filePath
                : require('path').join(request.context.cwd, filePath);

            const uri = vscode.Uri.file(resolvedPath);
            
            // Open the document
            const document = await vscode.workspace.openTextDocument(uri);
            
            // Show the editor
            const editor = await vscode.window.showTextDocument(document);
            
            // Navigate to line
            const position = new vscode.Position(lineNum - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );

            return this.createResult(
                true,
                `Opened ${filePath} at line ${lineNum}`,
                startTime,
                { file: filePath, line: lineNum }
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to open file: ${message}`, startTime);
        }
    }
}

// ============================================================================
// Get Diagnostics Tool
// ============================================================================

export class GetDiagnosticsTool extends BaseTool {
    constructor() {
        super({
            name: 'get_diagnostics',
            description: 'Get compiler errors, warnings, and linting issues for a file or the entire workspace.',
            category: 'editor',
            executionHint: 'fast',
        });
    }

    protected getParameters(): Record<string, ToolParameterSchema> {
        return {
            path: {
                type: 'string',
                description: 'Path to the file. Omit to get diagnostics for all open files.',
                required: false,
            },
            severity: {
                type: 'string',
                description: 'Filter by severity: "error", "warning", "info", or "all"',
                required: false,
                enum: ['error', 'warning', 'info', 'all'],
                default: 'all',
            },
        };
    }

    protected async doExecute(request: ToolRequest): Promise<ToolResult> {
        const startTime = Date.now();
        const filePath = request.arguments.path as string | undefined;
        const severity = (request.arguments.severity as string) ?? 'all';

        try {
            let diagnostics: [vscode.Uri, readonly vscode.Diagnostic[]][];

            if (filePath) {
                const resolvedPath = require('path').isAbsolute(filePath)
                    ? filePath
                    : require('path').join(request.context.cwd, filePath);
                const uri = vscode.Uri.file(resolvedPath);
                const fileDiags = vscode.languages.getDiagnostics(uri);
                diagnostics = [[uri, fileDiags]];
            } else {
                diagnostics = vscode.languages.getDiagnostics();
            }

            // Filter by severity
            const severityMap: Record<string, vscode.DiagnosticSeverity[]> = {
                'error': [vscode.DiagnosticSeverity.Error],
                'warning': [vscode.DiagnosticSeverity.Warning],
                'info': [vscode.DiagnosticSeverity.Information, vscode.DiagnosticSeverity.Hint],
                'all': [
                    vscode.DiagnosticSeverity.Error,
                    vscode.DiagnosticSeverity.Warning,
                    vscode.DiagnosticSeverity.Information,
                    vscode.DiagnosticSeverity.Hint,
                ],
            };

            const allowedSeverities = severityMap[severity] || severityMap['all'];

            const results: Array<{
                file: string;
                line: number;
                severity: string;
                message: string;
                source?: string;
            }> = [];

            for (const [uri, diags] of diagnostics) {
                for (const diag of diags) {
                    if (allowedSeverities.includes(diag.severity)) {
                        results.push({
                            file: vscode.workspace.asRelativePath(uri),
                            line: diag.range.start.line + 1,
                            severity: this.severityToString(diag.severity),
                            message: diag.message,
                            source: diag.source,
                        });
                    }
                }
            }

            if (results.length === 0) {
                return this.createResult(true, 'No diagnostics found', startTime, { diagnostics: [] });
            }

            const content = `Found ${results.length} diagnostic(s):\n${
                results.map(d => `- ${d.file}:${d.line} [${d.severity}] ${d.message}`).join('\n')
            }`;

            return this.createResult(true, content, startTime, { diagnostics: results });

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, `Failed to get diagnostics: ${message}`, startTime);
        }
    }

    private severityToString(severity: vscode.DiagnosticSeverity): string {
        switch (severity) {
            case vscode.DiagnosticSeverity.Error: return 'error';
            case vscode.DiagnosticSeverity.Warning: return 'warning';
            case vscode.DiagnosticSeverity.Information: return 'info';
            case vscode.DiagnosticSeverity.Hint: return 'hint';
            default: return 'unknown';
        }
    }
}
