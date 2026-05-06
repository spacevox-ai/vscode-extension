/**
 * Tool Implementations Index
 * 
 * Central export and registration for all tool implementations.
 */

// File Tools
export { ReadFileTool, WriteFileTool, SearchFilesTool, ListDirectoryTool } from './FileTools';

// Terminal Tools
export { TerminalTool, GetTerminalOutputTool } from './TerminalTool';

// Editor Tools
export { 
    ReplaceTextTool, 
    InsertTextTool, 
    GetSelectionTool, 
    GoToLineTool, 
    GetDiagnosticsTool 
} from './EditorTools';

// Workspace Tools
export { 
    GetWorkspaceInfoTool, 
    FindSymbolTool, 
    GetGitStatusTool, 
    RunCommandTool 
} from './WorkspaceTools';

import { ITool } from '../types';
import { ToolRegistry } from '../ToolRegistry';

// File Tools
import { ReadFileTool, WriteFileTool, SearchFilesTool, ListDirectoryTool } from './FileTools';
// Terminal Tools
import { TerminalTool, GetTerminalOutputTool } from './TerminalTool';
// Editor Tools
import { ReplaceTextTool, InsertTextTool, GetSelectionTool, GoToLineTool, GetDiagnosticsTool } from './EditorTools';
// Workspace Tools
import { GetWorkspaceInfoTool, FindSymbolTool, GetGitStatusTool, RunCommandTool } from './WorkspaceTools';

/**
 * Get all built-in tool instances
 */
export function getAllTools(): ITool[] {
    return [
        // File operations
        new ReadFileTool(),
        new WriteFileTool(),
        new SearchFilesTool(),
        new ListDirectoryTool(),
        
        // Terminal operations
        new TerminalTool(),
        new GetTerminalOutputTool(),
        
        // Editor operations
        new ReplaceTextTool(),
        new InsertTextTool(),
        new GetSelectionTool(),
        new GoToLineTool(),
        new GetDiagnosticsTool(),
        
        // Workspace operations
        new GetWorkspaceInfoTool(),
        new FindSymbolTool(),
        new GetGitStatusTool(),
        new RunCommandTool(),
    ];
}

/**
 * Register all built-in tools with the registry
 */
export function registerAllTools(registry: ToolRegistry = ToolRegistry.getInstance()): void {
    const tools = getAllTools();
    
    for (const tool of tools) {
        registry.register(tool);
    }
}

/**
 * Tool summary for documentation
 */
export const TOOL_SUMMARY = {
    filesystem: [
        { name: 'read_file', description: 'Read file contents with line range support' },
        { name: 'write_file', description: 'Write content to a file' },
        { name: 'search_files', description: 'Search files by glob or content' },
        { name: 'list_directory', description: 'List directory contents' },
    ],
    terminal: [
        { name: 'execute_command', description: 'Run shell commands' },
        { name: 'get_terminal_output', description: 'Get terminal output' },
    ],
    editor: [
        { name: 'replace_text', description: 'Replace text in a file' },
        { name: 'insert_text', description: 'Insert text at a line' },
        { name: 'get_selection', description: 'Get selected text' },
        { name: 'go_to_line', description: 'Navigate to a line' },
        { name: 'get_diagnostics', description: 'Get errors and warnings' },
    ],
    workspace: [
        { name: 'get_workspace_info', description: 'Get workspace information' },
        { name: 'find_symbol', description: 'Find symbols by name' },
        { name: 'get_git_status', description: 'Get git status' },
        { name: 'run_vscode_command', description: 'Run VS Code command' },
    ],
};
