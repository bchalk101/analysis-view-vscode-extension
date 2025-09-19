import * as assert from 'assert';
import { CopilotIntegration } from '../CopilotIntegration';
import { extensions } from 'vscode';

suite('CopilotIntegration', () => {
  suiteSetup(async () => {
    const extension = extensions.getExtension('AgenticAnalytics.analysis-view-playground');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
  });

  test('should generate a valid data story using copilot', async function (this: Mocha.Context) {
    this.timeout(300000); // 5 minutes timout because of llm calls
    // Given
    const copilotIntegration = new CopilotIntegration();
    const description = 'Analyze basic data patterns and show simple visualizations';
    const datasetPath = process.env.TEST_DATASET_PATH || 'test/fixtures/sample-data.csv';
    // When
    const result = await copilotIntegration.generateStoryWithLanguageModel(description, datasetPath);
    // Then
    assert.ok(result);
    assert.ok(result.title, 'Story should have a title');
    assert.ok(result.steps.length > 0, 'Story should have at least one step');
    assert.ok(result.steps[0].sqlQuery, 'First step should have SQL query');
    assert.ok(result.steps[0].title, 'First step should have a title');
    assert.strictEqual(result.datasetPath, datasetPath, 'Dataset path should be preserved');
  });
});