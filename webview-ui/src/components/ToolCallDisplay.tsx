/**
 * Tool Call Display Component
 * 
 * Shows a completed tool call with result.
 */

import { useState } from 'react';
import { ToolCall } from '../state/chatReducer';
import clsx from 'clsx';

interface ToolCallDisplayProps {
  toolCall: ToolCall;
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: '⏳',
    running: '🔄',
    completed: '✅',
    error: '❌',
  }[toolCall.status];

  const statusClass = {
    pending: 'pending',
    running: 'running',
    completed: 'completed',
    error: 'error',
  }[toolCall.status];

  return (
    <div className={clsx('tool-call', `tool-call-${statusClass}`)}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-icon">{statusIcon}</span>
        <span className="tool-call-name">{toolCall.name}</span>
        <span className="tool-call-status">{toolCall.status}</span>
        {toolCall.result && (
          <span className="tool-call-duration">
            {toolCall.result.durationMs}ms
          </span>
        )}
        <button className="tool-call-toggle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {expanded ? (
              <polyline points="18 15 12 9 6 15" />
            ) : (
              <polyline points="6 9 12 15 18 9" />
            )}
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="tool-call-details">
          {/* Arguments */}
          <div className="tool-call-section">
            <div className="tool-call-section-title">Arguments</div>
            <pre className="tool-call-code">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>

          {/* Result */}
          {toolCall.result && (
            <div className="tool-call-section">
              <div className="tool-call-section-title">
                Result {toolCall.result.success ? '(Success)' : '(Error)'}
              </div>
              <pre className="tool-call-code">
                {toolCall.result.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
