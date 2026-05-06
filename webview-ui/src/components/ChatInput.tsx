/**
 * Chat Input Component
 * 
 * Text input with Copilot-style UX.
 */

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import clsx from 'clsx';

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  onCancel: () => void;
  onClear: () => void;
  isLoading: boolean;
  disabled?: boolean;
  showClearConfirm?: boolean;
  hasMessages?: boolean;
}

export function ChatInput({ 
  onSendMessage, 
  onCancel, 
  onClear,
  isLoading, 
  disabled,
  showClearConfirm,
  hasMessages,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (!input.trim() || disabled || isLoading) return;
    
    onSendMessage(input.trim());
    setInput('');
    
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    // Escape to cancel
    if (e.key === 'Escape' && isLoading) {
      onCancel();
    }
  };

  return (
    <div className="chat-input-container">
      <div className={clsx('chat-input-wrapper', { 'is-loading': isLoading })}>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isLoading ? "Generating..." : "Ask anything..."}
          disabled={disabled}
          rows={1}
        />
        
        <div className="chat-input-actions">
          {/* Clear button */}
          {hasMessages && !isLoading && (
            <button 
              className={clsx('chat-input-button clear', { 'confirm': showClearConfirm })}
              onClick={onClear}
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
          
          {isLoading ? (
            <button 
              className="chat-input-button stop"
              onClick={onCancel}
              title="Stop generating (Esc)"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              className={clsx('chat-input-button send', {
                'active': input.trim().length > 0,
              })}
              onClick={handleSubmit}
              disabled={!input.trim() || disabled}
              title="Send (Enter)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
