import { useEffect, useReducer, useCallback, useState } from 'react';
import { ChatContainer } from './components/ChatContainer';
import { Attachment } from './components/ChatInput';
import { Environment } from './components/EnvironmentSelector';
import { vscode, MessageFromExtension } from './utilities/vscode';
import { chatReducer, initialState } from './state/chatReducer';
import { WebviewBranding, DEFAULT_BRANDING, BrandTheme } from './types/branding';

interface ConnectionState {
  isConnected: boolean;
  currentEnv: Environment | null;
  environments: Environment[];
}

/**
 * Apply theme variables to CSS custom properties
 */
function applyThemeVariables(theme?: Partial<BrandTheme>) {
  if (!theme) return;
  
  const root = document.documentElement;
  if (theme.accentColor) {
    root.style.setProperty('--brand-accent', theme.accentColor);
  }
  if (theme.assistantAvatarGradient) {
    root.style.setProperty('--brand-avatar-gradient', theme.assistantAvatarGradient);
  }
}

export default function App() {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [connection, setConnection] = useState<ConnectionState>({
    isConnected: false,
    currentEnv: null,
    environments: [],
  });
  const [branding, setBranding] = useState<WebviewBranding>(DEFAULT_BRANDING);

  // Handle messages from extension
  const handleMessage = useCallback((event: MessageEvent<MessageFromExtension>) => {
    const message = event.data;

    switch (message.type) {
      case 'init':
        dispatch({ 
          type: 'INIT', 
          payload: { 
            messages: message.payload.messages,
            tools: message.payload.tools,
          } 
        });
        // Apply branding if provided
        if (message.payload.branding) {
          setBranding(prev => ({ ...prev, ...message.payload.branding }));
          // Apply theme CSS variables
          applyThemeVariables(message.payload.branding.theme);
        }
        break;

      case 'connectionStatus':
        // Update connection state from extension
        setConnection({
          isConnected: message.payload.isConnected ?? false,
          currentEnv: message.payload.currentEnv ?? null,
          environments: message.payload.environments ?? [],
        });
        break;

      case 'messageAdded':
        dispatch({ type: 'ADD_MESSAGE', payload: message.payload });
        break;

      case 'streamContent':
        dispatch({ 
          type: 'APPEND_CONTENT', 
          payload: { 
            messageId: message.payload.messageId, 
            content: message.payload.content 
          } 
        });
        break;

      case 'streamThinking':
        dispatch({
          type: 'SET_THINKING',
          payload: {
            messageId: message.payload.messageId,
            thinking: message.payload.thinking,
          }
        });
        break;

      case 'toolCallStart':
        dispatch({
          type: 'TOOL_CALL_START',
          payload: {
            messageId: message.payload.messageId,
            toolCall: message.payload.toolCall,
          }
        });
        break;

      case 'toolCallComplete':
        dispatch({
          type: 'TOOL_CALL_COMPLETE',
          payload: {
            messageId: message.payload.messageId,
            toolCallId: message.payload.toolCallId,
            result: message.payload.result,
          }
        });
        break;

      case 'streamComplete':
        dispatch({ type: 'STREAM_COMPLETE', payload: { messageId: message.payload.messageId } });
        break;

      case 'streamError':
        dispatch({
          type: 'STREAM_ERROR',
          payload: {
            messageId: message.payload.messageId,
            error: message.payload.error,
          }
        });
        break;

      case 'historyCleared':
        dispatch({ type: 'CLEAR_HISTORY' });
        break;
    }
  }, []);

  // Set up message listener
  useEffect(() => {
    window.addEventListener('message', handleMessage);
    
    // Signal ready to extension
    vscode.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [handleMessage]);

  // Send message handler
  const handleSendMessage = useCallback((content: string, attachments?: Attachment[]) => {
    if (!content.trim() && (!attachments || attachments.length === 0)) return;
    
    dispatch({ type: 'SET_LOADING', payload: true });
    vscode.postMessage({ 
      type: 'sendMessage', 
      payload: { 
        content,
        attachments: attachments?.map(a => ({
          type: a.type,
          name: a.name,
          data: a.data,
          size: a.size
        }))
      } 
    });
  }, []);

  // Clear history handler
  const handleClearHistory = useCallback(() => {
    vscode.postMessage({ type: 'clearHistory' });
  }, []);

  // Cancel request handler
  const handleCancel = useCallback(() => {
    vscode.postMessage({ type: 'cancelRequest' });
    dispatch({ type: 'SET_LOADING', payload: false });
  }, []);

  // Copy code handler
  const handleCopyCode = useCallback((code: string) => {
    vscode.postMessage({ type: 'copyToClipboard', payload: { text: code } });
  }, []);

  // Insert code handler
  const handleInsertCode = useCallback((code: string, language?: string) => {
    vscode.postMessage({ type: 'insertCode', payload: { code, language } });
  }, []);

  // Environment selection handler
  const handleSelectEnv = useCallback((envId: string) => {
    vscode.postMessage({ type: 'selectEnvironment', payload: { envId } });
  }, []);

  return (
    <ChatContainer
      messages={state.messages}
      isLoading={state.isLoading}
      error={state.error}
      thinking={state.thinking}
      activeToolCalls={state.activeToolCalls}
      isConnected={connection.isConnected}
      currentEnv={connection.currentEnv}
      environments={connection.environments}
      branding={branding}
      onSendMessage={handleSendMessage}
      onClearHistory={handleClearHistory}
      onCancel={handleCancel}
      onCopyCode={handleCopyCode}
      onInsertCode={handleInsertCode}
      onSelectEnv={handleSelectEnv}
    />
  );
}
