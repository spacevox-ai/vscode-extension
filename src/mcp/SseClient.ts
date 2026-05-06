/**
 * SSE Client for streaming chat with work.studio MCP API
 * 
 * Handles Server-Sent Events (SSE) streaming for chat responses.
 * The MCP API uses HTTP/SSE for streaming instead of WebSocket for simplicity.
 * 
 * Endpoints:
 *   - POST /api/v1/mcp/chat/stream - SSE streaming chat
 *   - POST /api/v1/mcp/complete - Code completion (synchronous)
 *   - GET /api/v1/mcp/capabilities - Discovery
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { Logger } from '../utils/Logger';
import { getAgentId } from '../config/EnvironmentConfig';

// ============================================================================
// Types
// ============================================================================

/**
 * SSE event types from the server
 */
export type SseEventType = 'thinking' | 'token' | 'tool_start' | 'tool_result' | 'done' | 'error';

/**
 * SSE event data
 */
export interface SseEvent {
    type: SseEventType;
    data: {
        content?: string;
        toolName?: string;
        toolCallId?: string;
        result?: string;
        error?: string;
        code?: string;
        message?: string;
        usage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
        };
    };
}

/**
 * Callback for streaming events
 */
export type StreamCallback = (event: SseEvent) => void;

/**
 * Chat request parameters
 */
export interface ChatRequest {
    message: string;
    context?: string;
    history?: string;
    agentId?: string;
}

/**
 * Completion request parameters
 */
export interface CompletionRequest {
    prefix: string;
    suffix?: string;
    language?: string;
    filePath?: string;
    agentId?: string;
    maxTokens?: number;
}

/**
 * Completion response
 */
export interface CompletionResponse {
    completion: string;
    success: boolean;
    error?: string;
}

/**
 * Capabilities response
 */
export interface CapabilitiesResponse {
    serverName: string;
    serverVersion: string;
    agents: Array<{
        id: string;
        globalId: string;
        name: string;
        description: string;
        model: string;
    }>;
    tools: Array<{
        name: string;
        description: string;
    }>;
}

// ============================================================================
// SSE Client Implementation
// ============================================================================

export class McpSseClient {
    private baseUrl: string;
    private token: string | null = null;
    private tenantId: string | null = null;
    private envId: string | null = null;

    constructor(baseUrl: string) {
        // Convert WebSocket URL to HTTP URL if needed
        this.baseUrl = baseUrl
            .replace('ws://', 'http://')
            .replace('wss://', 'https://')
            .replace('/ws/mcp', '');  // Remove WebSocket path
        
        Logger.info(`McpSseClient initialized with base URL: ${this.baseUrl}`);
    }

    /**
     * Set authentication credentials
     */
    setCredentials(token: string, tenantId?: string, envId?: string): void {
        this.token = token;
        this.tenantId = tenantId || null;
        this.envId = envId || null;
        Logger.debug('SSE client credentials set', { hasTenant: !!tenantId, hasEnv: !!envId });
    }

    /**
     * Get MCP capabilities
     */
    async getCapabilities(): Promise<CapabilitiesResponse> {
        const url = `${this.baseUrl}/api/v1/mcp/capabilities`;
        return this.makeRequest<CapabilitiesResponse>('GET', url);
    }

    /**
     * Request code completion (synchronous)
     */
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const url = `${this.baseUrl}/api/v1/mcp/complete`;
        const body = {
            ...request,
            agentId: request.agentId || getAgentId()
        };
        return this.makeRequest<CompletionResponse>('POST', url, body);
    }

    /**
     * Stream chat response via SSE
     * 
     * @param request Chat request parameters
     * @param onEvent Callback for each SSE event
     * @returns Promise that resolves when stream completes
     */
    async chatStream(
        request: ChatRequest,
        onEvent: StreamCallback
    ): Promise<void> {
        const url = `${this.baseUrl}/api/v1/mcp/chat/stream`;
        const body = {
            ...request,
            agentId: request.agentId || getAgentId()
        };

        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const requestBody = JSON.stringify(body);
            
            const options: http.RequestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Content-Length': Buffer.byteLength(requestBody),
                    ...this.getAuthHeaders()
                }
            };

            Logger.debug('Starting SSE stream', { url, agentId: body.agentId });

            const req = httpModule.request(options, (res) => {
                if (res.statusCode !== 200) {
                    let errorBody = '';
                    res.on('data', (chunk) => { errorBody += chunk.toString(); });
                    res.on('end', () => {
                        reject(new Error(`HTTP ${res.statusCode}: ${errorBody || res.statusMessage}`));
                    });
                    return;
                }

                Logger.debug('SSE connection established');

                let buffer = '';

                res.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString();
                    
                    // Process complete SSE events
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer
                    
                    let currentEvent: { event?: string; data?: string } = {};
                    
                    for (const line of lines) {
                        if (line.startsWith('event:')) {
                            currentEvent.event = line.substring(6).trim();
                        } else if (line.startsWith('data:')) {
                            currentEvent.data = line.substring(5).trim();
                        } else if (line === '' && currentEvent.data) {
                            // Empty line marks end of event
                            this.processEvent(currentEvent.event || 'message', currentEvent.data, onEvent);
                            currentEvent = {};
                        }
                    }
                });

                res.on('end', () => {
                    Logger.debug('SSE stream ended');
                    // Send final done event if not already sent
                    resolve();
                });

                res.on('error', (error) => {
                    Logger.error('SSE stream error', error);
                    onEvent({
                        type: 'error',
                        data: { error: error.message }
                    });
                    reject(error);
                });
            });

            req.on('error', (error) => {
                Logger.error('SSE request error', error);
                reject(error);
            });

            req.write(requestBody);
            req.end();
        });
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Make a synchronous HTTP request
     */
    private async makeRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const requestBody = body ? JSON.stringify(body) : undefined;
            
            const options: http.RequestOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...(requestBody && { 'Content-Length': Buffer.byteLength(requestBody) }),
                    ...this.getAuthHeaders()
                }
            };

            const req = httpModule.request(options, (res) => {
                let responseBody = '';
                
                res.on('data', (chunk) => {
                    responseBody += chunk.toString();
                });
                
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            resolve(JSON.parse(responseBody));
                        } catch {
                            reject(new Error(`Invalid JSON response: ${responseBody}`));
                        }
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${responseBody || res.statusMessage}`));
                    }
                });
            });

            req.on('error', reject);

            if (requestBody) {
                req.write(requestBody);
            }
            req.end();
        });
    }

    /**
     * Get authentication headers
     */
    private getAuthHeaders(): Record<string, string> {
        const headers: Record<string, string> = {};
        
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        if (this.tenantId) {
            headers['X-SELECTED-TENANT'] = this.tenantId;
        }
        if (this.envId) {
            headers['X-SELECTED-ENV'] = this.envId;
        }
        
        return headers;
    }

    /**
     * Process an SSE event
     */
    private processEvent(eventType: string, data: string, onEvent: StreamCallback): void {
        try {
            const parsedData = JSON.parse(data);
            
            // Map server event names to our types
            // Backend sends: token, thinking, tool_start, tool_complete, done, error
            const typeMap: Record<string, SseEventType> = {
                'thinking': 'thinking',
                'token': 'token',
                'text': 'token',  // 'text' events are also tokens
                'tool_start': 'tool_start',
                'tool_complete': 'tool_result',  // Backend sends tool_complete
                'tool_result': 'tool_result',
                'done': 'done',
                'complete': 'done',
                'error': 'error'
            };

            // Determine event type from SSE event name or data.type field
            let type = typeMap[eventType];
            if (!type && parsedData.type) {
                // Some events have type in the data
                const dataTypeMap: Record<string, SseEventType> = {
                    'token': 'token',
                    'thinking': 'thinking',
                    'tool_call_start': 'tool_start',
                    'tool_call_complete': 'tool_result',
                };
                type = dataTypeMap[parsedData.type] || 'token';
            }
            type = type || 'token';

            onEvent({
                type,
                data: parsedData
            });

            Logger.debug('SSE event processed', { eventType, type, hasContent: !!parsedData.content });

        } catch (error) {
            // Non-JSON data, treat as raw token
            Logger.debug('SSE raw data', { data: data.substring(0, 100) });
            onEvent({
                type: 'token',
                data: { content: data }
            });
        }
    }
}

// ============================================================================
// Singleton instance
// ============================================================================

let sseClient: McpSseClient | null = null;

/**
 * Get or create the SSE client instance
 */
export function getSseClient(baseUrl?: string): McpSseClient {
    if (!sseClient && baseUrl) {
        sseClient = new McpSseClient(baseUrl);
    }
    if (!sseClient) {
        throw new Error('SSE client not initialized. Call getSseClient with baseUrl first.');
    }
    return sseClient;
}

/**
 * Initialize the SSE client with credentials
 */
export function initializeSseClient(baseUrl: string, token: string, tenantId?: string, envId?: string): McpSseClient {
    sseClient = new McpSseClient(baseUrl);
    sseClient.setCredentials(token, tenantId, envId);
    return sseClient;
}
