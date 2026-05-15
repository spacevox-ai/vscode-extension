/**
 * Session History Service
 * 
 * Service layer for managing AI session history operations.
 * Provides a clean abstraction over the API layer with proper error handling,
 * data transformation, and caching capabilities.
 * 
 * @module chat/SessionHistoryService
 */

import { Logger } from '../utils/Logger';
import { getSseClient } from '../mcp/SseClient';
import { getAiEndpoint } from '../config/EnvironmentConfig';
import { ChatMessage, ChatAttachment } from '../tools/types';
import {
    AgentTurn,
    TurnType,
    SessionHistoryResponse,
    SessionHistoryData,
    SessionHistoryMetadata,
    AISessionInfo,
    LoadSessionResult,
    SessionLoadState,
    SessionLoadProgress,
    ConversionOptions,
    DEFAULT_CONVERSION_OPTIONS,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const SERVICE_TAG = 'SessionHistoryService';
const MAX_CACHE_SIZE = 10;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Cache Types
// ============================================================================

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

// ============================================================================
// Turn to Message Converter
// ============================================================================

/**
 * Converts backend AgentTurn objects to frontend ChatMessage format.
 * 
 * This is a pure function that handles the transformation logic
 * with proper handling of all turn types.
 */
export class TurnConverter {
    private static idCounter = 0;

    /**
     * Generate a unique message ID
     */
    private static generateId(): string {
        return `hist-${Date.now()}-${++this.idCounter}`;
    }

    /**
     * Convert a single AgentTurn to ChatMessage(s)
     * 
     * Some turns may expand to multiple messages (e.g., tool calls with results)
     */
    public static turnToMessages(
        turn: AgentTurn,
        options: ConversionOptions = DEFAULT_CONVERSION_OPTIONS
    ): ChatMessage[] {
        const messages: ChatMessage[] = [];

        switch (turn.type) {
            case TurnType.USER_MESSAGE:
                messages.push({
                    id: this.generateId(),
                    role: 'user',
                    content: turn.content || '',
                    timestamp: turn.timestamp,
                });
                break;

            case TurnType.ASSISTANT_MESSAGE:
                messages.push({
                    id: this.generateId(),
                    role: 'assistant',
                    content: turn.content || '',
                    timestamp: turn.timestamp,
                    toolCalls: turn.toolCalls?.map(tc => ({
                        id: tc.id,
                        name: tc.name,
                        arguments: tc.arguments,
                    })),
                });
                break;

            case TurnType.TOOL_CALL:
                if (options.includeToolCalls && turn.toolCalls?.length) {
                    // Tool calls are typically part of assistant messages
                    // Include as assistant message with tool calls
                    messages.push({
                        id: this.generateId(),
                        role: 'assistant',
                        content: turn.content || '',
                        timestamp: turn.timestamp,
                        toolCalls: turn.toolCalls.map(tc => ({
                            id: tc.id,
                            name: tc.name,
                            arguments: tc.arguments,
                        })),
                    });
                }
                break;

            case TurnType.TOOL_RESULT:
                if (options.includeToolCalls && turn.toolResults?.length) {
                    // Tool results can be shown as system-like messages
                    // or folded into the previous tool call
                    for (const result of turn.toolResults) {
                        messages.push({
                            id: this.generateId(),
                            role: 'tool',
                            content: result.success 
                                ? (result.result || 'Tool executed successfully') 
                                : (result.error || 'Tool execution failed'),
                            timestamp: turn.timestamp,
                            metadata: {
                                toolCallId: result.toolCallId,
                                toolName: result.toolName,
                                success: result.success,
                            },
                        });
                    }
                }
                break;

            case TurnType.ERROR:
                if (options.includeErrors) {
                    messages.push({
                        id: this.generateId(),
                        role: 'assistant',
                        content: turn.content || 'An error occurred',
                        timestamp: turn.timestamp,
                        metadata: { isError: true },
                    });
                }
                break;

            case TurnType.SYSTEM:
            case TurnType.SYSTEM_SUMMARY:
                if (options.includeSystemMessages) {
                    messages.push({
                        id: this.generateId(),
                        role: 'system',
                        content: turn.content || '',
                        timestamp: turn.timestamp,
                        metadata: { 
                            isSummary: turn.type === TurnType.SYSTEM_SUMMARY 
                        },
                    });
                }
                break;
        }

        return messages;
    }

    /**
     * Convert an array of AgentTurns to ChatMessages
     */
    public static turnsToMessages(
        turns: AgentTurn[],
        options: ConversionOptions = DEFAULT_CONVERSION_OPTIONS
    ): ChatMessage[] {
        const messages: ChatMessage[] = [];
        
        for (const turn of turns) {
            const converted = this.turnToMessages(turn, options);
            messages.push(...converted);
        }

        // Sort by timestamp to ensure proper order
        messages.sort((a, b) => a.timestamp - b.timestamp);

        return messages;
    }

    /**
     * Merge tool results back into their parent assistant messages
     * for a cleaner display
     */
    public static mergeToolResults(messages: ChatMessage[]): ChatMessage[] {
        const result: ChatMessage[] = [];
        const toolResultMap = new Map<string, ChatMessage>();

        // First pass: collect tool results by toolCallId
        for (const msg of messages) {
            if (msg.role === 'tool' && msg.metadata?.toolCallId) {
                toolResultMap.set(msg.metadata.toolCallId as string, msg);
            }
        }

        // Second pass: merge results into tool calls
        for (const msg of messages) {
            if (msg.role === 'tool') {
                // Skip standalone tool results - they'll be merged
                continue;
            }

            if (msg.toolCalls?.length) {
                // Merge tool results into tool calls
                const enrichedMsg = { ...msg };
                enrichedMsg.toolCalls = msg.toolCalls.map(tc => {
                    const resultMsg = toolResultMap.get(tc.id);
                    if (resultMsg) {
                        return {
                            ...tc,
                            result: {
                                success: resultMsg.metadata?.success as boolean ?? true,
                                output: resultMsg.content,
                                durationMs: 0,
                            },
                        };
                    }
                    return tc;
                });
                result.push(enrichedMsg);
            } else {
                result.push(msg);
            }
        }

        return result;
    }
}

// ============================================================================
// Session History Service
// ============================================================================

/**
 * Service for managing session history operations.
 * 
 * Features:
 * - Fetch session history from API
 * - Convert backend turns to frontend messages
 * - LRU cache for recently accessed sessions
 * - Progress tracking for long operations
 */
export class SessionHistoryService {
    private static instance: SessionHistoryService | null = null;
    
    // LRU cache for session history
    private cache: Map<string, CacheEntry<LoadSessionResult>> = new Map();
    
    // Progress listeners
    private progressListeners: Set<(progress: SessionLoadProgress) => void> = new Set();

    private constructor() {
        Logger.debug(`${SERVICE_TAG}: Initialized`);
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): SessionHistoryService {
        if (!this.instance) {
            this.instance = new SessionHistoryService();
        }
        return this.instance;
    }

    /**
     * Subscribe to session load progress events
     */
    public onProgress(listener: (progress: SessionLoadProgress) => void): () => void {
        this.progressListeners.add(listener);
        return () => this.progressListeners.delete(listener);
    }

    /**
     * Emit progress to all listeners
     */
    private emitProgress(progress: SessionLoadProgress): void {
        for (const listener of this.progressListeners) {
            try {
                listener(progress);
            } catch (error) {
                Logger.error(`${SERVICE_TAG}: Progress listener error`, error);
            }
        }
    }

    /**
     * Load a session's conversation history
     * 
     * @param sessionId - The session ID to load
     * @param options - Conversion options for turn-to-message transformation
     * @param forceRefresh - If true, bypass cache and fetch fresh data
     * @returns LoadSessionResult with messages or error
     */
    public async loadSession(
        sessionId: string,
        options: ConversionOptions = DEFAULT_CONVERSION_OPTIONS,
        forceRefresh: boolean = false
    ): Promise<LoadSessionResult> {
        Logger.info(`${SERVICE_TAG}: Loading session ${sessionId}`);

        // Check cache first
        if (!forceRefresh) {
            const cached = this.getFromCache(sessionId);
            if (cached) {
                Logger.debug(`${SERVICE_TAG}: Returning cached session ${sessionId}`);
                this.emitProgress({
                    state: SessionLoadState.SUCCESS,
                    sessionId,
                    progress: 100,
                    message: 'Loaded from cache',
                });
                return cached;
            }
        }

        // Emit loading state
        this.emitProgress({
            state: SessionLoadState.LOADING,
            sessionId,
            progress: 0,
            message: 'Fetching session history...',
        });

        try {
            // Fetch from API
            const client = getSseClient(getAiEndpoint());
            const response = await client.getSessionHistory(sessionId);

            this.emitProgress({
                state: SessionLoadState.LOADING,
                sessionId,
                progress: 50,
                message: 'Converting messages...',
            });

            // Handle API error
            if (!response.success) {
                const error = response.error || 'Failed to load session';
                const state = error.includes('not found') 
                    ? SessionLoadState.NOT_FOUND 
                    : SessionLoadState.ERROR;
                
                this.emitProgress({
                    state,
                    sessionId,
                    error,
                });

                return {
                    success: false,
                    sessionId,
                    messages: [],
                    error,
                };
            }

            // Convert turns to messages
            const turns = response.history?.turns || [];
            const messages = TurnConverter.turnsToMessages(turns, options);
            const mergedMessages = TurnConverter.mergeToolResults(messages);

            const result: LoadSessionResult = {
                success: true,
                sessionId,
                messages: mergedMessages,
                metadata: response.metadata,
            };

            // Cache the result
            this.addToCache(sessionId, result);

            this.emitProgress({
                state: SessionLoadState.SUCCESS,
                sessionId,
                progress: 100,
                message: `Loaded ${mergedMessages.length} messages`,
            });

            Logger.info(`${SERVICE_TAG}: Loaded ${mergedMessages.length} messages for session ${sessionId}`);

            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            Logger.error(`${SERVICE_TAG}: Failed to load session ${sessionId}`, error);

            this.emitProgress({
                state: SessionLoadState.ERROR,
                sessionId,
                error: errorMessage,
            });

            return {
                success: false,
                sessionId,
                messages: [],
                error: errorMessage,
            };
        }
    }

    /**
     * Get user's sessions list
     */
    public async getMySessions(
        agentId?: string,
        sessionContext?: string,
        limit: number = 20
    ): Promise<AISessionInfo[]> {
        try {
            const client = getSseClient(getAiEndpoint());
            const response = await client.getMySessions(agentId, sessionContext, limit);
            
            if (response.success) {
                return response.sessions || [];
            }
            
            Logger.warn(`${SERVICE_TAG}: Failed to get sessions: ${response.error}`);
            return [];
        } catch (error) {
            Logger.error(`${SERVICE_TAG}: Error fetching sessions`, error);
            return [];
        }
    }

    /**
     * Clear the session cache
     */
    public clearCache(): void {
        this.cache.clear();
        Logger.debug(`${SERVICE_TAG}: Cache cleared`);
    }

    /**
     * Invalidate a specific session from cache
     */
    public invalidateSession(sessionId: string): void {
        this.cache.delete(sessionId);
        Logger.debug(`${SERVICE_TAG}: Invalidated cache for session ${sessionId}`);
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Get a session from cache if valid
     */
    private getFromCache(sessionId: string): LoadSessionResult | null {
        const entry = this.cache.get(sessionId);
        
        if (!entry) {
            return null;
        }

        // Check TTL
        const age = Date.now() - entry.timestamp;
        if (age > CACHE_TTL_MS) {
            this.cache.delete(sessionId);
            Logger.debug(`${SERVICE_TAG}: Cache entry expired for ${sessionId}`);
            return null;
        }

        return entry.data;
    }

    /**
     * Add a session to cache with LRU eviction
     */
    private addToCache(sessionId: string, result: LoadSessionResult): void {
        // LRU eviction if at capacity
        if (this.cache.size >= MAX_CACHE_SIZE) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(sessionId, {
            data: result,
            timestamp: Date.now(),
        });

        Logger.debug(`${SERVICE_TAG}: Cached session ${sessionId}`);
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Get the session history service instance
 */
export function getSessionHistoryService(): SessionHistoryService {
    return SessionHistoryService.getInstance();
}
