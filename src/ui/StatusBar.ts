/**
 * Status Bar Manager
 * 
 * Manages the work.studio status bar item in VS Code.
 */

import * as vscode from 'vscode';

type StatusType = 'connected' | 'connecting' | 'disconnected' | 'error' | 'inactive';

const STATUS_ICONS: Record<StatusType, string> = {
    connected: '$(check)',
    connecting: '$(sync~spin)',
    disconnected: '$(circle-slash)',
    error: '$(error)',
    inactive: '$(circle-outline)'
};

const STATUS_COLORS: Record<StatusType, vscode.ThemeColor | undefined> = {
    connected: new vscode.ThemeColor('statusBarItem.prominentForeground'),
    connecting: undefined,
    disconnected: new vscode.ThemeColor('statusBarItem.warningForeground'),
    error: new vscode.ThemeColor('statusBarItem.errorForeground'),
    inactive: undefined
};

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private currentStatus: StatusType = 'inactive';

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'workstudio.showStatus';
        this.statusBarItem.show();
        this.setStatus('inactive', 'work.studio: Not signed in');
    }

    /**
     * Update the status bar with new status
     */
    setStatus(status: StatusType, tooltip: string): void {
        this.currentStatus = status;
        
        const icon = STATUS_ICONS[status];
        const color = STATUS_COLORS[status];
        
        this.statusBarItem.text = `${icon} work.studio`;
        this.statusBarItem.tooltip = tooltip;
        this.statusBarItem.backgroundColor = status === 'error' 
            ? new vscode.ThemeColor('statusBarItem.errorBackground')
            : undefined;
        
        // Update color
        if (color) {
            this.statusBarItem.color = color;
        } else {
            this.statusBarItem.color = undefined;
        }
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
        this.statusBarItem.dispose();
    }
}
