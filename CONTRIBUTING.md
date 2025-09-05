# Contributing to Analysis View Playground

Thank you for your interest in contributing to the Analysis View Playground VS Code extension! This document provides guidelines for contributing to the project.

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributions from developers of all backgrounds and experience levels.

## Ways to Contribute

### 🐛 Reporting Bugs
- Use the GitHub Issues tab to report bugs
- Include VS Code version, extension version, and steps to reproduce
- Provide error messages and logs when possible

### 💡 Suggesting Features
- Open a GitHub Issue with the "enhancement" label
- Describe the use case and expected behavior
- Consider backward compatibility and user experience

### 🔧 Contributing Code
- Fork the repository
- Create a feature branch (`git checkout -b feature/amazing-feature`)
- Make your changes with clear commit messages
- Add tests if applicable
- Submit a pull request

## Development Setup

### Prerequisites
- VS Code 1.74.0 or higher
- Node.js 16 or higher
- Git

### Local Development
1. **Clone and setup:**
   ```bash
   git clone https://github.com/your-username/analysis-view-playground.git
   cd analysis-view-playground
   npm install
   ```

2. **Build the extension:**
   ```bash
   npm run compile
   ```

3. **Run in development:**
   - Press `F5` in VS Code to launch Extension Development Host
   - Make changes and reload the window to test

4. **Run tests:**
   ```bash
   npm test
   ```

## Project Structure

```
src/
├── extension.ts                     # Main extension entry point
├── AnalysisViewPlaygroundProvider.ts # Webview provider
├── CopilotIntegration.ts           # AI/Copilot integration
├── buildPrompt.tsx                 # Prompt building for AI
├── ValidationService.ts            # Error handling and logging
└── types.ts                        # TypeScript type definitions
```

## Coding Guidelines

### TypeScript Standards
- Use TypeScript strict mode
- Provide proper type annotations
- Follow existing code patterns and naming conventions

### Code Quality
- Run `npm run lint` to check for issues
- Add JSDoc comments for public functions
- Keep functions focused and testable

### Error Handling
- Use the `ErrorReportingService` for logging
- Provide user-friendly error messages
- Handle edge cases gracefully

### Example Code Style
```typescript
/**
 * Creates a new visualization configuration
 * @param chartType The type of chart to create
 * @param data The data to visualize
 * @returns Promise resolving to the configuration
 */
async function createVisualization(
    chartType: string, 
    data: any[]
): Promise<VisualizationConfig> {
    try {
        // Implementation here
        return config;
    } catch (error) {
        ErrorReportingService.logError(error as Error, 'create-visualization');
        throw new Error('Failed to create visualization');
    }
}
```

## Testing

### Manual Testing
- Test core functionality: creating SQL queries, generating JavaScript, exporting configs
- Test with different chart types and data scenarios
- Test MCP integration if applicable
- Test error conditions and edge cases

### Automated Testing
- Add unit tests for new functions
- Test both success and error paths
- Use VS Code test framework for extension-specific tests

## Documentation

### Code Documentation
- Add JSDoc comments to public functions and classes
- Include parameter and return type descriptions
- Document complex logic with inline comments

### User Documentation
- Update README.md for new features
- Add examples for new functionality
- Update setup guides when dependencies change

## MCP Server Integration

When adding support for new MCP servers:

1. **Test with real servers:** Ensure compatibility with actual MCP implementations
2. **Update configuration:** Add new server examples to `MCP_SETUP.md`
3. **Error handling:** Provide clear error messages for configuration issues
4. **Documentation:** Include setup instructions and examples

## Pull Request Process

### Before Submitting
- [ ] Code compiles without errors (`npm run compile`)
- [ ] Linting passes (`npm run lint`)
- [ ] Manual testing completed
- [ ] Documentation updated if needed
- [ ] Commit messages are clear and descriptive

### PR Description Template
```markdown
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Manual testing performed
- [ ] Automated tests added/updated
- [ ] Tested with different MCP servers (if applicable)

## Screenshots (if applicable)
Include screenshots for UI changes
```

### Review Process
1. Maintainers will review your PR
2. Address any feedback or requested changes
3. Once approved, your PR will be merged

## Release Process

Releases follow semantic versioning:
- **Patch** (1.0.1): Bug fixes
- **Minor** (1.1.0): New features, backward compatible
- **Major** (2.0.0): Breaking changes

## Getting Help

- **Questions:** Open a GitHub Discussion
- **Issues:** Use GitHub Issues
- **Real-time Chat:** Check if there's a Discord/Slack community

## Recognition

Contributors will be acknowledged in:
- GitHub contributors list
- Release notes for significant contributions
- README.md contributors section (if applicable)

Thank you for contributing to make this extension better for everyone! 🎉
