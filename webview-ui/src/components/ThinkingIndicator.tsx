/**
 * Thinking Indicator Component
 * 
 * Shows AI thinking/reasoning process.
 * When isActive=true, shows "Thinking..." with animation.
 * When isActive=false (persisted), shows "Thought process" as collapsed by default.
 */

import { useState } from 'react';
import clsx from 'clsx';

interface ThinkingIndicatorProps {
  content: string;
  isActive?: boolean;  // Whether thinking is still in progress
}

export function ThinkingIndicator({ content, isActive = true }: ThinkingIndicatorProps) {
  // Active thinking starts expanded, persisted starts collapsed
  const [expanded, setExpanded] = useState(isActive);

  // Truncate for collapsed view
  const truncatedContent = content.length > 150 
    ? content.slice(0, 150) + '...' 
    : content;

  return (
    <div className={clsx('thinking-indicator', { 
      'expanded': expanded,
      'thinking-active': isActive,
      'thinking-persisted': !isActive
    })}>
      <div className="thinking-header" onClick={() => setExpanded(!expanded)}>
        <div className="thinking-icon">
          {isActive ? (
            // Animated thinking icon
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          ) : (
            // Static brain/thought icon
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          )}
        </div>
        <span className="thinking-label">
          {isActive ? 'Thinking...' : 'Thought process'}
        </span>
        <button className="thinking-toggle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {expanded ? (
              <polyline points="18 15 12 9 6 15" />
            ) : (
              <polyline points="6 9 12 15 18 9" />
            )}
          </svg>
        </button>
      </div>
      
      <div className="thinking-content">
        <pre>{expanded ? content : truncatedContent}</pre>
      </div>
    </div>
  );
}
