/**
 * Chat Container
 * 
 * Main container component for the chat interface.
 * Designed to match GitHub Copilot's clean, minimal UX.
 */

import { useRef, useEffect, useState } from 'react';
import { ChatMessage as ChatMessageType, ToolCall } from '../state/chatReducer';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ToolCallIndicator } from './ToolCallIndicator';
import { EnvironmentSelector, Environment } from './EnvironmentSelector';
import { WebviewBranding, DEFAULT_BRANDING } from '../types/branding';

interface ChatContainerProps {
  messages: ChatMessageType[];
  isLoading: boolean;
  error: string | null;
  thinking: string | null;
  activeToolCalls: Map<string, ToolCall>;
  isConnected: boolean;
  currentEnv: Environment | null;
  environments: Environment[];
  branding?: WebviewBranding;
  onSendMessage: (content: string) => void;
  onClearHistory: () => void;
  onCancel: () => void;
  onCopyCode: (code: string) => void;
  onInsertCode: (code: string, language?: string) => void;
  onSelectEnv: (envId: string) => void;
}

export function ChatContainer({
  messages,
  isLoading,
  error,
  thinking,
  activeToolCalls,
  isConnected,
  currentEnv,
  environments,
  branding = DEFAULT_BRANDING,
  onSendMessage,
  onClearHistory,
  onCancel,
  onCopyCode,
  onInsertCode,
  onSelectEnv,
}: ChatContainerProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const hasActiveToolCalls = activeToolCalls.size > 0;

  const handleClear = () => {
    if (messages.length === 0) return;
    if (showClearConfirm) {
      onClearHistory();
      setShowClearConfirm(false);
    } else {
      setShowClearConfirm(true);
      setTimeout(() => setShowClearConfirm(false), 3000);
    }
  };

  const handleSuggestionClick = (action: string) => {
    onSendMessage(action);
  };

  return (
    <div className="chat-container">
      {/* Environment selector header */}
      <div className="chat-header">
        <EnvironmentSelector
          currentEnv={currentEnv}
          environments={environments}
          onSelectEnv={onSelectEnv}
          isConnected={isConnected}
        />
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="chat-welcome-header">
              <div className="chat-welcome-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
              </div>
              <h2>{branding.welcomeTitle}</h2>
            </div>
            
            <div className="chat-suggestions">
              {branding.suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  className="chat-suggestion"
                  onClick={() => handleSuggestionClick(suggestion.action)}
                >
                  <span className="chat-suggestion-icon">{suggestion.icon}</span>
                  <span className="chat-suggestion-text">{suggestion.text}</span>
                </button>
              ))}
            </div>
            
            <p className="chat-welcome-hint">
              {branding.welcomeHint}
            </p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                onCopyCode={onCopyCode}
                onInsertCode={onInsertCode}
              />
            ))}
          </>
        )}

        {/* Thinking indicator */}
        {thinking && <ThinkingIndicator content={thinking} />}

        {/* Active tool calls */}
        {hasActiveToolCalls && (
          <div className="active-tool-calls">
            {Array.from(activeToolCalls.values()).map((toolCall) => (
              <ToolCallIndicator key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}

        {/* Loading indicator when waiting for response */}
        {isLoading && !thinking && messages.length > 0 && 
         messages[messages.length - 1]?.content === '' && (
          <div className="chat-loading">
            <div className="chat-loading-dot"></div>
            <div className="chat-loading-dot"></div>
            <div className="chat-loading-dot"></div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="chat-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSendMessage={onSendMessage}
        onCancel={onCancel}
        onClear={handleClear}
        isLoading={isLoading}
        disabled={isLoading}
        showClearConfirm={showClearConfirm}
        hasMessages={messages.length > 0}
      />
    </div>
  );
}
