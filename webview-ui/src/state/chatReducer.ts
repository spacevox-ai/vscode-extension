/**
 * Chat State Reducer
 * 
 * Manages chat state with immutable updates.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  thinking?: string;
  error?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: ToolResult;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: any;
  durationMs: number;
}

export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  thinking: string | null;
  thinkingMessageId: string | null;  // Track which message thinking belongs to
  activeToolCalls: Map<string, ToolCall>;
  tools: any[];
}

export type ChatAction =
  | { type: 'INIT'; payload: { messages: ChatMessage[]; tools: any[] } }
  | { type: 'ADD_MESSAGE'; payload: ChatMessage }
  | { type: 'APPEND_CONTENT'; payload: { messageId: string; content: string } }
  | { type: 'SET_THINKING'; payload: { messageId: string; thinking: string } }
  | { type: 'TOOL_CALL_START'; payload: { messageId: string; toolCall: ToolCall } }
  | { type: 'TOOL_CALL_COMPLETE'; payload: { messageId: string; toolCallId: string; result: ToolResult } }
  | { type: 'STREAM_COMPLETE'; payload: { messageId: string } }
  | { type: 'STREAM_ERROR'; payload: { messageId: string; error: string } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'SET_ERROR'; payload: string | null };

export const initialState: ChatState = {
  messages: [],
  isLoading: false,
  error: null,
  thinking: null,
  thinkingMessageId: null,
  activeToolCalls: new Map(),
  tools: [],
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'INIT':
      return {
        ...state,
        messages: action.payload.messages,
        tools: action.payload.tools,
        isLoading: false,
        error: null,
      };

    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.payload],
      };

    case 'APPEND_CONTENT': {
      const { messageId, content } = action.payload;
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === messageId
            ? { ...msg, content: msg.content + content }
            : msg
        ),
      };
    }

    case 'SET_THINKING': {
      const { messageId, thinking } = action.payload;
      // Append thinking content (not replace) and store on message
      const existingThinking = state.thinking || '';
      const newThinking = existingThinking + thinking;
      
      return {
        ...state,
        thinking: newThinking,
        thinkingMessageId: messageId,
        // Also store on the message for persistence
        messages: state.messages.map(msg =>
          msg.id === messageId
            ? { ...msg, thinking: newThinking }
            : msg
        ),
      };
    }

    case 'TOOL_CALL_START': {
      const { messageId, toolCall } = action.payload;
      const newToolCalls = new Map(state.activeToolCalls);
      newToolCalls.set(toolCall.id, { ...toolCall, status: 'running' });
      
      return {
        ...state,
        activeToolCalls: newToolCalls,
        messages: state.messages.map(msg =>
          msg.id === messageId
            ? {
                ...msg,
                toolCalls: [...(msg.toolCalls || []), { ...toolCall, status: 'running' }],
              }
            : msg
        ),
      };
    }

    case 'TOOL_CALL_COMPLETE': {
      const { messageId, toolCallId, result } = action.payload;
      const newToolCalls = new Map(state.activeToolCalls);
      newToolCalls.delete(toolCallId);

      return {
        ...state,
        activeToolCalls: newToolCalls,
        messages: state.messages.map(msg =>
          msg.id === messageId
            ? {
                ...msg,
                toolCalls: msg.toolCalls?.map(tc =>
                  tc.id === toolCallId
                    ? { ...tc, status: result.success ? 'completed' : 'error', result }
                    : tc
                ),
              }
            : msg
        ),
      };
    }

    case 'STREAM_COMPLETE':
      // Clear active thinking indicator but keep thinking persisted on message
      return {
        ...state,
        isLoading: false,
        thinking: null,
        thinkingMessageId: null,
      };

    case 'STREAM_ERROR': {
      const { messageId, error } = action.payload;
      return {
        ...state,
        isLoading: false,
        thinking: null,
        thinkingMessageId: null,
        error,
        messages: state.messages.map(msg =>
          msg.id === messageId
            ? { ...msg, error }
            : msg
        ),
      };
    }

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };

    case 'CLEAR_HISTORY':
      return {
        ...initialState,
        tools: state.tools,
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
      };

    default:
      return state;
  }
}
