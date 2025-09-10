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

export interface StoryStep {
  id: string;
  title: string;
  description: string;
  insight: string;
  sqlQuery: string;
  jsCode: string;
  visualizationType: 'bar' | 'scatter' | 'pie' | 'line' | 'heatmap' | 'histogram' | 'box' | 'treemap';
  order: number;
}

export interface DataStory {
  id: string;
  title: string;
  description: string;
  steps: StoryStep[];
  createdAt: string;
  datasetPath: string;
}

export interface StoryState {
  currentStory?: DataStory;
  currentStepIndex: number;
  isStoryMode: boolean;
}

export interface WebviewMessage {
  type: 'configUpdate' | 'generate' | 'generateStory' | 'execute' | 'exportConfig' | 'requestData' | 'getAvailableModels' | 'getAvailableMcpServers' | 'toggleChatProgress' | 'clearChatProgress' | 'clearAll' | 'cancelGeneration' | 'navigateStory' | 'toggleStoryMode';
  config?: Partial<AnalysisViewConfig>;
  description?: string;
  data?: any;
  storyNavigation?: {
    direction: 'next' | 'previous' | 'jump';
    stepIndex?: number;
  };
  storyMode?: boolean;
}