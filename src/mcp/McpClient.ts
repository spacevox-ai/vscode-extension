/**
 * MCP (Model Context Protocol) WebSocket Client
 * 
 * Handles communication with the work.studio MCP server using JSON-RPC 2.0.
 */

import * as vscode from 'vscode';
import WebSocket from 'ws';
import { Logger } from '../utils/Logger';
import { JsonRpcMessage, JsonRpcError, McpToolCallParams, McpToolCallResult } from './types';
import { getAgentId } from '../config/EnvironmentConfig';

export class McpClient {
    private ws: WebSocket | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number | string, {
        resolve: (result: unknown) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }>();
    private connected = false;
    private initialized = false;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private token: string | null = null;
    private serverUrl: string | null = null;

    // Event emitters
    private onConnectedEmitter = new vscode.EventEmitter<void>();
    private onDisconnectedEmitter = new vscode.EventEmitter<void>();
    private onErrorEmitter = new vscode.EventEmitter<Error>();

    public readonly onConnected = this.onConnectedEmitter.event;
    public readonly onDisconnected = this.onDisconnectedEmitter.event;
    public readonly onError = this.onErrorEmitter.event;

    /**
     * Connect to the MCP server
     */
    async connect(serverUrl: string, token: string): Promise<void> {
        this.serverUrl = serverUrl;
        this.token = token;

        return new Promise((resolve, reject) => {
            try {
                // Append token as query parameter
                const url = new URL(serverUrl);
                url.searchParams.set('token', token);

                Logger.info(`Connecting to MCP server: ${serverUrl}`);

                this.ws = new WebSocket(url.toString(), {
                    headers: {
                        'X-MCP-Client': 'vscode',
                        'X-MCP-Client-Version': vscode.extensions.getExtension('workstudio.work-studio-ai')?.packageJSON.version || '0.1.0'
                    }
                });

                this.ws.on('open', () => {
                    Logger.info('WebSocket connection established');
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this.onConnectedEmitter.fire();
                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    this.handleMessage(data);
                });

                this.ws.on('close', (code, reason) => {
                    Logger.info(`WebSocket closed: ${code} - ${reason}`);
                    this.connected = false;
                    this.initialized = false;
                    this.onDisconnectedEmitter.fire();
                    this.handleReconnect();
                });

                this.ws.on('error', (error) => {
                    Logger.error('WebSocket error', error);
                    this.onErrorEmitter.fire(error);
                    reject(error);
                });

            } catch (error) {
                Logger.error('Failed to create WebSocket connection', error);
                reject(error);
            }
        });
    }

    /**
     * Initialize the MCP session
     */
    async initialize(): Promise<void> {
        const result = await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
                roots: { listChanged: false },
                sampling: {}
            },
            clientInfo: {
                name: 'workstudio-vscode',
                version: vscode.extensions.getExtension('workstudio.work-studio-ai')?.packageJSON.version || '0.1.0'
            }
        });

        Logger.info('MCP initialized', result);
        this.initialized = true;

        // Send initialized notification
        await this.sendNotification('notifications/initialized', {});
    }

    /**
     * Disconnect from the server
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }
        this.connected = false;
        this.initialized = false;
        this.token = null;
        
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
    }

    /**
     * Check if connected to the server
     */
    isConnected(): boolean {
        return this.connected && this.initialized;
    }

    /**
     * Call a tool on the server
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
        if (!this.isConnected()) {
            throw new Error('Not connected to MCP server');
        }

        const params: McpToolCallParams = {
            name,
            arguments: args
        };

        const result = await this.sendRequest('tools/call', params);
        return result as McpToolCallResult;
    }

    /**
     * List available tools
     */
    async listTools(): Promise<Array<{ name: string; description: string }>> {
        if (!this.isConnected()) {
            throw new Error('Not connected to MCP server');
        }

        const result = await this.sendRequest('tools/list', {});
        return (result as { tools: Array<{ name: string; description: string }> }).tools;
    }

    /**
     * Request code completion
     */
    async completeCode(params: {
        prefix: string;
        suffix: string;
        language: string;
        filePath?: string;
        maxTokens?: number;
    }): Promise<string> {
        const result = await this.callTool('complete-code', {
            ...params,
            agentId: getAgentId(),  // Include agent ID from config
        });
        
        if (result.isError) {
            const errorText = result.content?.[0]?.text || 'Unknown error';
            throw new Error(errorText);
        }

        return result.content?.[0]?.text || '';
    }

    /**
     * Send a chat message to the AI
     */
    async chat(params: {
        message: string;
        context?: string;
        history?: string;
        references?: string[];
    }): Promise<{ content: string | null; error?: string }> {
        try {
            const result = await this.callTool('chat', {
                message: params.message,
                context: params.context || '',
                history: params.history || '',
                references: params.references || [],
                agentId: getAgentId(),  // Include agent ID from config
            });

            if (result.isError) {
                const errorText = result.content?.[0]?.text || 'Unknown error';
                return { content: null, error: errorText };
            }

            return { content: result.content?.[0]?.text || null };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { content: null, error: message };
        }
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private async sendRequest(method: string, params: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            const id = ++this.requestId;
            const message: JsonRpcMessage = {
                jsonrpc: '2.0',
                id,
                method,
                params: params as Record<string, unknown>
            };

            // Set timeout (30 seconds)
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, 30000);

            this.pendingRequests.set(id, { resolve, reject, timeout });

            const json = JSON.stringify(message);
            Logger.debug(`Sending: ${method}`, { id });
            this.ws.send(json);
        });
    }

    private async sendNotification(method: string, params: unknown): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket not connected');
        }

        const message: JsonRpcMessage = {
            jsonrpc: '2.0',
            method,
            params: params as Record<string, unknown>
        };

        const json = JSON.stringify(message);
        Logger.debug(`Sending notification: ${method}`);
        this.ws.send(json);
    }

    private handleMessage(data: WebSocket.Data): void {
        try {
            const message = JSON.parse(data.toString()) as JsonRpcMessage;
            Logger.debug('Received message', { id: message.id, method: message.method });

            // Handle response to our request
            if (message.id !== undefined && !message.method) {
                const pending = this.pendingRequests.get(message.id);
                if (pending) {
                    this.pendingRequests.delete(message.id);
                    clearTimeout(pending.timeout);

                    if (message.error) {
                        pending.reject(new Error(message.error.message));
                    } else {
                        pending.resolve(message.result);
                    }
                }
                return;
            }

            // Handle server notification
            if (message.method) {
                this.handleNotification(message.method, message.params);
            }

        } catch (error) {
            Logger.error('Failed to parse message', error);
        }
    }

    private handleNotification(method: string, params?: Record<string, unknown>): void {
        Logger.debug(`Server notification: ${method}`, params);
        
        // Handle specific notifications
        switch (method) {
            case 'notifications/tools/list_changed':
                // Tools list changed, could refresh cache
                Logger.info('Tools list changed on server');
                break;
            case 'notifications/message':
                // Log message from server
                const level = (params?.level as string) || 'info';
                const logMessage = (params?.data as string) || '';
                Logger.info(`Server log [${level}]: ${logMessage}`);
                break;
        }
    }

    private handleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            Logger.warn('Max reconnect attempts reached');
            return;
        }

        if (!this.token || !this.serverUrl) {
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        
        Logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        setTimeout(async () => {
            try {
                await this.connect(this.serverUrl!, this.token!);
                await this.initialize();
            } catch (error) {
                Logger.error('Reconnect failed', error);
            }
        }, delay);
    }
}
