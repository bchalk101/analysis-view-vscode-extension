/**
 * TypeScript interfaces for the Analysis View Playground extension
 */

export interface AnalysisViewConfig {
  name: string;
  description: string;
  datasetPath: string;
  sqlQuery: string;
  customCSS: string;
  customJS: string;
  selectedModel?: string;
  selectedMcpServer?: string;
  exportedAt?: string;
}

export interface ChartData {
  rows: any[];
  columnNames: string[];
}

export interface PlotlyConfig {
  data: any[];
  layout: any;
  config?: any;
}

export interface ModalState {
  sqlModalOpened: boolean;
  customJSModalOpened: boolean;
  promptModalOpened: boolean;
  tempSqlQuery: string;
  tempCustomJS: string;
  promptDescription: string;
  includeSqlRequest: boolean;
  generatedPrompt: string;
}

export interface ChatProgressStep {
  type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'error';
  timestamp: string;
  content: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: string;
  error?: string;
}

export interface McpServerInfo {
  id: string;
  name: string;
  description?: string;
  toolCount: number;
  tools: string[];
}

export interface WebviewMessage {
  type: 'configUpdate' | 'generate' | 'execute' | 'exportConfig' | 'requestData' | 'getAvailableModels' | 'getAvailableMcpServers' | 'toggleChatProgress' | 'clearChatProgress' | 'clearAll' | 'cancelGeneration';
  config?: Partial<AnalysisViewConfig>;
  description?: string;
  data?: any;
}