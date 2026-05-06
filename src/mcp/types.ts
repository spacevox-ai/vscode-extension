/**
 * MCP Protocol Types
 * 
 * TypeScript interfaces for MCP JSON-RPC communication.
 */

/**
 * JSON-RPC 2.0 message
 */
export interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: JsonRpcError;
}

/**
 * JSON-RPC error object
 */
export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

/**
 * MCP initialize request params
 */
export interface McpInitializeParams {
    protocolVersion: string;
    capabilities: {
        roots?: { listChanged?: boolean };
        sampling?: Record<string, unknown>;
        experimental?: Record<string, unknown>;
    };
    clientInfo: {
        name: string;
        version: string;
    };
}

/**
 * MCP initialize response
 */
export interface McpInitializeResult {
    protocolVersion: string;
    capabilities: {
        tools?: { listChanged?: boolean };
        resources?: Record<string, unknown>;
        prompts?: Record<string, unknown>;
        logging?: Record<string, unknown>;
    };
    serverInfo: {
        name: string;
        version: string;
    };
    instructions?: string;
}

/**
 * MCP tool definition
 */
export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/**
 * MCP tools/list response
 */
export interface McpToolsListResult {
    tools: McpToolDefinition[];
    nextCursor?: string;
}

/**
 * MCP tools/call request params
 */
export interface McpToolCallParams {
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * MCP content item
 */
export interface McpContentItem {
    type: 'text' | 'image' | 'resource' | 'thinking';
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: {
        uri: string;
        mimeType?: string;
        text?: string;
    };
}

/**
 * MCP tools/call response
 */
export interface McpToolCallResult {
    content: McpContentItem[];
    isError: boolean;
}

/**
 * Standard JSON-RPC error codes
 */
export const JsonRpcErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    // MCP-specific error codes
    UNAUTHORIZED: -32001,
    RATE_LIMITED: -32002,
    QUOTA_EXCEEDED: -32003,
    TOOL_NOT_FOUND: -32004,
    TOOL_EXECUTION_FAILED: -32005
} as const;
