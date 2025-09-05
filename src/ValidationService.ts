import * as vscode from 'vscode';
import { AnalysisViewConfig } from './types';

export class ValidationService {
    /**
     * Validate SQL query syntax and structure
     */
    static validateSQL(sqlQuery: string): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (!sqlQuery.trim()) {
            errors.push('SQL query cannot be empty');
            return { isValid: false, errors };
        }

        const trimmedQuery = sqlQuery.trim().toLowerCase();
        
        // Basic SQL validation
        if (!trimmedQuery.startsWith('select')) {
            errors.push('Query must start with SELECT statement');
        }

        // Check for potential security issues
        const dangerousPatterns = [
            'drop table',
            'delete from',
            'truncate',
            'create table',
            'alter table',
            'exec',
            'execute',
            'xp_'
        ];

        for (const pattern of dangerousPatterns) {
            if (trimmedQuery.includes(pattern)) {
                errors.push(`Potentially dangerous SQL pattern detected: ${pattern}`);
            }
        }

        // Check for balanced parentheses
        const openParens = (sqlQuery.match(/\(/g) || []).length;
        const closeParens = (sqlQuery.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
            errors.push('Unbalanced parentheses in SQL query');
        }

        return { isValid: errors.length === 0, errors };
    }

    /**
     * Validate JavaScript code for security and syntax issues
     */
    static validateJavaScript(jsCode: string): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        if (!jsCode.trim()) {
            return { isValid: true, errors }; // Empty JS is valid
        }

        // Check for dangerous patterns
        const dangerousPatterns = [
            'eval(',
            'Function(',
            'setTimeout(',
            'setInterval(',
            'document.',
            'window.',
            'global.',
            'process.',
            'require(',
            'import(',
            'fetch(',
            'XMLHttpRequest',
            '__proto__',
            'constructor.prototype'
        ];

        const jsLower = jsCode.toLowerCase();
        for (const pattern of dangerousPatterns) {
            if (jsLower.includes(pattern)) {
                errors.push(`Potentially dangerous JavaScript pattern detected: ${pattern}`);
            }
        }

        // Basic syntax validation
        try {
            // This is a simple check - in production, you might want a proper JS parser
            new Function(jsCode);
        } catch (syntaxError) {
            errors.push(`JavaScript syntax error: ${(syntaxError as Error).message}`);
        }

        // Check if it returns the expected structure
        if (!jsCode.includes('return')) {
            errors.push('JavaScript code should return a Plotly configuration object');
        }

        return { isValid: errors.length === 0, errors };
    }

    /**
     * Validate complete analysis view configuration
     */
    static validateConfiguration(config: AnalysisViewConfig): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Required fields
        if (!config.name?.trim()) {
            errors.push('View name is required');
        }

        if (!config.description?.trim()) {
            errors.push('Description is required for code generation');
        }

        if (!config.sqlQuery?.trim()) {
            errors.push('SQL query is required');
        }

        // Validate SQL if present
        if (config.sqlQuery?.trim()) {
            const sqlValidation = this.validateSQL(config.sqlQuery);
            if (!sqlValidation.isValid) {
                errors.push(...sqlValidation.errors);
            }
        }

        // Validate JavaScript if present
        if (config.customJS?.trim()) {
            const jsValidation = this.validateJavaScript(config.customJS);
            if (!jsValidation.isValid) {
                errors.push(...jsValidation.errors);
            }
        }

        return { isValid: errors.length === 0, errors };
    }

    /**
     * Show validation errors to user
     */
    static showValidationErrors(errors: string[]): void {
        if (errors.length === 0) return;

        const errorMessage = `Configuration validation failed:\n${errors.join('\n')}`;
        vscode.window.showErrorMessage(errorMessage, 'Show Details').then(selection => {
            if (selection === 'Show Details') {
                vscode.window.showInformationMessage(errorMessage, { modal: true });
            }
        });
    }

    /**
     * Sanitize user input
     */
    static sanitizeInput(input: string): string {
        return input
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
            .replace(/javascript:/gi, '') // Remove javascript: protocol
            .replace(/on\w+\s*=/gi, '') // Remove event handlers
            .trim();
    }
}

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
        
        // Warn about slow operations
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
