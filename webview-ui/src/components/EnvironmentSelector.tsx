/**
 * Environment Selector Component
 * 
 * Shows current environment and allows switching between environments.
 * Displayed as a compact status bar at the top of the chat.
 */

import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';

export interface Environment {
  id: string;
  name: string;
  type?: 'development' | 'staging' | 'production';
}

interface EnvironmentSelectorProps {
  currentEnv: Environment | null;
  environments: Environment[];
  onSelectEnv: (envId: string) => void;
  isConnected: boolean;
}

export function EnvironmentSelector({ 
  currentEnv, 
  environments, 
  onSelectEnv, 
  isConnected 
}: EnvironmentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasMultipleEnvs = environments.length > 1;

  const getEnvIcon = (type?: string) => {
    switch (type) {
      case 'production':
        return '🔴';
      case 'staging':
        return '🟡';
      case 'development':
      default:
        return '🟢';
    }
  };

  const handleSelect = (envId: string) => {
    onSelectEnv(envId);
    setIsOpen(false);
  };

  if (!currentEnv && !isConnected) {
    return (
      <div className="env-selector env-disconnected">
        <div className="env-status-icon disconnected">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <span className="env-status-text">Not connected</span>
      </div>
    );
  }

  return (
    <div className="env-selector" ref={dropdownRef}>
      <button 
        className={clsx('env-selector-button', { 
          'has-dropdown': hasMultipleEnvs,
          'is-open': isOpen 
        })}
        onClick={() => hasMultipleEnvs && setIsOpen(!isOpen)}
        disabled={!hasMultipleEnvs}
      >
        <div className="env-status-icon connected">
          <span className="env-type-icon">{getEnvIcon(currentEnv?.type)}</span>
        </div>
        <span className="env-name">{currentEnv?.name || 'Loading...'}</span>
        {hasMultipleEnvs && (
          <svg className="env-dropdown-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points={isOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
          </svg>
        )}
      </button>

      {isOpen && hasMultipleEnvs && (
        <div className="env-dropdown">
          <div className="env-dropdown-header">Switch Environment</div>
          {environments.map((env) => (
            <button
              key={env.id}
              className={clsx('env-dropdown-item', { 
                'is-current': env.id === currentEnv?.id 
              })}
              onClick={() => handleSelect(env.id)}
            >
              <span className="env-type-icon">{getEnvIcon(env.type)}</span>
              <span className="env-item-name">{env.name}</span>
              {env.id === currentEnv?.id && (
                <svg className="env-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
