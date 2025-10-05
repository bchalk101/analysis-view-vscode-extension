import * as vscode from 'vscode';

export interface Dataset {
    id: string;
    name: string;
    description: string;
    category: string;
    file_path: string;
    format: string;
    size_bytes: number;
    row_count: number;
    tags: string[];
}

export interface QueryResult {
    rows: any[][];
    column_names: string[];
    total_rows: number;
    execution_time_ms: number;
}

export class McpClient {
    private serverUrl: string;

    constructor() {
        const config = vscode.workspace.getConfiguration('analysisViewPlayground');
        this.serverUrl = config.get('analyticsMcpUrl', 'https://analysis-mcp-server-268402011423.us-central1.run.app');
    }

    async start(): Promise<void> {
        return;
    }

    async stop(): Promise<void> {
        return;
    }

    async listDatasets(): Promise<Dataset[]> {
        const response = await this.callTool('list_datasets', {});
        return JSON.parse(response);
    }

    async executeQuery(datasetId: string, sqlQuery: string, limit?: number): Promise<QueryResult> {
        const response = await this.callTool('execute_query', {
            dataset_id: datasetId,
            sql_query: sqlQuery,
            limit
        });
        return JSON.parse(response);
    }

    private async callTool(toolName: string, params: any): Promise<string> {
        const response = await fetch(`${this.serverUrl}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: params
                }
            })
        });

        if (!response.ok) {
            throw new Error(`MCP Server error: ${response.statusText}`);
        }

        const text = await response.text();

        if (text.includes('event: message')) {
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('data: ')) {
                    const jsonData = line.trim().substring(6);
                    const result = JSON.parse(jsonData);
                    return result.result.content[0].text;
                }
            }
        }

        const result = JSON.parse(text);
        return result.result.content[0].text;
    }
}