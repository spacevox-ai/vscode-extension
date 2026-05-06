/**
 * Branding Service
 * 
 * Manages brand configuration for white-labeling the extension.
 * 
 * Configuration priority (highest to lowest):
 * 1. Server-side tenant config (fetched from API)
 * 2. VS Code user/workspace settings (workStudio.brand.*)
 * 3. Build-time brand.config.json (baked into extension)
 * 4. Default configuration (hardcoded)
 */

import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { 
  BrandConfig, 
  BrandSuggestion, 
  BrandTheme, 
  BrandFeatures,
  DEFAULT_BRAND_CONFIG 
} from './BrandConfig';

/**
 * Partial brand config for overrides
 */
type PartialBrandConfig = Partial<{
  [K in keyof BrandConfig]: BrandConfig[K] extends object 
    ? Partial<BrandConfig[K]> 
    : BrandConfig[K];
}>;

/**
 * Service for managing extension branding/white-labeling
 */
export class BrandingService {
  private static instance: BrandingService;
  private config: BrandConfig;
  private initialized: boolean = false;
  private onConfigChangeEmitter = new vscode.EventEmitter<BrandConfig>();
  
  /**
   * Event fired when brand configuration changes
   */
  public readonly onConfigChange = this.onConfigChangeEmitter.event;

  private constructor() {
    this.config = { ...DEFAULT_BRAND_CONFIG };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): BrandingService {
    if (!BrandingService.instance) {
      BrandingService.instance = new BrandingService();
    }
    return BrandingService.instance;
  }

  /**
   * Initialize the branding service
   * Should be called during extension activation
   */
  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    if (this.initialized) {
      return;
    }

    Logger.info('Initializing BrandingService...');

    // 1. Start with defaults
    this.config = { ...DEFAULT_BRAND_CONFIG };

    // 2. Load build-time config (brand.config.json)
    await this.loadBuildTimeConfig(context);

    // 3. Apply VS Code settings overrides
    this.applySettingsOverrides();

    // 4. Listen for settings changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('workStudio.brand')) {
          this.applySettingsOverrides();
          this.onConfigChangeEmitter.fire(this.config);
        }
      })
    );

    this.initialized = true;
    Logger.info(`BrandingService initialized: ${this.config.name}`);
  }

  /**
   * Load configuration from build-time brand.config.json
   */
  private async loadBuildTimeConfig(context: vscode.ExtensionContext): Promise<void> {
    try {
      const configPath = vscode.Uri.joinPath(context.extensionUri, 'brand.config.json');
      const configData = await vscode.workspace.fs.readFile(configPath);
      const buildTimeConfig: PartialBrandConfig = JSON.parse(configData.toString());
      this.mergeConfig(buildTimeConfig);
      Logger.debug('Loaded build-time brand config');
    } catch (error) {
      // No custom brand.config.json - use defaults
      Logger.debug('No build-time brand.config.json found, using defaults');
    }
  }

  /**
   * Apply VS Code settings overrides (workStudio.brand.*)
   */
  private applySettingsOverrides(): void {
    const settings = vscode.workspace.getConfiguration('workStudio.brand');

    const overrides: PartialBrandConfig = {};

    // Identity
    if (settings.has('name')) overrides.name = settings.get('name');
    if (settings.has('shortName')) overrides.shortName = settings.get('shortName');
    if (settings.has('displayName')) overrides.displayName = settings.get('displayName');

    // Theme
    if (settings.has('accentColor') || settings.has('avatarGradient')) {
      overrides.theme = {
        accentColor: settings.get('accentColor') || this.config.theme.accentColor,
        assistantAvatarGradient: settings.get('avatarGradient') || this.config.theme.assistantAvatarGradient,
      };
    }

    // Copy
    if (settings.has('welcomeTitle')) overrides.welcomeTitle = settings.get('welcomeTitle');
    if (settings.has('welcomeHint')) overrides.welcomeHint = settings.get('welcomeHint');
    if (settings.has('statusBarText')) overrides.statusBarText = settings.get('statusBarText');
    
    // Suggestions (JSON array in settings)
    const suggestions = settings.get<BrandSuggestion[]>('suggestions');
    if (suggestions && Array.isArray(suggestions) && suggestions.length > 0) {
      overrides.suggestions = suggestions;
    }

    // Agent
    if (settings.has('defaultAgentId')) overrides.defaultAgentId = settings.get('defaultAgentId');

    this.mergeConfig(overrides);
  }

  /**
   * Fetch and apply tenant-specific branding from server
   * Called after authentication
   */
  public async fetchTenantBranding(
    tenantId: string, 
    accessToken: string,
    accountServiceUrl: string
  ): Promise<void> {
    const brandingUrl = `${accountServiceUrl}/tenants/${tenantId}/customization/extension-branding`;
    console.log(`[work.studio] Fetching branding from: ${brandingUrl}`);
    
    try {
      const response = await fetch(brandingUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'X-SELECTED-TENANT': tenantId,
        },
      });

      console.log(`[work.studio] Branding response status: ${response.status}`);

      if (response.ok && response.status !== 204) {
        const tenantConfig: PartialBrandConfig = await response.json();
        console.log(`[work.studio] Branding config received:`, JSON.stringify(tenantConfig).substring(0, 200));
        this.mergeConfig(tenantConfig);
        this.onConfigChangeEmitter.fire(this.config);
        Logger.info(`Applied tenant branding for ${tenantId}`);
      } else if (response.status === 204) {
        console.log(`[work.studio] No custom branding configured for tenant`);
      } else {
        console.log(`[work.studio] Branding fetch failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error(`[work.studio] Branding fetch error:`, error);
      Logger.debug('No tenant-specific branding available');
    }
  }

  /**
   * Merge partial config into current config
   */
  private mergeConfig(partial: PartialBrandConfig): void {
    // Simple fields
    if (partial.name) this.config.name = partial.name;
    if (partial.shortName) this.config.shortName = partial.shortName;
    if (partial.displayName) this.config.displayName = partial.displayName;
    if (partial.description) this.config.description = partial.description;
    if (partial.welcomeTitle) this.config.welcomeTitle = partial.welcomeTitle;
    if (partial.welcomeHint) this.config.welcomeHint = partial.welcomeHint;
    if (partial.statusBarText) this.config.statusBarText = partial.statusBarText;
    if (partial.defaultAgentId) this.config.defaultAgentId = partial.defaultAgentId;
    if (partial.systemPromptAdditions) this.config.systemPromptAdditions = partial.systemPromptAdditions;
    if (partial.helpUrl) this.config.helpUrl = partial.helpUrl;
    if (partial.privacyUrl) this.config.privacyUrl = partial.privacyUrl;
    if (partial.termsUrl) this.config.termsUrl = partial.termsUrl;

    // Arrays
    if (partial.suggestions && partial.suggestions.length > 0) {
      this.config.suggestions = partial.suggestions as BrandSuggestion[];
    }

    // Nested objects - merge
    if (partial.theme) {
      this.config.theme = { ...this.config.theme, ...partial.theme } as BrandTheme;
    }
    if (partial.auth) {
      this.config.auth = { ...this.config.auth, ...partial.auth };
    }
    if (partial.endpoints) {
      this.config.endpoints = { ...this.config.endpoints, ...partial.endpoints };
    }
    if (partial.features) {
      this.config.features = { ...this.config.features, ...partial.features } as BrandFeatures;
    }
  }

  // ========================================================================
  // Getters for individual config values
  // ========================================================================

  public get name(): string {
    return this.config.name;
  }

  public get shortName(): string {
    return this.config.shortName;
  }

  public get displayName(): string {
    return this.config.displayName;
  }

  public get theme(): BrandTheme {
    return this.config.theme;
  }

  public get welcomeTitle(): string {
    return this.config.welcomeTitle;
  }

  public get welcomeHint(): string {
    return this.config.welcomeHint;
  }

  public get suggestions(): BrandSuggestion[] {
    return this.config.suggestions;
  }

  public get statusBarText(): string {
    return this.config.statusBarText;
  }

  public get features(): BrandFeatures {
    return this.config.features;
  }

  public get defaultAgentId(): string | undefined {
    return this.config.defaultAgentId;
  }

  /**
   * Get the full configuration object
   */
  public getConfig(): Readonly<BrandConfig> {
    return this.config;
  }

  /**
   * Get config as JSON for sending to webview
   */
  public getWebviewConfig(): object {
    return {
      name: this.config.name,
      shortName: this.config.shortName,
      theme: this.config.theme,
      welcomeTitle: this.config.welcomeTitle,
      welcomeHint: this.config.welcomeHint,
      suggestions: this.config.suggestions,
      helpUrl: this.config.helpUrl,
      features: {
        enableTools: this.config.features.enableTools,
      },
    };
  }

  /**
   * Check if a tool is allowed by brand configuration
   */
  public isToolAllowed(toolName: string): boolean {
    const { allowedTools, blockedTools } = this.config.features;
    
    // If allowedTools is set, tool must be in the list
    if (allowedTools && allowedTools.length > 0) {
      return allowedTools.includes(toolName);
    }
    
    // If blockedTools is set, tool must not be in the list
    if (blockedTools && blockedTools.length > 0) {
      return !blockedTools.includes(toolName);
    }
    
    return true;
  }
}

// Export singleton getter for convenience
export function getBranding(): BrandingService {
  return BrandingService.getInstance();
}
