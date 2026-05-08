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

// Declare window extension for pre-acquired API
declare global {
  interface Window {
    vscodeApi?: ReturnType<typeof acquireVsCodeApi>;
  }
}

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
    // ONLY use the pre-acquired API from the HTML script - MARKER_V2
    // Do NOT call acquireVsCodeApi() again - it can only be called once
    if (typeof window !== 'undefined' && window.vscodeApi) {
      console.log('USING_PREACQUIRED_API');
      this.vsCodeApi = window.vscodeApi;
    } else {
      console.warn('VS Code API not pre-acquired. Make sure window.vscodeApi is set in HTML.');
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
