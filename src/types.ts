export interface AnalysisViewConfig {
  name: string;
  description: string;
  datasetPath: string;
  sqlQuery: string;
  customJS: string;
  selectedModel?: string;
  selectedMcpServer?: string;
  exportedAt?: string;
  dataSourceType?: string;
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
  promptModalOpened: boolean;
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

export interface ConversationHistory {
  id: string;
  timestamp: string;
  description: string;
  datasetPath: string;
  dataSourceType?: string;
  selectedModel?: string;
  selectedMcpServer?: string;
  story?: DataStory;
  chatProgress?: ChatProgressStep[];
}

export interface CompleteReport {
  metadata: {
    title: string;
    description: string;
    exportedAt: string;
    exportFormat: ExportFormat;
    generatedBy: string;
  };
  configuration: AnalysisViewConfig;
  story?: DataStory;
  chatProgress?: ChatProgressStep[];
}

export type ExportFormat = 'json' | 'html' | 'pdf-ready';

export interface WebviewMessage {
  type: 'webviewReady' | 'configUpdate' | 'generateStory' | 'exportReport' | 'getAvailableModels' | 'getAvailableMcpServers' | 'toggleChatProgress' | 'clearChatProgress' | 'clearAll' | 'cancelGeneration' | 'navigateStory' | 'autoFixVisualization' | 'listDatasets' | 'showConversationHistory' | 'loadConversation' | 'checkMcpAvailability';
  config?: Partial<AnalysisViewConfig>;
  description?: string;
  data?: any;
  exportFormat?: ExportFormat;
  storyNavigation?: {
    direction: 'next' | 'previous' | 'jump';
    stepIndex?: number;
  };
  storyMode?: boolean;
  jsCode?: string;
  error?: string;
  step?: StoryStep;
  chartData?: ChartData;
  dataPreview?: {
    sampleRows: any[];
    rowCount: number;
    columnTypes: Record<string, string>;
  };
  conversationId?: string;
}