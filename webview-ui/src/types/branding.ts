/**
 * Branding Types for Webview
 * 
 * These types mirror the server-side BrandConfig but only include
 * fields relevant to the webview rendering.
 */

export interface BrandSuggestion {
  icon: string;
  text: string;
  action: string;
}

export interface BrandTheme {
  accentColor: string;
  assistantAvatarGradient: string;
  assistantAvatarIcon?: 'globe' | 'sparkles' | 'brain' | 'custom';
  customAvatarSvg?: string;
  /** Full logo image URL (PNG, SVG, etc.) */
  logoUrl?: string;
  /** Inline SVG for logo (alternative to logoUrl) */
  logoSvg?: string;
}

export interface WebviewBranding {
  name: string;
  shortName: string;
  theme: BrandTheme;
  welcomeTitle: string;
  welcomeHint: string;
  suggestions: BrandSuggestion[];
  helpUrl?: string;
  features: {
    enableTools: boolean;
  };
}

/**
 * Default branding (matches work.studio defaults)
 */
export const DEFAULT_BRANDING: WebviewBranding = {
  name: 'work.studio AI',
  shortName: 'work.studio',
  theme: {
    accentColor: '#6366f1',
    assistantAvatarGradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    assistantAvatarIcon: 'globe',
  },
  welcomeTitle: 'How can I help you?',
  welcomeHint: 'Ask me anything about your code, or use @ to reference files',
  suggestions: [
    { icon: '💡', text: 'Explain this code', action: 'Explain the selected code' },
    { icon: '🐛', text: 'Fix this error', action: 'Help me fix this error' },
    { icon: '✨', text: 'Improve this code', action: 'Suggest improvements for this code' },
    { icon: '📝', text: 'Add documentation', action: 'Add documentation comments' },
    { icon: '🧪', text: 'Write tests', action: 'Write unit tests for this code' },
    { icon: '🔄', text: 'Refactor', action: 'Refactor this code to be cleaner' },
  ],
  helpUrl: 'https://docs.work.studio',
  features: {
    enableTools: true,
  },
};
