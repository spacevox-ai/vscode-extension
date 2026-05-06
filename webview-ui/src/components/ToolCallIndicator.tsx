/**
 * Tool Call Indicator Component
 * 
 * Shows active/running tool call.
 */

import { ToolCall } from '../state/chatReducer';

interface ToolCallIndicatorProps {
  toolCall: ToolCall;
}

export function ToolCallIndicator({ toolCall }: ToolCallIndicatorProps) {
  return (
    <div className="tool-call-indicator">
      <div className="tool-call-indicator-spinner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" opacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="1s"
              repeatCount="indefinite"
            />
          </path>
        </svg>
      </div>
      <div className="tool-call-indicator-content">
        <span className="tool-call-indicator-label">Running tool:</span>
        <span className="tool-call-indicator-name">{toolCall.name}</span>
      </div>
    </div>
  );
}
