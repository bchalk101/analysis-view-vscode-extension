import * as vscode from 'vscode';

export class ErrorReportingService {
    private static readonly ERROR_LOG_CHANNEL = 'Analysis View Playground';
    private static outputChannel: vscode.OutputChannel;

    static initialize(context: vscode.ExtensionContext): void {
        this.outputChannel = vscode.window.createOutputChannel(this.ERROR_LOG_CHANNEL);
        context.subscriptions.push(this.outputChannel);
    }

    static logError(error: Error, context?: string): void {
        const timestamp = new Date().toISOString();
        const contextStr = context ? ` [${context}]` : '';
        const message = `${timestamp}${contextStr}: ${error.message}\n${error.stack}\n`;
        
        this.outputChannel.appendLine(message);
        console.error(`Analysis View Playground${contextStr}:`, error);
    }

    static logWarning(message: string, context?: string): void {
        const timestamp = new Date().toISOString();
        const contextStr = context ? ` [${context}]` : '';
        const logMessage = `${timestamp}${contextStr}: WARNING - ${message}`;
        
        this.outputChannel.appendLine(logMessage);
        console.warn(`Analysis View Playground${contextStr}:`, message);
    }

    static logInfo(message: string, context?: string): void {
        const timestamp = new Date().toISOString();
        const contextStr = context ? ` [${context}]` : '';
        const logMessage = `${timestamp}${contextStr}: ${message}`;
        
        this.outputChannel.appendLine(logMessage);
        console.log(`Analysis View Playground${contextStr}:`, message);
    }

    static showOutput(): void {
        this.outputChannel.show();
    }
}

export class PerformanceMonitor {
    private static timers: Map<string, number> = new Map();

    static startTimer(operationName: string): void {
        this.timers.set(operationName, Date.now());
    }

    static endTimer(operationName: string): number {
        const startTime = this.timers.get(operationName);
        if (!startTime) {
            ErrorReportingService.logWarning(`Timer '${operationName}' was not started`);
            return 0;
        }

        const duration = Date.now() - startTime;
        this.timers.delete(operationName);
        
        ErrorReportingService.logInfo(`Operation '${operationName}' completed in ${duration}ms`, 'Performance');
        
        if (duration > 1000) {
            ErrorReportingService.logWarning(`Operation '${operationName}' took ${duration}ms - consider optimization`, 'Performance');
        }

        return duration;
    }

    static measureAsync<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
        this.startTimer(operationName);
        return operation().finally(() => {
            this.endTimer(operationName);
        });
    }
}
