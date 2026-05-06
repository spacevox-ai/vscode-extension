/**
 * Chat Message Component
 * 
 * Renders a single chat message with Copilot-style formatting.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage as ChatMessageType } from '../state/chatReducer';
import { CodeBlock } from './CodeBlock';
import { ToolCallDisplay } from './ToolCallDisplay';
import { ThinkingIndicator } from './ThinkingIndicator';
import clsx from 'clsx';

interface ChatMessageProps {
  message: ChatMessageType;
  onCopyCode: (code: string) => void;
  onInsertCode: (code: string, language?: string) => void;
}

export function ChatMessage({ message, onCopyCode, onInsertCode }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <div className={clsx('chat-message', {
      'chat-message-user': isUser,
      'chat-message-assistant': isAssistant,
      'chat-message-error': message.error,
    })}>
      {/* Avatar */}
      <div className="chat-message-avatar">
        {isUser ? (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="chat-message-content">
        {/* Message body */}
        <div className="chat-message-body">
          {message.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : undefined;
                  const code = String(children).replace(/\n$/, '');

                  if (!inline && code.includes('\n')) {
                    return (
                      <CodeBlock
                        code={code}
                        language={language}
                        onCopy={() => onCopyCode(code)}
                        onInsert={() => onInsertCode(code, language)}
                      />
                    );
                  }

                  return (
                    <code className={clsx('inline-code', className)} {...props}>
                      {children}
                    </code>
                  );
                },
                // Custom link handling
                a({ href, children }: any) {
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          ) : isAssistant && !message.error ? (
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          ) : null}
        </div>

        {/* Persisted thinking (shown after completion) */}
        {isAssistant && message.thinking && (
          <div className="chat-message-thinking">
            <ThinkingIndicator content={message.thinking} isActive={false} />
          </div>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="chat-message-tools">
            {message.toolCalls.map((toolCall) => (
              <ToolCallDisplay key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}

        {/* Error display */}
        {message.error && (
          <div className="chat-message-error-content">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{message.error}</span>
          </div>
        )}

        {/* Timestamp */}
        <div className="chat-message-time">
          {new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </div>
      </div>
    </div>
  );
}
