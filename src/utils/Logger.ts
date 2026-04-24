/**
 * Logger Utility
 * 
 * Provides logging functionality with output channel support.
 */

import * as vscode from 'vscode';

class LoggerSingleton {
    private outputChannel: vscode.OutputChannel | null = null;
    private debugMode = false;

    private getChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('work.studio AI');
        }
        return this.outputChannel;
    }

    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
    }

    info(message: string, data?: unknown): void {
        this.log('INFO', message, data);
    }

    warn(message: string, data?: unknown): void {
        this.log('WARN', message, data);
    }

    error(message: string, error?: unknown): void {
        this.log('ERROR', message, error);
        
        // Also log to console for debugging
        if (error instanceof Error) {
            console.error(`[work.studio] ${message}`, error);
        }
    }

    debug(message: string, data?: unknown): void {
        if (this.debugMode) {
            this.log('DEBUG', message, data);
        }
    }

    private log(level: string, message: string, data?: unknown): void {
        const timestamp = new Date().toISOString();
        const channel = this.getChannel();
        
        let logMessage = `[${timestamp}] [${level}] ${message}`;
        
        if (data !== undefined) {
            if (data instanceof Error) {
                logMessage += `\n  ${data.message}`;
                if (data.stack) {
                    logMessage += `\n  ${data.stack}`;
                }
            } else if (typeof data === 'object') {
                try {
                    logMessage += `\n  ${JSON.stringify(data, null, 2)}`;
                } catch {
                    logMessage += `\n  [Object]`;
                }
            } else {
                logMessage += `\n  ${data}`;
            }
        }

        channel.appendLine(logMessage);
    }

    show(): void {
        this.getChannel().show();
    }

    dispose(): void {
        this.outputChannel?.dispose();
    }
}

export const Logger = new LoggerSingleton();
