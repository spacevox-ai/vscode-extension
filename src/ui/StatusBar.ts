/**
 * Status Bar Manager
 * 
 * Manages the work.studio status bar item in VS Code.
 * Uses "W" branding with clear connected/disconnected states.
 */

import * as vscode from 'vscode';
import { getBranding } from '../config/BrandingService';
import { Logger } from '../utils/Logger';

type StatusType = 'connected' | 'connecting' | 'disconnected' | 'error' | 'inactive';

// Use W with status indicator for clearer UX
const STATUS_TEXT: Record<StatusType, string> = {
    connected: '$(pass-filled) W',           // Green checkmark + W = connected
    connecting: '$(sync~spin) W',            // Spinning = connecting
    disconnected: '$(debug-disconnect) W',   // Disconnect icon = disconnected
    error: '$(error) W',                     // Error icon
    inactive: '$(key) W'                     // Key icon = needs sign in
};

// Tooltip text for each status
const STATUS_TOOLTIPS: Record<StatusType, string> = {
    connected: 'work.studio: Connected',
    connecting: 'work.studio: Connecting...',
    disconnected: 'work.studio: Disconnected - Click to reconnect',
    error: 'work.studio: Error - Click for details',
    inactive: 'work.studio: Click to sign in'
};

// Background colors for better visibility
const STATUS_BACKGROUNDS: Record<StatusType, vscode.ThemeColor | undefined> = {
    connected: undefined,  // No background when connected (cleaner look)
    connecting: undefined,
    disconnected: new vscode.ThemeColor('statusBarItem.warningBackground'),
    error: new vscode.ThemeColor('statusBarItem.errorBackground'),
    inactive: undefined
};

const STATUS_COLORS: Record<StatusType, vscode.ThemeColor | undefined> = {
    connected: new vscode.ThemeColor('notificationsInfoIcon.foreground'),  // Blue/info color
    connecting: undefined,
    disconnected: new vscode.ThemeColor('statusBarItem.warningForeground'),
    error: new vscode.ThemeColor('statusBarItem.errorForeground'),
    inactive: new vscode.ThemeColor('descriptionForeground')  // Dimmed when inactive
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
        // Use status-specific text with W branding
        this.statusBarItem.text = STATUS_TEXT[this.currentStatus];
    }

    /**
     * Update the status bar with new status
     */
    setStatus(status: StatusType, tooltip?: string): void {
        Logger.info(`StatusBarManager: setStatus(${status})`);
        this.currentStatus = status;
        
        const color = STATUS_COLORS[status];
        const background = STATUS_BACKGROUNDS[status];
        
        // Use status-specific text (e.g., "$(pass-filled) W" for connected)
        this.statusBarItem.text = STATUS_TEXT[status];
        
        // Use provided tooltip or default status tooltip
        this.statusBarItem.tooltip = tooltip || STATUS_TOOLTIPS[status];
        
        // Apply background color for better visibility
        this.statusBarItem.backgroundColor = background;
        
        // Update foreground color
        this.statusBarItem.color = color;
        
        // For inactive state, make the command open login
        if (status === 'inactive') {
            this.statusBarItem.command = 'workstudio.login';
        } else {
            this.statusBarItem.command = 'workstudio.showStatus';
        }
        
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
