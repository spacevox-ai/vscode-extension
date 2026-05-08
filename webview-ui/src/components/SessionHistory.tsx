/**
 * Session History Component
 * 
 * Shows a list of user's previous chat sessions with the ability
 * to resume a conversation.
 */

import { AISessionInfo } from '../types/session';
import './SessionHistory.css';

interface SessionHistoryProps {
  sessions: AISessionInfo[];
  isLoading: boolean;
  error?: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onRefresh: () => void;
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getSessionTitle(session: AISessionInfo): string {
  if (session.title) return session.title;
  if (session.artifactName) return session.artifactName;
  if (session.sessionContext) return session.sessionContext.replace(/_/g, ' ');
  return 'Chat session';
}

function getSessionIcon(session: AISessionInfo): string {
  switch (session.sessionContext) {
    case 'CONVERSATION': return '💬';
    case 'WORKFLOW_RUN': return '⚡';
    case 'VOICE_CALL': return '🎙️';
    case 'WIDGET': return '🔲';
    case 'STUDIO_TEST': return '🧪';
    case 'API_CALL': return '🔌';
    case 'DESIGN_SESSION': return '🎨';
    default: return '💬';
  }
}

export function SessionHistory({
  sessions,
  isLoading,
  error,
  isOpen,
  onClose,
  onSelectSession,
  onRefresh,
}: SessionHistoryProps) {
  if (!isOpen) return null;

  return (
    <div className="session-history-overlay" onClick={onClose}>
      <div className="session-history-panel" onClick={e => e.stopPropagation()}>
        <div className="session-history-header">
          <h3>Session History</h3>
          <div className="session-history-actions">
            <button 
              className="icon-button" 
              onClick={onRefresh}
              title="Refresh"
              disabled={isLoading}
            >
              🔄
            </button>
            <button className="icon-button" onClick={onClose} title="Close">
              ✕
            </button>
          </div>
        </div>
        
        <div className="session-history-content">
          {isLoading && (
            <div className="session-history-loading">
              <span className="spinner"></span>
              Loading sessions...
            </div>
          )}
          
          {error && (
            <div className="session-history-error">
              {error}
            </div>
          )}
          
          {!isLoading && !error && sessions.length === 0 && (
            <div className="session-history-empty">
              No previous sessions found.
              <br />
              Start a conversation to create one!
            </div>
          )}
          
          {!isLoading && sessions.length > 0 && (
            <ul className="session-list">
              {sessions.map((session) => (
                <li 
                  key={session.id} 
                  className="session-item"
                  onClick={() => onSelectSession(session.id)}
                >
                  <span className="session-icon">{getSessionIcon(session)}</span>
                  <div className="session-info">
                    <div className="session-title">{getSessionTitle(session)}</div>
                    <div className="session-meta">
                      {session.messageCount && (
                        <span>{session.messageCount} messages</span>
                      )}
                      {session.lastMessageAt && (
                        <span className="session-time">
                          {formatRelativeTime(session.lastMessageAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="session-arrow">›</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
