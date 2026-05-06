/**
 * VS Code API Utilities
 * 
 * Type-safe wrapper for VS Code webview API.
 */

// Declare VS Code API type
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Message types from extension to webview
export interface MessageFromExtension {
  type: string;
  payload: any;
}

// Message types from webview to extension
export interface MessageToExtension {
  type: string;
  payload?: any;
  requestId?: string;
}

// Singleton VS Code API instance
class VSCodeAPIWrapper {
  private readonly vsCodeApi: ReturnType<typeof acquireVsCodeApi> | undefined;

  constructor() {
    // Check if running in VS Code webview
    if (typeof acquireVsCodeApi === 'function') {
      this.vsCodeApi = acquireVsCodeApi();
    }
  }

  /**
   * Post a message to the extension
   */
  public postMessage(message: MessageToExtension): void {
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message);
    } else {
      // Dev mode - log to console
      console.log('[DEV] postMessage:', message);
    }
  }

  /**
   * Get persisted state
   */
  public getState(): unknown {
    if (this.vsCodeApi) {
      return this.vsCodeApi.getState();
    }
    return undefined;
  }

  /**
   * Persist state
   */
  public setState<T>(state: T): T {
    if (this.vsCodeApi) {
      this.vsCodeApi.setState(state);
    }
    return state;
  }
}

// Export singleton instance
export const vscode = new VSCodeAPIWrapper();
