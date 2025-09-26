const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  files: 'out/test/**/*.test.js',
  extensionDevelopmentPath: __dirname,
  launchArgs: [
    '--enable-proposed-api',
    '--disable-workspace-trust',
  ]
});