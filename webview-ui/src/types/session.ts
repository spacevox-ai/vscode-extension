/**
 * Session History Types for Webview
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

export interface SessionHistoryState {
  sessions: AISessionInfo[];
  count: number;
  isLoading: boolean;
  error?: string;
  isOpen: boolean;
}

export const initialSessionHistoryState: SessionHistoryState = {
  sessions: [],
  count: 0,
  isLoading: false,
  error: undefined,
  isOpen: false,
};
