/**
 * Chat Input Component
 * 
 * Text input with Copilot-style UX.
 * Supports:
 * - Multi-line input with auto-resize
 * - Ctrl+V paste for images
 * - Attachment preview and removal
 */

import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent, DragEvent } from 'react';
import clsx from 'clsx';

export interface Attachment {
  id: string;
  type: 'image';
  data: string; // base64 data URL
  name: string;
  size: number;
}

interface ChatInputProps {
  onSendMessage: (content: string, attachments?: Attachment[]) => void;
  onCancel: () => void;
  isLoading: boolean;
  disabled?: boolean;
}

export function ChatInput({ 
  onSendMessage, 
  onCancel, 
  isLoading, 
  disabled,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if ((!input.trim() && attachments.length === 0) || disabled || isLoading) return;
    
    onSendMessage(input.trim(), attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
    
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

  // Handle paste - check for images
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          processImageFile(file);
        }
        return;
      }
    }
  };

  // Handle drag and drop
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        processImageFile(file);
      }
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Process image file to base64
  const processImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const attachment: Attachment = {
        id: `attach_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'image',
        data: dataUrl,
        name: file.name,
        size: file.size,
      };
      setAttachments(prev => [...prev, attachment]);
    };
    reader.readAsDataURL(file);
  };

  // Handle file input change (for attach button)
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        processImageFile(file);
      }
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // Remove attachment
  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !disabled && !isLoading;

  return (
    <div 
      className="chat-input-container"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="chat-attachments">
          {attachments.map(attachment => (
            <div key={attachment.id} className="chat-attachment">
              <img 
                src={attachment.data} 
                alt={attachment.name}
                className="chat-attachment-preview"
              />
              <div className="chat-attachment-info">
                <span className="chat-attachment-name">{attachment.name}</span>
                <span className="chat-attachment-size">{formatSize(attachment.size)}</span>
              </div>
              <button 
                className="chat-attachment-remove"
                onClick={() => removeAttachment(attachment.id)}
                title="Remove attachment"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={clsx('chat-input-wrapper', { 'is-loading': isLoading })}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {/* Attach button */}
        <button 
          className="chat-input-button attach"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading || disabled}
          title="Attach image (or paste with Ctrl+V)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={isLoading ? "Generating..." : "Ask anything..."}
          disabled={disabled}
          rows={1}
        />
        
        <div className="chat-input-actions">
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
              className={clsx('chat-input-button send', { 'active': canSend })}
              onClick={handleSubmit}
              disabled={!canSend}
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
