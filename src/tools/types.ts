/**
 * Tool System Types
 * 
 * Core types for the extensible tool system.
 * Follows the Strategy pattern for tool execution.
 */

import * as vscode from 'vscode';

// ============================================================================
// Tool Definition Types
// ============================================================================

/**
 * JSON Schema for tool parameters
 */
export interface ToolParameterSchema {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    required?: boolean;
    enum?: string[];
    items?: ToolParameterSchema;  // For arrays
    properties?: Record<string, ToolParameterSchema>;  // For objects
    default?: unknown;
}

/**
 * Tool definition - what the AI sees
 */
export interface ToolDefinition {
    /** Unique tool name (snake_case) */
    name: string;
    
    /** Human-readable description for the AI */
    description: string;
    
    /** Parameter schema */
    parameters: Record<string, ToolParameterSchema>;
    
    /** Category for grouping */
    category: ToolCategory;
    
    /** Whether this tool requires user confirmation */
    requiresConfirmation?: boolean;
    
    /** Estimated execution time hint */
    executionHint?: 'fast' | 'medium' | 'slow';
}

/**
 * Tool categories for organization
 */
export type ToolCategory = 
    | 'filesystem'   // File read/write/search
    | 'terminal'     // Command execution
    | 'editor'       // Editor manipulation
    | 'workspace'    // Workspace operations
    | 'debug'        // Debugging
    | 'git'          // Version control
    | 'browser'      // Web operations
    | 'custom';      // User-defined

// ============================================================================
// Tool Execution Types
// ============================================================================

/**
 * Tool execution context - passed to every tool
 */
export interface ToolContext {
    /** Current workspace folders */
    workspaceFolders: readonly vscode.WorkspaceFolder[];
    
    /** Active text editor (if any) */
    activeEditor?: vscode.TextEditor;
    
    /** Current working directory */
    cwd: string;
    
    /** Cancellation token */
    cancellationToken: vscode.CancellationToken;
    
    /** Output channel for logging */
    outputChannel: vscode.OutputChannel;
    
    /** Progress reporter for long operations */
    progress?: vscode.Progress<{ message?: string; increment?: number }>;
    
    /** Session metadata */
    sessionId: string;
    
    /** User preferences */
    config: ToolConfig;
}

/**
 * Tool configuration from settings
 */
export interface ToolConfig {
    /** Whether to auto-approve safe operations */
    autoApprove: boolean;
    
    /** Maximum file size to read (bytes) */
    maxFileSize: number;
    
    /** Terminal timeout (ms) */
    terminalTimeout: number;
    
    /** Allowed file patterns (glob) */
    allowedPatterns: string[];
    
    /** Blocked file patterns (glob) */
    blockedPatterns: string[];
}

/**
 * Tool execution request
 */
export interface ToolRequest {
    /** Tool name */
    toolName: string;
    
    /** Tool call ID (for tracking) */
    toolCallId: string;
    
    /** Arguments from the AI */
    arguments: Record<string, unknown>;
    
    /** Execution context */
    context: ToolContext;
}

/**
 * Tool execution result
 */
export interface ToolResult {
    /** Whether execution succeeded */
    success: boolean;
    
    /** Result content (shown to AI) */
    content: string;
    
    /** Structured data (optional) */
    data?: unknown;
    
    /** Error message if failed */
    error?: string;
    
    /** Execution duration (ms) */
    durationMs: number;
    
    /** Whether the result should be shown to user */
    showToUser?: boolean;
    
    /** Side effects that occurred */
    sideEffects?: ToolSideEffect[];
}

/**
 * Side effects from tool execution (for undo/tracking)
 */
export interface ToolSideEffect {
    type: 'file_created' | 'file_modified' | 'file_deleted' | 'terminal_command' | 'editor_change';
    path?: string;
    description: string;
    reversible: boolean;
}

// ============================================================================
// Tool Interface (Strategy Pattern)
// ============================================================================

/**
 * Tool interface - all tools implement this
 */
export interface ITool {
    /** Get tool definition */
    getDefinition(): ToolDefinition;
    
    /** Validate arguments before execution */
    validateArguments(args: Record<string, unknown>): ValidationResult;
    
    /** Execute the tool */
    execute(request: ToolRequest): Promise<ToolResult>;
    
    /** Optional: Clean up resources */
    dispose?(): void;
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors?: string[];
}

// ============================================================================
// Tool Registry Types
// ============================================================================

/**
 * Tool registry events
 */
export interface ToolRegistryEvents {
    onToolRegistered: vscode.Event<ToolDefinition>;
    onToolUnregistered: vscode.Event<string>;
    onToolExecutionStart: vscode.Event<{ toolCallId: string; toolName: string }>;
    onToolExecutionComplete: vscode.Event<{ toolCallId: string; result: ToolResult }>;
}

/**
 * Tool execution options
 */
export interface ToolExecutionOptions {
    /** Skip confirmation even if tool requires it */
    skipConfirmation?: boolean;
    
    /** Timeout override (ms) */
    timeout?: number;
    
    /** Custom progress reporter */
    progress?: vscode.Progress<{ message?: string; increment?: number }>;
}

// ============================================================================
// Streaming Types
// ============================================================================

/**
 * Stream event from AI
 */
export interface AIStreamEvent {
    type: 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
    content?: string;
    toolCall?: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
    };
    toolResult?: ToolResult;
    error?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

/**
 * Attachment for chat messages (images, files)
 */
export interface ChatAttachment {
    type: 'image';
    name: string;
    data: string;  // base64 data URL
    size: number;
}

/**
 * Chat message for conversation history
 */
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
    attachments?: ChatAttachment[];
    toolCalls?: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        result?: ToolResult;
    }>;
    thinking?: string;
    metadata?: Record<string, unknown>;
}
