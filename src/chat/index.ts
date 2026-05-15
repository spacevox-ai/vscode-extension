/**
 * Chat Module
 * 
 * This module provides session history management and chat-related functionality
 * for the VSCode extension.
 * 
 * @module chat
 */

// Types
export {
    TurnType,
    ToolCall,
    ToolExecutionResult,
    AgentTurn,
    SessionHistoryMetadata,
    SessionHistoryData,
    SessionHistoryResponse,
    AISessionInfo,
    ConversionOptions,
    DEFAULT_CONVERSION_OPTIONS,
    LoadSessionResult,
    SessionLoadState,
    SessionLoadProgress,
} from './types';

// Services
export {
    SessionHistoryService,
    TurnConverter,
    getSessionHistoryService,
} from './SessionHistoryService';
