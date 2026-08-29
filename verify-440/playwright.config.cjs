const { defineConfig } = require('@playwright/test');

const browserName = process.env.LIFEOS_BROWSER || 'chromium';

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['calendar-430.spec.js', 'intelligence-440.spec.js'],
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: `reports/${browserName}-results.json` }],
    ['html', { outputFolder: `reports/${browserName}-html`, open: 'never' }]
  ],
  outputDir: `test-results/${browserName}`,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName,
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'node serve.cjs pwa 4173',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [{ name: browserName, use: { browserName } }]
});
