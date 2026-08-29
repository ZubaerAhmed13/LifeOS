const { defineConfig } = require('@playwright/test');

const browserName = process.env.BROWSER;
if (!['chromium', 'firefox', 'webkit'].includes(browserName)) {
  throw new Error(`Unsupported or missing BROWSER: ${browserName}`);
}

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['line'],
    ['json', { outputFile: process.env.RESULT_PATH }],
    ['html', { outputFolder: `cert-corrected/report-${browserName}`, open: 'never' }]
  ],
  outputDir: `cert-corrected/test-results-${browserName}`,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [{ name: browserName, use: { browserName } }]
});
