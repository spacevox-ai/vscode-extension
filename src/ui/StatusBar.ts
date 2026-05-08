/**
 * Status Bar Manager
 * 
 * Manages the work.studio status bar item in VS Code.
 */

import * as vscode from 'vscode';
import { getBranding } from '../config/BrandingService';
import { Logger } from '../utils/Logger';

type StatusType = 'connected' | 'connecting' | 'disconnected' | 'error' | 'inactive';

const STATUS_ICONS: Record<StatusType, string> = {
    connected: '$(check)',
    connecting: '$(sync~spin)',
    disconnected: '$(circle-slash)',
    error: '$(error)',
    inactive: '$(circle-outline)'
};

// Background colors for better visibility
const STATUS_BACKGROUNDS: Record<StatusType, vscode.ThemeColor | undefined> = {
    connected: new vscode.ThemeColor('statusBarItem.prominentBackground'),
    connecting: undefined,
    disconnected: new vscode.ThemeColor('statusBarItem.warningBackground'),
    error: new vscode.ThemeColor('statusBarItem.errorBackground'),
    inactive: undefined
};

const STATUS_COLORS: Record<StatusType, vscode.ThemeColor | undefined> = {
    connected: new vscode.ThemeColor('statusBarItem.prominentForeground'),
    connecting: undefined,
    disconnected: new vscode.ThemeColor('statusBarItem.warningForeground'),
    error: new vscode.ThemeColor('statusBarItem.errorForeground'),
    inactive: new vscode.ThemeColor('descriptionForeground')
};

export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private currentStatus: StatusType = 'inactive';
    private brandingDisposable: vscode.Disposable;

    constructor() {
        Logger.info('StatusBarManager: Creating status bar item');
        // Use 'window' scope for id to ensure it's always visible
        // Priority: Lower number = further right. -100 puts it near the bell/notification icons
        this.statusBarItem = vscode.window.createStatusBarItem(
            'workstudio.statusBar',  // ID for the status bar item
            vscode.StatusBarAlignment.Right,
            -100  // Low priority = far right (near notification bell)
        );
        this.statusBarItem.name = 'work.studio Status';
        this.statusBarItem.command = 'workstudio.showStatus';
        this.statusBarItem.accessibilityInformation = {
            label: 'work.studio AI Status',
            role: 'button'
        };
        this.statusBarItem.show();
        Logger.info('StatusBarManager: Status bar item created and shown');
        this.setStatus('inactive', `${this.getBrandName()}: Not signed in`);
        
        // Listen for branding changes
        this.brandingDisposable = getBranding().onConfigChange(() => {
            this.refreshText();
        });
    }

    /**
     * Get the brand name from branding service
     */
    private getBrandName(): string {
        return getBranding().statusBarText;
    }

    /**
     * Refresh the status bar text with current branding
     */
    private refreshText(): void {
        const icon = STATUS_ICONS[this.currentStatus];
        this.statusBarItem.text = `${icon} ${this.getBrandName()}`;
    }

    /**
     * Update the status bar with new status
     */
    setStatus(status: StatusType, tooltip: string): void {
        Logger.info(`StatusBarManager: setStatus(${status}, "${tooltip}")`);
        this.currentStatus = status;
        
        const icon = STATUS_ICONS[status];
        const color = STATUS_COLORS[status];
        const background = STATUS_BACKGROUNDS[status];
        
        this.statusBarItem.text = `${icon} ${this.getBrandName()}`;
        this.statusBarItem.tooltip = tooltip;
        
        // Apply background color for better visibility
        this.statusBarItem.backgroundColor = background;
        
        // Update foreground color
        this.statusBarItem.color = color;
        Logger.info(`StatusBarManager: text="${this.statusBarItem.text}"`);
    }

    /**
     * Get current status
     */
    getStatus(): StatusType {
        return this.currentStatus;
    }

    /**
     * Dispose of the status bar item
     */
    dispose(): void {
        this.brandingDisposable.dispose();
        this.statusBarItem.dispose();
    }
}
