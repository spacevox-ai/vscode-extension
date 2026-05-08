/**
 * Chat Container
 * 
 * Main container component for the chat interface.
 * Designed to match GitHub Copilot's clean, minimal UX.
 */

import { useRef, useEffect, useState } from 'react';
import { ChatMessage as ChatMessageType, ToolCall } from '../state/chatReducer';
import { ChatMessage } from './ChatMessage';
import { ChatInput, Attachment } from './ChatInput';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ToolCallIndicator } from './ToolCallIndicator';
import { EnvironmentSelector, Environment } from './EnvironmentSelector';
import { WebviewBranding, DEFAULT_BRANDING, BrandTheme } from '../types/branding';
import clsx from 'clsx';

/**
 * Render the welcome logo/icon based on branding theme
 */
function renderWelcomeLogo(theme: BrandTheme) {
  // Priority 1: Logo URL (external image)
  if (theme.logoUrl) {
    return (
      <div className="chat-welcome-logo">
        <img src={theme.logoUrl} alt="Logo" />
      </div>
    );
  }
  
  // Priority 2: Logo SVG (inline SVG)
  if (theme.logoSvg) {
    return (
      <div className="chat-welcome-logo" dangerouslySetInnerHTML={{ __html: theme.logoSvg }} />
    );
  }
  
  // Priority 3: Custom avatar SVG in icon
  if (theme.assistantAvatarIcon === 'custom' && theme.customAvatarSvg) {
    return (
      <div 
        className="chat-welcome-icon" 
        style={{ background: theme.assistantAvatarGradient }}
        dangerouslySetInnerHTML={{ __html: theme.customAvatarSvg }} 
      />
    );
  }
  
  // Priority 4: Built-in icons with gradient
  const iconSvg = getBuiltInIcon(theme.assistantAvatarIcon);
  return (
    <div className="chat-welcome-icon" style={{ background: theme.assistantAvatarGradient }}>
      {iconSvg}
    </div>
  );
}

/**
 * Get built-in icon SVG
 */
function getBuiltInIcon(iconType?: string) {
  switch (iconType) {
    case 'sparkles':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M9.5 2L8.5 6.5L4 5.5L5 10L0.5 11L5 12L4 16.5L8.5 15.5L9.5 20L10.5 15.5L15 16.5L14 12L18.5 11L14 10L15 5.5L10.5 6.5L9.5 2Z"/>
          <path d="M19 8L18.5 10L17 9.5L17.5 11L16 11.5L17.5 12L17 13.5L18.5 13L19 15L19.5 13L21 13.5L20.5 12L22 11.5L20.5 11L21 9.5L19.5 10L19 8Z"/>
        </svg>
      );
    case 'brain':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C7.03 2 3 6.03 3 11c0 2.83 1.32 5.35 3.38 7h-.01C7.36 19.13 9.56 20 12 20s4.64-.87 5.63-2c2.05-1.65 3.37-4.17 3.37-7 0-4.97-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7zm-1.5-5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
        </svg>
      );
    case 'globe':
    default:
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
      );
  }
}

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
  onSendMessage: (content: string, attachments?: Attachment[]) => void;
  onClearHistory: () => void;
  onCancel: () => void;
  onCopyCode: (code: string) => void;
  onInsertCode: (code: string, language?: string) => void;
  onSelectEnv: (envId: string) => void;
  onSignIn: () => void;
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
  onSignIn,
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
      {/* Header with environment selector and new chat button */}
      <div className="chat-header">
        <EnvironmentSelector
          currentEnv={currentEnv}
          environments={environments}
          onSelectEnv={onSelectEnv}
          isConnected={isConnected}
        />
        
        {/* New chat button - moved from input area */}
        {messages.length > 0 && !isLoading && (
          <button 
            className={clsx('chat-header-button', { 'confirm': showClearConfirm })}
            onClick={handleClear}
            title={showClearConfirm ? "Click again to confirm" : "New chat"}
          >
            {showClearConfirm ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {!isConnected ? (
          /* Sign-in screen when not connected */
          <div className="chat-welcome chat-signin">
            <div className="chat-welcome-header">
              {renderWelcomeLogo(branding.theme)}
              <h2>{branding.welcomeTitle}</h2>
            </div>
            
            <p className="chat-signin-message">
              Sign in to start using {branding.shortName || 'work.studio'}
            </p>
            
            <button className="chat-signin-button" onClick={onSignIn}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Sign in with {branding.shortName || 'work.studio'}
            </button>
            
            <div className="chat-suggestions chat-suggestions-disabled">
              {branding.suggestions.map((suggestion, index) => (
                <div key={index} className="chat-suggestion disabled">
                  <span className="chat-suggestion-icon">{suggestion.icon}</span>
                  <span className="chat-suggestion-text">{suggestion.text}</span>
                </div>
              ))}
            </div>
            
            <p className="chat-welcome-hint">
              Sign in to access AI-powered assistance
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="chat-welcome-header">
              {renderWelcomeLogo(branding.theme)}
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
            {messages.map((message, index) => {
              // Check if this is the actively streaming message
              // (last assistant message while thinking is active)
              const isLastAssistant = index === messages.length - 1 && message.role === 'assistant';
              const isStreaming = isLoading && thinking !== null && isLastAssistant;
              
              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onCopyCode={onCopyCode}
                  onInsertCode={onInsertCode}
                  isStreaming={isStreaming}
                />
              );
            })}
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
        isLoading={isLoading}
        disabled={isLoading || !isConnected}
      />
    </div>
  );
}
