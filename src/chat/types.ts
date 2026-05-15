/**
 * Session History Types
 * 
 * TypeScript interfaces for session history management.
 * These types map to the backend AI runtime session and conversation models.
 * 
 * @module chat/types
 */

import { ChatMessage, ChatAttachment } from '../tools/types';

// ============================================================================
// Turn Types (from backend AgentTurn)
// ============================================================================

/**
 * Turn types matching backend AgentTurn.TurnType enum
 */
export enum TurnType {
    USER_MESSAGE = 'USER_MESSAGE',
    ASSISTANT_MESSAGE = 'ASSISTANT_MESSAGE',
    TOOL_CALL = 'TOOL_CALL',
    TOOL_RESULT = 'TOOL_RESULT',
    ERROR = 'ERROR',
    SYSTEM = 'SYSTEM',
    SYSTEM_SUMMARY = 'SYSTEM_SUMMARY'
}

/**
 * Tool call structure from backend LLMToolCall
 */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/**
 * Tool execution result from backend ToolExecutionResult
 */
export interface ToolExecutionResult {
    toolCallId: string;
    toolName: string;
    success: boolean;
    result?: string;
    error?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Single conversation turn from backend AgentTurn
 */
export interface AgentTurn {
    type: TurnType;
    content: string | null;
    toolCalls?: ToolCall[];
    toolResults?: ToolExecutionResult[];
    timestamp: number;
}

// ============================================================================
// Session History Response Types
// ============================================================================

/**
 * Metadata about a session's history
 */
export interface SessionHistoryMetadata {
    sessionId: string;
    status: string;
    assistantId?: string;
    messageCount: number;
}

/**
 * Session history data containing turns
 */
export interface SessionHistoryData {
    sessionId: string;
    assistantId?: string;
    turns: AgentTurn[];
    turnCount: number;
    historySummary?: string;
}

/**
 * Response from GET /sessions/history/{sessionId}
 */
export interface SessionHistoryResponse {
    success: boolean;
    error?: string;
    metadata?: SessionHistoryMetadata;
    history?: SessionHistoryData;
    historyUrl?: string;
}

// ============================================================================
// Session Info Types (already in SseClient, re-exported for convenience)
// ============================================================================

/**
 * AI Session metadata from the backend
 */
export interface AISessionInfo {
    id: string;
    tenantId: string;
    envId?: string;
    agentId?: string;
    userId?: string;
    userEmail?: string;
    sessionContext?: string;
    status?: string;
    title?: string;
    messageCount?: number;
    turnCount?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    createdAt?: string;
    updatedAt?: string;
    lastMessageAt?: string;
    artifactType?: string;
    artifactId?: string;
    artifactName?: string;
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Configuration for turn-to-message conversion
 */
export interface ConversionOptions {
    /** Whether to include tool call turns as separate messages */
    includeToolCalls?: boolean;
    /** Whether to include system messages */
    includeSystemMessages?: boolean;
    /** Whether to include error turns */
    includeErrors?: boolean;
}

/**
 * Default conversion options
 */
export const DEFAULT_CONVERSION_OPTIONS: ConversionOptions = {
    includeToolCalls: true,
    includeSystemMessages: false,
    includeErrors: true,
};

/**
 * Result of loading a session
 */
export interface LoadSessionResult {
    success: boolean;
    sessionId: string;
    messages: ChatMessage[];
    metadata?: SessionHistoryMetadata;
    error?: string;
}

/**
 * Session load state for tracking progress
 */
export enum SessionLoadState {
    IDLE = 'IDLE',
    LOADING = 'LOADING',
    SUCCESS = 'SUCCESS',
    ERROR = 'ERROR',
    NOT_FOUND = 'NOT_FOUND'
}

/**
 * Session load progress event
 */
export interface SessionLoadProgress {
    state: SessionLoadState;
    sessionId: string;
    progress?: number;
    message?: string;
    error?: string;
}
