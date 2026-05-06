/**
 * Status Panel Provider
 * 
 * Shows a branded status panel with logo support.
 */

import * as vscode from 'vscode';
import { getBranding } from '../config/BrandingService';

export class StatusPanelProvider {
    private static currentPanel: vscode.WebviewPanel | undefined;

    public static show(
        extensionUri: vscode.Uri,
        isAuthenticated: boolean,
        isCompletionEnabled: boolean
    ): void {
        const column = vscode.ViewColumn.Active;
        const branding = getBranding();

        // If we already have a panel, show it
        if (StatusPanelProvider.currentPanel) {
            StatusPanelProvider.currentPanel.reveal(column);
            StatusPanelProvider.updateContent(isAuthenticated, isCompletionEnabled);
            return;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            'workstudioStatus',
            `${branding.name} Status`,
            column,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
            }
        );

        StatusPanelProvider.currentPanel = panel;
        StatusPanelProvider.updateContent(isAuthenticated, isCompletionEnabled);

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(message => {
            if (message.type === 'close') {
                panel.dispose();
            }
        });

        // Reset when closed
        panel.onDidDispose(() => {
            StatusPanelProvider.currentPanel = undefined;
        });
    }

    private static updateContent(isAuthenticated: boolean, isCompletionEnabled: boolean): void {
        if (!StatusPanelProvider.currentPanel) return;

        const branding = getBranding();
        const theme = branding.theme;
        
        StatusPanelProvider.currentPanel.webview.html = StatusPanelProvider.getHtml(
            branding.name,
            branding.shortName,
            theme.accentColor,
            theme.logoUrl,
            theme.logoSvg,
            theme.assistantAvatarGradient,
            theme.assistantAvatarIcon,
            theme.customAvatarSvg,
            isAuthenticated,
            isCompletionEnabled
        );
    }

    private static getHtml(
        name: string,
        shortName: string,
        accentColor: string,
        logoUrl: string | undefined,
        logoSvg: string | undefined,
        gradient: string,
        avatarIcon: string | undefined,
        customAvatarSvg: string | undefined,
        isAuthenticated: boolean,
        isCompletionEnabled: boolean
    ): string {
        // Determine what to show as logo
        let logoHtml: string;
        if (logoUrl) {
            logoHtml = `<img src="${logoUrl}" alt="${name}" class="logo-image" />`;
        } else if (logoSvg) {
            logoHtml = `<div class="logo-svg">${logoSvg}</div>`;
        } else {
            // Fall back to avatar icon with gradient
            const iconSvg = StatusPanelProvider.getIconSvg(avatarIcon, customAvatarSvg);
            logoHtml = `<div class="logo-avatar" style="background: ${gradient}">${iconSvg}</div>`;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name} Status</title>
    <style>
        :root {
            --accent-color: ${accentColor};
            --gradient: ${gradient};
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-foreground, #cccccc);
            padding: 40px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        
        .status-container {
            max-width: 400px;
            width: 100%;
            text-align: center;
        }
        
        .logo-container {
            margin-bottom: 24px;
        }
        
        .logo-image {
            max-width: 120px;
            max-height: 120px;
            object-fit: contain;
        }
        
        .logo-svg {
            width: 80px;
            height: 80px;
            margin: 0 auto;
        }
        
        .logo-svg svg {
            width: 100%;
            height: 100%;
        }
        
        .logo-avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto;
        }
        
        .logo-avatar svg {
            width: 48px;
            height: 48px;
            fill: white;
        }
        
        h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }
        
        .subtitle {
            font-size: 14px;
            color: var(--vscode-descriptionForeground, #888);
            margin-bottom: 32px;
        }
        
        .status-list {
            list-style: none;
            text-align: left;
            background: var(--vscode-input-background, #3c3c3c);
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 24px;
        }
        
        .status-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid var(--vscode-widget-border, #454545);
        }
        
        .status-item:last-child {
            border-bottom: none;
        }
        
        .status-label {
            font-size: 14px;
            color: var(--vscode-foreground);
        }
        
        .status-value {
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .status-value.success {
            color: #4ade80;
        }
        
        .status-value.warning {
            color: #fbbf24;
        }
        
        .status-value.error {
            color: #f87171;
        }
        
        .status-icon {
            font-size: 16px;
        }
        
        .close-button {
            background: var(--accent-color);
            color: white;
            border: none;
            padding: 10px 32px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        
        .close-button:hover {
            opacity: 0.9;
        }
        
        .version {
            margin-top: 24px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground, #666);
        }
    </style>
</head>
<body>
    <div class="status-container">
        <div class="logo-container">
            ${logoHtml}
        </div>
        
        <h1>${name}</h1>
        <p class="subtitle">AI-Powered Coding Assistant</p>
        
        <ul class="status-list">
            <li class="status-item">
                <span class="status-label">Authentication</span>
                <span class="status-value ${isAuthenticated ? 'success' : 'error'}">
                    <span class="status-icon">${isAuthenticated ? '✓' : '✗'}</span>
                    ${isAuthenticated ? 'Signed In' : 'Not Signed In'}
                </span>
            </li>
            <li class="status-item">
                <span class="status-label">Code Completion</span>
                <span class="status-value ${isCompletionEnabled ? 'success' : 'warning'}">
                    <span class="status-icon">${isCompletionEnabled ? '✓' : '⏸'}</span>
                    ${isCompletionEnabled ? 'Enabled' : 'Disabled'}
                </span>
            </li>
        </ul>
        
        <button class="close-button" onclick="closePanel()">Close</button>
        
        <p class="version">${shortName} Extension v0.1.0</p>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function closePanel() {
            vscode.postMessage({ type: 'close' });
        }
    </script>
</body>
</html>`;
    }

    private static getIconSvg(iconType: string | undefined, customSvg: string | undefined): string {
        if (iconType === 'custom' && customSvg) {
            return customSvg;
        }
        
        switch (iconType) {
            case 'sparkles':
                return `<svg viewBox="0 0 24 24"><path d="M9.5 2L8.5 6.5L4 5.5L5 10L0.5 11L5 12L4 16.5L8.5 15.5L9.5 20L10.5 15.5L15 16.5L14 12L18.5 11L14 10L15 5.5L10.5 6.5L9.5 2Z"/><path d="M19 8L18.5 10L17 9.5L17.5 11L16 11.5L17.5 12L17 13.5L18.5 13L19 15L19.5 13L21 13.5L20.5 12L22 11.5L20.5 11L21 9.5L19.5 10L19 8Z"/></svg>`;
            case 'brain':
                return `<svg viewBox="0 0 24 24"><path d="M12 2C7.03 2 3 6.03 3 11c0 2.83 1.32 5.35 3.38 7h-.01C7.36 19.13 9.56 20 12 20s4.64-.87 5.63-2c2.05-1.65 3.37-4.17 3.37-7 0-4.97-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7zm-1.5-5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>`;
            case 'globe':
            default:
                return `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;
        }
    }

    public static dispose(): void {
        StatusPanelProvider.currentPanel?.dispose();
        StatusPanelProvider.currentPanel = undefined;
    }
}
