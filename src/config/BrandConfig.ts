/**
 * Brand Configuration Types
 * 
 * Defines the structure for white-labeling the extension.
 * Enterprises can customize appearance, copy, and behavior.
 */

/**
 * Suggestion button for the welcome screen
 */
export interface BrandSuggestion {
  icon: string;
  text: string;
  action: string;
}

/**
 * Auth provider configuration
 */
export interface BrandAuthConfig {
  provider: 'keycloak' | 'azure-ad' | 'okta' | 'custom';
  clientId: string;
  realm?: string;
  issuerUrl?: string;
  scopes?: string;
}

/**
 * Visual theme configuration
 */
export interface BrandTheme {
  accentColor: string;
  assistantAvatarGradient: string;
  assistantAvatarIcon?: 'globe' | 'sparkles' | 'brain' | 'custom';
  customAvatarSvg?: string;
}

/**
 * Endpoint configuration
 */
export interface BrandEndpoints {
  aiRuntime: string;
  accountService: string;
  websocket?: string;
}

/**
 * Feature flags
 */
export interface BrandFeatures {
  enableCompletion: boolean;
  enableChat: boolean;
  enableTools: boolean;
  enableTelemetry: boolean;
  allowedTools?: string[];  // Restrict to specific tools
  blockedTools?: string[];  // Block specific tools
}

/**
 * Complete brand configuration
 */
export interface BrandConfig {
  // Identity
  name: string;           // Full name: "work.studio AI"
  shortName: string;      // Short name: "work.studio"
  displayName: string;    // VS Code display: "work.studio AI"
  description: string;    // Extension description
  
  // Visual
  theme: BrandTheme;
  
  // Copy / UX
  welcomeTitle: string;
  welcomeHint: string;
  suggestions: BrandSuggestion[];
  statusBarText: string;
  
  // Auth
  auth: BrandAuthConfig;
  
  // Endpoints (optional - can use VS Code settings)
  endpoints?: BrandEndpoints;
  
  // Features
  features: BrandFeatures;
  
  // Agent
  defaultAgentId?: string;
  systemPromptAdditions?: string;
  
  // Links
  helpUrl?: string;
  privacyUrl?: string;
  termsUrl?: string;
}

/**
 * Default work.studio brand configuration
 */
export const DEFAULT_BRAND_CONFIG: BrandConfig = {
  // Identity
  name: 'work.studio AI',
  shortName: 'work.studio',
  displayName: 'work.studio AI',
  description: 'AI-powered code completion, chat, and governance for enterprise teams',
  
  // Visual
  theme: {
    accentColor: '#6366f1',
    assistantAvatarGradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    assistantAvatarIcon: 'globe',
  },
  
  // Copy / UX
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
  statusBarText: 'work.studio',
  
  // Auth
  auth: {
    provider: 'keycloak',
    clientId: 'vscode-extension',
    realm: 'integration_platform',
    scopes: 'openid profile email organization',
  },
  
  // Features
  features: {
    enableCompletion: true,
    enableChat: true,
    enableTools: true,
    enableTelemetry: true,
  },
  
  // Links
  helpUrl: 'https://docs.work.studio',
  privacyUrl: 'https://work.studio/privacy',
  termsUrl: 'https://work.studio/terms',
};
